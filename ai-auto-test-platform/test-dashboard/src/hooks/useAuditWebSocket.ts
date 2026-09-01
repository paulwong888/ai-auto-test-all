import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditJobState, AuditModuleJobState, AuditWsMessage } from "../types/audit";

export function useAuditWebSocket() {
  const [connected, setConnected] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [modules, setModules] = useState<AuditModuleJobState[]>([]);
  const [featureCount, setFeatureCount] = useState(0);
  const [jobFinished, setJobFinished] = useState<{
    success: boolean;
    message: string;
    featureCount: number;
  } | null>(null);

  const activeJobIdRef = useRef<string | null>(null);

  const resetAudit = useCallback(() => {
    activeJobIdRef.current = null;
    setActiveJobId(null);
    setModules([]);
    setFeatureCount(0);
    setJobFinished(null);
  }, []);

  const beginJob = useCallback((jobId: string, initialModules: AuditModuleJobState[]) => {
    activeJobIdRef.current = jobId;
    setActiveJobId(jobId);
    setModules(initialModules);
    setFeatureCount(0);
    setJobFinished(null);
  }, []);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

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

      const jobId = activeJobIdRef.current;
      if (!jobId) return;

      const msg = raw as AuditWsMessage;

      switch (msg.type) {
        case "audit_module_started": {
          if (msg.jobId !== jobId) return;
          setModules((prev) =>
            prev.map((m) =>
              m.id === msg.moduleId ? { ...m, status: "running" } : m,
            ),
          );
          break;
        }
        case "audit_module_completed": {
          if (msg.jobId !== jobId) return;
          setModules((prev) =>
            prev.map((m) =>
              m.id === msg.moduleId
                ? { ...m, status: "completed", featureCount: msg.featureCount }
                : m,
            ),
          );
          setFeatureCount((c) => c + msg.featureCount);
          break;
        }
        case "audit_module_failed": {
          if (msg.jobId !== jobId) return;
          setModules((prev) =>
            prev.map((m) =>
              m.id === msg.moduleId
                ? { ...m, status: "failed", error: msg.message }
                : m,
            ),
          );
          break;
        }
        case "audit_merge_completed": {
          if (msg.jobId !== jobId) return;
          setFeatureCount(msg.featureCount);
          break;
        }
        case "audit_job_completed": {
          if (msg.jobId !== jobId) return;
          setJobFinished({
            success: msg.success,
            message: msg.message,
            featureCount: msg.featureCount,
          });
          break;
        }
        default:
          break;
      }
    };

    return () => ws.close();
  }, []);

  const pollJob = useCallback(async (jobId: string): Promise<AuditJobState | null> => {
    const res = await fetch(`/api/audit/jobs/${encodeURIComponent(jobId)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) return null;
    const job = data.job as AuditJobState;
    setModules(job.modules);
    setFeatureCount(job.featureCount);
    if (job.status === "completed") {
      setJobFinished({
        success: true,
        message: `完整審計完成，共 ${job.featureCount} 條劇本`,
        featureCount: job.featureCount,
      });
    } else if (job.status === "failed" || job.status === "cancelled") {
      setJobFinished({
        success: false,
        message: job.error ?? job.status,
        featureCount: job.featureCount,
      });
    }
    return job;
  }, []);

  return {
    connected,
    activeJobId,
    modules,
    featureCount,
    jobFinished,
    beginJob,
    resetAudit,
    pollJob,
  };
}
