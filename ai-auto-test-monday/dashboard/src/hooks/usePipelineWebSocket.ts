import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineProgressView } from "../lib/merge-progress.js";

export type PipelineWsProgress = PipelineProgressView;

export interface RunSnapshot {
  status: string;
  execution_status?: string | null;
}

interface WsAgentEvent {
  runId: string;
  agent?: string;
  status?: string;
  artifactRoot?: string;
  ts?: string;
  type?: string;
  progress?: PipelineWsProgress | null;
  run?: RunSnapshot;
}

const AGENT_ORDER = [
  "scriptAnalyst",
  "stageManager",
  "blockingCoach",
  "setDesigner",
  "choreographer",
  "assistantDirector",
  "continuityLead",
];

const GENERATION_AGENTS = AGENT_ORDER.filter((id) => id !== "continuityLead");

export interface UsePipelineWebSocketOptions {
  executeAfterGenerate?: boolean;
  executeOnly?: boolean;
  onRunSnapshot?: (
    run: RunSnapshot,
    progress: PipelineWsProgress | null,
  ) => void;
  onExecutionFinished?: (status: "completed" | "failed", error?: string) => void;
  onRunCancelled?: () => void;
}

export function usePipelineWebSocket(
  runId: string | null,
  enabled: boolean,
  onAgentCompleted?: (agent: string) => void,
  options: UsePipelineWebSocketOptions = {},
) {
  const wsRef = useRef<WebSocket | null>(null);
  const completedRef = useRef<string[]>([]);
  const onAgentCompletedRef = useRef(onAgentCompleted);
  onAgentCompletedRef.current = onAgentCompleted;
  const onRunSnapshotRef = useRef(options.onRunSnapshot);
  onRunSnapshotRef.current = options.onRunSnapshot;
  const onExecutionFinishedRef = useRef(options.onExecutionFinished);
  onExecutionFinishedRef.current = options.onExecutionFinished;
  const onRunCancelledRef = useRef(options.onRunCancelled);
  onRunCancelledRef.current = options.onRunCancelled;
  const executeAfterGenerateRef = useRef(options.executeAfterGenerate ?? true);
  executeAfterGenerateRef.current = options.executeAfterGenerate ?? true;
  const executeOnlyRef = useRef(options.executeOnly ?? false);
  executeOnlyRef.current = options.executeOnly ?? false;
  const [connected, setConnected] = useState(false);
  const [progress, setProgress] = useState<PipelineWsProgress | null>(null);

  const seedFromSnapshot = useCallback((snapshot: PipelineWsProgress) => {
    completedRef.current = [...snapshot.completedAgents];
    setProgress(snapshot);
  }, []);

  const resetForRun = useCallback(() => {
    completedRef.current = executeOnlyRef.current ? [...GENERATION_AGENTS] : [];
  }, []);

  useEffect(() => {
    if (!runId || !enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      return;
    }

    resetForRun();
    let closedByUs = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${proto}://${window.location.host}/ws?runId=${encodeURIComponent(runId)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closedByUs || attempts >= 10) return;
        // Reconnect with backoff — the server sends a fresh snapshot on
        // connect, so any events missed while disconnected are re-seeded.
        attempts += 1;
        retryTimer = setTimeout(connect, Math.min(1000 * attempts, 5000));
      };
      ws.onerror = () => setConnected(false);

      ws.onmessage = (ev) => {
        let msg: WsAgentEvent;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.runId && msg.runId !== runId) return;

        if (msg.type === "connected") return;

        if (msg.type === "snapshot") {
          const snapshotProgress = msg.progress ?? null;
          if (snapshotProgress) {
            seedFromSnapshot(snapshotProgress);
          }
          if (msg.run) {
            onRunSnapshotRef.current?.(msg.run, snapshotProgress);
          }
          return;
        }

        const agent = msg.agent;
        const status = msg.status;

        if (status === "cancelled") {
          onRunCancelledRef.current?.();
          setProgress((prev) => ({
            status: "cancelled",
            currentAgent: null,
            completedAgents: prev?.completedAgents ?? [...completedRef.current],
            artifactRoot: msg.artifactRoot ?? prev?.artifactRoot,
            executeAfterGenerate: executeAfterGenerateRef.current,
            skippedAgents: prev?.skippedAgents ?? [],
          }));
          return;
        }

        if (agent && status === "started") {
          const baseCompleted = executeOnlyRef.current
            ? [...GENERATION_AGENTS]
            : completedRef.current.length > 0
              ? completedRef.current
              : [];
          setProgress((prev) => ({
            status: "running",
            currentAgent: agent,
            completedAgents:
              prev?.status === "running" && prev.completedAgents.length > 0
                ? prev.completedAgents
                : baseCompleted,
            artifactRoot: msg.artifactRoot ?? prev?.artifactRoot,
            executeAfterGenerate: executeAfterGenerateRef.current,
            skippedAgents: prev?.skippedAgents ?? [],
          }));
        }

        if (agent && status === "completed") {
          if (!completedRef.current.includes(agent)) {
            completedRef.current = [...completedRef.current, agent];
          }
          onAgentCompletedRef.current?.(agent);
          const idx = AGENT_ORDER.indexOf(agent);
          const nextAgent =
            idx >= 0 && idx < AGENT_ORDER.length - 1
              ? AGENT_ORDER[idx + 1]
              : null;
          const pipelineDone = agent === "continuityLead";
          const skipContinuityLead =
            agent === "assistantDirector" &&
            executeAfterGenerateRef.current === false &&
            !executeOnlyRef.current;

          if (skipContinuityLead) {
            setProgress({
              status: "completed",
              currentAgent: null,
              completedAgents: [...completedRef.current],
              artifactRoot: msg.artifactRoot,
              executeAfterGenerate: false,
              skippedAgents: ["continuityLead"],
            });
            return;
          }

          setProgress((prev) => ({
            status: pipelineDone ? "completed" : "running",
            currentAgent: pipelineDone ? null : nextAgent,
            completedAgents: [...completedRef.current],
            artifactRoot: msg.artifactRoot ?? prev?.artifactRoot,
            executeAfterGenerate: executeAfterGenerateRef.current,
            skippedAgents: prev?.skippedAgents ?? [],
          }));
        }

        if (status === "execution-completed") {
          if (!completedRef.current.includes("continuityLead")) {
            completedRef.current = [...completedRef.current, "continuityLead"];
          }
          onExecutionFinishedRef.current?.("completed");
          setProgress((prev) => ({
            status: "completed",
            currentAgent: null,
            completedAgents: [...completedRef.current],
            artifactRoot: msg.artifactRoot ?? prev?.artifactRoot,
            executeAfterGenerate: true,
            skippedAgents: [],
          }));
        }

        if (status === "execution-failed") {
          if (!completedRef.current.includes("continuityLead")) {
            completedRef.current = [...completedRef.current, "continuityLead"];
          }
          const err = (msg as { error?: string }).error;
          onExecutionFinishedRef.current?.("failed", err);
          setProgress((prev) => ({
            status: "failed",
            currentAgent: null,
            completedAgents: [...completedRef.current],
            artifactRoot: msg.artifactRoot ?? prev?.artifactRoot,
            error: err,
            executeAfterGenerate: true,
            skippedAgents: [],
          }));
        }

        if (agent && status === "failed") {
          setProgress((prev) => ({
            status: "failed",
            currentAgent: null,
            completedAgents: prev?.completedAgents?.length
              ? prev.completedAgents
              : [...completedRef.current],
            artifactRoot: msg.artifactRoot ?? prev?.artifactRoot,
            error: (msg as { error?: string }).error,
            executeAfterGenerate: executeAfterGenerateRef.current,
            skippedAgents: prev?.skippedAgents ?? [],
          }));
        }
      };
    };

    connect();

    return () => {
      closedByUs = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [runId, enabled, resetForRun, seedFromSnapshot]);

  return { connected, progress, seedFromSnapshot };
}
