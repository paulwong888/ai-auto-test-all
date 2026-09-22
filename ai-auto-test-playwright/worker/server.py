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
from typing import Any

PORT = int(os.environ.get("PORT", "8081"))
RUN_TIMEOUT_MS = int(os.environ.get("RUN_TIMEOUT_MS", "600000"))
POST_RUN_WAIT_SEC = int(os.environ.get("POST_RUN_WAIT_SEC", "30"))
PASSED_RE = re.compile(r"(\d+)\s+passed", re.IGNORECASE)
FAILED_RE = re.compile(r"(\d+)\s+failed", re.IGNORECASE)
ERROR_RE = re.compile(r"(\d+)\s+errors?", re.IGNORECASE)
SKIPPED_RE = re.compile(r"(\d+)\s+skipped", re.IGNORECASE)
DURATION_RE = re.compile(r"in\s+([\d.]+)s", re.IGNORECASE)

_active_processes: dict[str, subprocess.Popen[str]] = {}
_lock = threading.Lock()


def parse_pytest_summary(text: str) -> dict[str, int]:
    passed = failed = skipped = 0
    duration_ms = 0
    for line in reversed(text.splitlines()):
        if "passed" not in line and "failed" not in line and "error" not in line and "skipped" not in line:
            continue
        if passed == 0:
            m = PASSED_RE.search(line)
            if m:
                passed = int(m.group(1))
        if failed == 0:
            failed_match = FAILED_RE.search(line)
            error_match = ERROR_RE.search(line)
            failed = (int(failed_match.group(1)) if failed_match else 0) + (
                int(error_match.group(1)) if error_match else 0
            )
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


def emit(writer: Any, payload: dict[str, Any]) -> None:
    line = json.dumps(payload, ensure_ascii=False) + "\n"
    writer.write(line.encode("utf-8"))
    writer.flush()


def run_command(run_id: str, command: str, writer: Any) -> None:
    started = time.time()
    output_chunks: list[str] = []

    if "--headed" in command:
        wrapped = f"xvfb-run -a sh -c {json.dumps(command)}"
    else:
        wrapped = f"sh -c {json.dumps(command)}"

    timeout_sec = max(RUN_TIMEOUT_MS // 1000, 60)
    proc = subprocess.Popen(
        wrapped,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
    )

    with _lock:
        _active_processes[run_id] = proc

    exit_code = 1
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            output_chunks.append(line)
            emit(writer, {"type": "log", "stream": "stdout", "line": line.rstrip("\n")})

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
            emit(
                writer,
                {
                    "type": "log",
                    "stream": "stderr",
                    "line": f"pytest process did not exit within {grace_sec}s after output ended; killed",
                },
            )
    finally:
        with _lock:
            _active_processes.pop(run_id, None)

    summary = parse_pytest_summary("".join(output_chunks))
    duration_ms = summary.get("durationMs") or int((time.time() - started) * 1000)
    emit(
        writer,
        {
            "type": "finished",
            "exitCode": exit_code,
            "passed": summary["passed"],
            "failed": summary["failed"],
            "skipped": summary["skipped"],
            "durationMs": duration_ms,
        },
    )


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
            self._send_json(200, {"ok": True, "workerId": os.environ.get("WORKER_ID", "worker-1")})
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
            if not run_id or not command:
                self._send_json(400, {"ok": False, "error": "runId and command are required"})
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()

            run_command(run_id, command, self.wfile)
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

        self._send_json(404, {"ok": False, "error": "not_found"})


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), WorkerHandler)
    print(f"[worker] listening on http://0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
