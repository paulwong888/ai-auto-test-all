import { useCallback, useEffect, useRef, useState } from "react";

export interface RunLiveState {
  runId: string | null;
  running: boolean;
  logs: string[];
  vncUrl: string | null;
  vncToken: string | null;
  result: { passed: number; failed: number; skipped: number; durationMs: number } | null;
}

export function useRunWebSocket() {
  const [state, setState] = useState<RunLiveState>({
    runId: null,
    running: false,
    logs: [],
    vncUrl: null,
    vncToken: null,
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
            logs: [...prev.logs.slice(-499), msg.line as string],
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
      result: null,
    });
  }, []);

  return { ...state, resetLive: reset };
}
