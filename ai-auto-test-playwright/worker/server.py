#!/usr/bin/env python3
"""Python Worker: executes pytest and streams NDJSON logs."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

PORT = int(os.environ.get("PORT", "8081"))
RUN_TIMEOUT_MS = int(os.environ.get("RUN_TIMEOUT_MS", "600000"))
POST_RUN_WAIT_SEC = int(os.environ.get("POST_RUN_WAIT_SEC", "30"))
HEARTBEAT_INTERVAL_SEC = int(os.environ.get("HEARTBEAT_INTERVAL_SEC", "30"))
PASSED_RE = re.compile(r"(\d+)\s+passed", re.IGNORECASE)
FAILED_RE = re.compile(r"(\d+)\s+failed", re.IGNORECASE)
SKIPPED_RE = re.compile(r"(\d+)\s+skipped", re.IGNORECASE)
DURATION_RE = re.compile(r"in\s+([\d.]+)s", re.IGNORECASE)
COLLECT_LINE_RE = re.compile(r"^(specs/\S+::\S+(?:::\S+)?)")

_active_processes: dict[str, subprocess.Popen[str]] = {}
_lock = threading.Lock()


def parse_pytest_summary(text: str) -> dict[str, int]:
    passed = failed = skipped = 0
    duration_ms = 0
    for line in reversed(text.splitlines()):
        if "passed" not in line and "failed" not in line and "skipped" not in line:
            continue
        if passed == 0:
            m = PASSED_RE.search(line)
            if m:
                passed = int(m.group(1))
        if failed == 0:
            m = FAILED_RE.search(line)
            if m:
                failed = int(m.group(1))
        if skipped == 0:
            m = SKIPPED_RE.search(line)
            if m:
                skipped = int(m.group(1))
        if duration_ms == 0:
            m = DURATION_RE.search(line)
            if m:
                duration_ms = int(float(m.group(1)) * 1000)
        if passed or failed or skipped:
            return {
                "passed": passed,
                "failed": failed,
                "skipped": skipped,
                "durationMs": duration_ms,
            }
    return {"passed": passed, "failed": failed, "skipped": skipped, "durationMs": duration_ms}


def extract_tc_from_node(node_id: str) -> str | None:
    m = re.search(r"test_tc(\d+)", node_id, re.I) or re.search(r"TC-(\d+)", node_id, re.I)
    if not m:
        return None
    return f"TC-{m.group(1).zfill(3)}"


def parse_collect_output(text: str) -> list[dict[str, str | None]]:
    items: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("specs/"):
            continue
        match = COLLECT_LINE_RE.match(line)
        if not match:
            continue
        node_id = match.group(1)
        if node_id in seen:
            continue
        seen.add(node_id)
        tc = extract_tc_from_node(node_id)
        func = re.sub(r"\[.*\]$", "", node_id.rsplit("::", 1)[-1])
        label = func[len("test_") :].replace("_", " ") if func.startswith("test_") else func
        name = label or tc or func
        items.append({"nodeId": node_id, "name": name, "tc": tc})
    return items


def run_collect(command: str) -> dict[str, Any]:
    wrapped = f"sh -c {json.dumps(command)}"
    proc = subprocess.run(
        wrapped,
        shell=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    items = parse_collect_output(output)
    return {
        "ok": len(items) > 0,
        "exitCode": proc.returncode,
        "items": items,
        "output": output[-4000:] if len(output) > 4000 else output,
    }


def emit(writer: Any, payload: dict[str, Any]) -> bool:
    try:
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        writer.write(line.encode("utf-8"))
        writer.flush()
        return True
    except (BrokenPipeError, ConnectionResetError, OSError):
        return False


def _run_dir(workspace_path: str | None, run_id: str) -> Path | None:
    if not workspace_path:
        return None
    return Path(workspace_path) / "tests" / ".runs" / run_id


def _append_local_log(run_dir: Path | None, line: str) -> None:
    if run_dir is None:
        return
    try:
        run_dir.mkdir(parents=True, exist_ok=True)
        with open(run_dir / "run.log", "a", encoding="utf-8") as f:
            f.write(line.rstrip("\n") + "\n")
    except OSError as exc:
        sys.stderr.write(f"[worker] failed to write local run.log: {exc}\n")


def _write_local_meta(
    run_dir: Path | None,
    run_id: str,
    *,
    status: str,
    exit_code: int,
    passed: int,
    failed: int,
    skipped: int,
    duration_ms: int,
    error: str | None = None,
) -> None:
    if run_dir is None:
        return
    try:
        run_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "runId": run_id,
            "status": status,
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "durationMs": duration_ms,
            "exitCode": exit_code,
            "error": error,
            "finishedAt": time.time(),
            "clientDisconnected": True,
        }
        with open(run_dir / "run-meta.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
    except OSError as exc:
        sys.stderr.write(f"[worker] failed to write local run-meta.json: {exc}\n")


def _heartbeat_loop(
    writer: Any,
    connected: threading.Event,
    stop: threading.Event,
) -> None:
    while not stop.wait(HEARTBEAT_INTERVAL_SEC):
        if not connected.is_set():
            continue
        if not emit(writer, {"type": "heartbeat", "ts": time.time()}):
            connected.clear()


def run_command(
    run_id: str,
    command: str,
    writer: Any,
    *,
    workspace_path: str | None = None,
    vnc_preview: bool = False,
) -> None:
    started = time.time()
    output_chunks: list[str] = []
    run_dir = _run_dir(workspace_path, run_id)
    client_connected = threading.Event()
    client_connected.set()
    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(
        target=_heartbeat_loop,
        args=(writer, client_connected, stop_heartbeat),
        daemon=True,
    )
    heartbeat.start()

    headed = "--headed" in command
    display = ":99" if Path("/tmp/.X11-unix/X99").exists() else None
    if headed and (vnc_preview or display):
        wrapped = f"sh -c {json.dumps(command)}"
        run_env = {**os.environ, "DISPLAY": display or ":99"}
    elif headed:
        wrapped = f"xvfb-run -a sh -c {json.dumps(command)}"
        run_env = None
    else:
        wrapped = f"sh -c {json.dumps(command)}"
        run_env = None

    timeout_sec = max(RUN_TIMEOUT_MS // 1000, 60)
    proc = subprocess.Popen(
        wrapped,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
        env=run_env,
    )

    with _lock:
        _active_processes[run_id] = proc

    exit_code = 1
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            output_chunks.append(line)
            stripped = line.rstrip("\n")
            if client_connected.is_set():
                if not emit(writer, {"type": "log", "stream": "stdout", "line": stripped}):
                    client_connected.clear()
                    sys.stderr.write(
                        f"[worker] run {run_id}: client disconnected, continuing pytest locally\n"
                    )
            if not client_connected.is_set():
                _append_local_log(run_dir, stripped)

        grace_sec = min(POST_RUN_WAIT_SEC, timeout_sec)
        try:
            exit_code = proc.wait(timeout=grace_sec)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, 15)
            except OSError:
                proc.kill()
            try:
                exit_code = proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, 9)
                except OSError:
                    proc.kill()
                exit_code = proc.wait(timeout=5)
            msg = f"pytest process did not exit within {grace_sec}s after output ended; killed"
            if client_connected.is_set():
                if not emit(
                    writer,
                    {"type": "log", "stream": "stderr", "line": msg},
                ):
                    client_connected.clear()
            if not client_connected.is_set():
                _append_local_log(run_dir, msg)
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=1)
        with _lock:
            _active_processes.pop(run_id, None)

    summary = parse_pytest_summary("".join(output_chunks))
    duration_ms = summary.get("durationMs") or int((time.time() - started) * 1000)
    finished = {
        "type": "finished",
        "exitCode": exit_code,
        "passed": summary["passed"],
        "failed": summary["failed"],
        "skipped": summary["skipped"],
        "durationMs": duration_ms,
    }

    if client_connected.is_set():
        emit(writer, finished)
    else:
        status = "failed" if exit_code != 0 or summary["failed"] > 0 else "passed"
        _write_local_meta(
            run_dir,
            run_id,
            status=status,
            exit_code=exit_code,
            passed=summary["passed"],
            failed=summary["failed"],
            skipped=summary["skipped"],
            duration_ms=duration_ms,
            error="Client disconnected before stream finished",
        )
        if run_dir is not None:
            try:
                with open(run_dir / "run.log", "w", encoding="utf-8") as f:
                    f.write("".join(output_chunks))
            except OSError as exc:
                sys.stderr.write(f"[worker] failed to flush local run.log: {exc}\n")


def cancel_run(run_id: str) -> bool:
    with _lock:
        proc = _active_processes.get(run_id)
    if not proc or proc.poll() is not None:
        return False
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    return True


class WorkerHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[worker] %s - %s\n" % (self.address_string(), fmt % args))

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            vnc_ready = os.environ.get("DISPLAY") == ":99"
            self._send_json(
                200,
                {
                    "ok": True,
                    "workerId": os.environ.get("WORKER_ID", "worker-1"),
                    "vncReady": vnc_ready,
                },
            )
            return
        if self.path == "/heartbeat":
            self._send_json(200, {"ok": True, "ts": time.time()})
            return
        self._send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        if self.path == "/internal/run":
            payload = self._read_json()
            run_id = str(payload.get("runId", ""))
            command = str(payload.get("command", ""))
            workspace_path = str(payload.get("workspacePath", "")).strip() or None
            vnc_preview = payload.get("vncPreview") is True
            if not run_id or not command:
                self._send_json(400, {"ok": False, "error": "runId and command are required"})
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()

            run_command(
                run_id,
                command,
                self.wfile,
                workspace_path=workspace_path,
                vnc_preview=vnc_preview,
            )
            return

        if self.path == "/internal/cancel":
            payload = self._read_json()
            run_id = str(payload.get("runId", ""))
            if not run_id:
                self._send_json(400, {"ok": False, "error": "runId is required"})
                return
            cancelled = cancel_run(run_id)
            self._send_json(200, {"ok": True, "cancelled": cancelled})
            return

        if self.path == "/internal/collect":
            payload = self._read_json()
            command = str(payload.get("command", "")).strip()
            if not command:
                self._send_json(400, {"ok": False, "error": "command is required"})
                return
            result = run_collect(command)
            status = 200 if result["ok"] else 502
            self._send_json(status, result)
            return

        self._send_json(404, {"ok": False, "error": "not_found"})


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), WorkerHandler)
    print(f"[worker] listening on http://0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
