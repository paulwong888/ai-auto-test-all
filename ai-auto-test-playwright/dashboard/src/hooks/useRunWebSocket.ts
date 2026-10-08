import { useCallback, useEffect, useRef, useState } from "react";

export interface RunLiveState {
  runId: string | null;
  running: boolean;
  logs: string[];
  vncUrl: string | null;
  vncToken: string | null;
  pulseAt: number | null;
  runStartedAt: number | null;
  result: { passed: number; failed: number; skipped: number; durationMs: number } | null;
}

export function useRunWebSocket() {
  const [state, setState] = useState<RunLiveState>({
    runId: null,
    running: false,
    logs: [],
    vncUrl: null,
    vncToken: null,
    pulseAt: null,
    runStartedAt: null,
    result: null,
  });
  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg.type === "run_started" && typeof msg.runId === "string") {
          activeRunIdRef.current = msg.runId;
          setState({
            runId: msg.runId,
            running: true,
            logs: [],
            vncUrl: typeof msg.vncUrl === "string" ? msg.vncUrl : null,
            vncToken: typeof msg.vncToken === "string" ? msg.vncToken : null,
            pulseAt: Date.now(),
            runStartedAt: Date.now(),
            result: null,
          });
        }
        if (
          msg.type === "run_log" &&
          typeof msg.runId === "string" &&
          typeof msg.line === "string" &&
          msg.runId === activeRunIdRef.current
        ) {
          setState((prev) => ({
            ...prev,
            pulseAt: Date.now(),
            logs: [...prev.logs.slice(-499), msg.line as string],
          }));
        }
        if (
          msg.type === "run_pulse" &&
          typeof msg.runId === "string" &&
          msg.runId === activeRunIdRef.current
        ) {
          setState((prev) => ({
            ...prev,
            pulseAt: typeof msg.ts === "number" ? msg.ts : Date.now(),
          }));
        }
        if (
          msg.type === "run_finished" &&
          typeof msg.runId === "string" &&
          msg.runId === activeRunIdRef.current
        ) {
          setState((prev) => ({
            ...prev,
            running: false,
            vncUrl: null,
            vncToken: null,
            pulseAt: null,
            runStartedAt: null,
            result: {
              passed: Number(msg.passed ?? 0),
              failed: Number(msg.failed ?? 0),
              skipped: Number(msg.skipped ?? 0),
              durationMs: Number(msg.durationMs ?? 0),
            },
          }));
        }
      } catch {
        // ignore malformed messages
      }
    };

    return () => ws.close();
  }, []);

  const reset = useCallback(() => {
    activeRunIdRef.current = null;
    setState({
      runId: null,
      running: false,
      logs: [],
      vncUrl: null,
      vncToken: null,
      pulseAt: null,
      runStartedAt: null,
      result: null,
    });
  }, []);

  const adoptActiveRun = useCallback((runId: string, startedAt?: string) => {
    if (activeRunIdRef.current === runId) return;
    activeRunIdRef.current = runId;
    const startedMs = startedAt ? Date.parse(startedAt) : Date.now();
    setState((prev) => ({
      ...prev,
      runId,
      running: true,
      pulseAt: prev.pulseAt ?? Date.now(),
      runStartedAt: Number.isFinite(startedMs) ? startedMs : Date.now(),
      result: null,
    }));
  }, []);

  const syncFinishedRun = useCallback(
    (run: {
      id: string;
      status: string;
      passed: number;
      failed: number;
      skipped: number;
      durationMs: number;
      finishedAt: string | null;
    }) => {
      if (run.status === "running" || !run.finishedAt) return;
      setState((prev) => {
        if (!prev.running || prev.runId !== run.id) return prev;
        return {
          ...prev,
          running: false,
          vncUrl: null,
          vncToken: null,
          pulseAt: null,
          runStartedAt: null,
          result: {
            passed: run.passed,
            failed: run.failed,
            skipped: run.skipped,
            durationMs: run.durationMs,
          },
        };
      });
    },
    [],
  );

  return { ...state, resetLive: reset, adoptActiveRun, syncFinishedRun };
}
