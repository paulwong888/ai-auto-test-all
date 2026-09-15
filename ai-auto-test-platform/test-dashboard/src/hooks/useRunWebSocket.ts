import { useCallback, useEffect, useRef, useState } from "react";
import type { FlatGherkinStep, MilestoneKind, RunMilestone, WsMessage } from "../types";
import { extractTestReport } from "../utils/extractTestReport";

export interface LiveLogLine {
  id: string;
  stream: "stdout" | "stderr" | "ai" | "tool";
  text: string;
}

export function useRunWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const aiBufferRef = useRef("");
  const activeRunIdRef = useRef<string | null>(null);
  const logId = useRef(0);
  const milestoneId = useRef(0);
  const [connected, setConnected] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState("");
  const [steps, setSteps] = useState<FlatGherkinStep[]>([]);
  const [logs, setLogs] = useState<LiveLogLine[]>([]);
  const [milestones, setMilestones] = useState<RunMilestone[]>([]);
  const [runFinished, setRunFinished] = useState<{ success: boolean; message: string } | null>(
    null,
  );
  const [testReport, setTestReport] = useState<string | null>(null);

  const beginRun = useCallback(
    (runId: string, featureId: string, title: string, runSteps: FlatGherkinStep[]) => {
      activeRunIdRef.current = runId;
      aiBufferRef.current = "";
      logId.current = 1;
      milestoneId.current = 0;
      setActiveRunId(runId);
      setActiveFeatureId(featureId);
      setActiveTitle(title);
      setSteps(runSteps);
      setRunFinished(null);
      setTestReport(null);
      setMilestones([]);
      setLogs([{ id: "1", stream: "stdout", text: `▶ 開始執行：${title}` }]);
    },
    [],
  );

  const appendLog = useCallback((runId: string, stream: LiveLogLine["stream"], text: string) => {
    if (runId !== activeRunIdRef.current || !text) return;
    setLogs((prev) => {
      const next = prev.slice(-500);
      const last = next[next.length - 1];
      // LLM 流式 text_delta 逐 token 推送；合并到同一行避免每个词换行
      if (stream === "ai" && last?.stream === "ai") {
        return [...next.slice(0, -1), { ...last, text: last.text + text }];
      }
      logId.current += 1;
      return [...next, { id: String(logId.current), stream, text }];
    });
  }, []);

  const appendMilestone = useCallback(
    (
      runId: string,
      kind: MilestoneKind,
      message: string,
      phase?: FlatGherkinStep["phase"],
      index?: number,
    ) => {
      if (runId !== activeRunIdRef.current) return;
      milestoneId.current += 1;
      setMilestones((prev) => [
        ...prev,
        { id: String(milestoneId.current), kind, message, phase, index },
      ]);
    },
    [],
  );

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (ev) => {
      let raw: { type: string };
      try {
        raw = JSON.parse(ev.data as string);
      } catch {
        return;
      }

      if (raw.type === "connected") return;

      const msg = raw as WsMessage;
      switch (msg.type) {
        case "run_started":
          beginRun(msg.runId, msg.featureId, msg.title, msg.steps);
          break;
        case "step_update":
          if (msg.runId !== activeRunIdRef.current) return;
          setSteps((prev) =>
            prev.map((s) =>
              s.phase === msg.phase && s.index === msg.index
                ? { ...s, status: msg.status }
                : s,
            ),
          );
          break;
        case "milestone":
          if (msg.runId !== activeRunIdRef.current) return;
          appendMilestone(msg.runId, msg.kind, msg.message, msg.phase, msg.index);
          break;
        case "log":
          if (msg.runId !== activeRunIdRef.current) return;
          if (msg.stream === "ai") {
            aiBufferRef.current += msg.text;
          }
          appendLog(msg.runId, msg.stream, msg.text);
          break;
        case "run_finished":
          if (msg.runId !== activeRunIdRef.current) return;
          setRunFinished({ success: msg.success, message: msg.message });
          appendLog(msg.runId, msg.success ? "stdout" : "stderr", msg.message);
          if (msg.success) {
            setTestReport(extractTestReport(aiBufferRef.current));
          }
          break;
        default:
          break;
      }
    };

    return () => ws.close();
  }, [appendLog, appendMilestone, beginRun]);

  const resetLive = useCallback(() => {
    activeRunIdRef.current = null;
    aiBufferRef.current = "";
    logId.current = 0;
    milestoneId.current = 0;
    setActiveRunId(null);
    setActiveFeatureId(null);
    setActiveTitle("");
    setSteps([]);
    setLogs([]);
    setMilestones([]);
    setRunFinished(null);
    setTestReport(null);
  }, []);

  const hydrateRun = useCallback(
    (
      runId: string,
      featureId: string,
      title: string,
      runSteps: FlatGherkinStep[],
      restoredLogs: Array<{ stream: LiveLogLine["stream"]; text: string }>,
    ) => {
      activeRunIdRef.current = runId;
      aiBufferRef.current = restoredLogs
        .filter((l) => l.stream === "ai")
        .map((l) => l.text)
        .join("");
      logId.current = restoredLogs.length;
      milestoneId.current = 0;
      setActiveRunId(runId);
      setActiveFeatureId(featureId);
      setActiveTitle(title);
      setSteps(runSteps);
      setRunFinished(null);
      setTestReport(null);
      setMilestones([]);
      const merged: LiveLogLine[] = [];
      for (const line of restoredLogs) {
        const last = merged[merged.length - 1];
        if (line.stream === "ai" && last?.stream === "ai") {
          last.text += line.text;
        } else {
          merged.push({
            id: String(merged.length + 1),
            stream: line.stream,
            text: line.text,
          });
        }
      }
      logId.current = merged.length;
      setLogs(merged);
    },
    [],
  );

  return {
    connected,
    activeRunId,
    activeFeatureId,
    activeTitle,
    steps,
    logs,
    milestones,
    runFinished,
    testReport,
    resetLive,
    hydrateRun,
  };
}
