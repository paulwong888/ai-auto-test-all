import { useCallback, useEffect, useState } from "react";
import AuditProgress from "./components/AuditProgress";
import FeatureCard from "./components/FeatureCard";
import LiveTerminal from "./components/LiveTerminal";
import ProjectManager from "./components/ProjectManager";
import ProjectSelector from "./components/ProjectSelector";
import { useAuditWebSocket } from "./hooks/useAuditWebSocket";
import { useRunWebSocket } from "./hooks/useRunWebSocket";
import type { FeaturesDocument } from "./types";
import type { Project } from "./types/project";
import { SELECTED_PROJECT_KEY } from "./types/project";

type LoadStatus = "idle" | "loading" | "ok" | "error";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allowedPrefixes, setAllowedPrefixes] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    localStorage.getItem(SELECTED_PROJECT_KEY),
  );
  const [managerOpen, setManagerOpen] = useState(false);
  const [features, setFeatures] = useState<FeaturesDocument | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [coreAuditStatus, setCoreAuditStatus] = useState<LoadStatus>("idle");
  const [fullAuditStatus, setFullAuditStatus] = useState<LoadStatus>("idle");
  const [runBusy, setRunBusy] = useState(false);
  const [banner, setBanner] = useState("");

  const live = useRunWebSocket();
  const auditLive = useAuditWebSocket();

  const auditBusy =
    coreAuditStatus === "loading" ||
    (fullAuditStatus === "loading" && !auditLive.jobFinished);

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    setProjects(data.projects);
    setAllowedPrefixes(data.allowedRepoPrefixes ?? []);
    return data.projects as Project[];
  }, []);

  const loadFeatures = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setFeatures(null);
      setLoadStatus("idle");
      return;
    }
    setLoadStatus("loading");
    try {
      const res = await fetch(`/api/audit/features?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFeatures(data.features);
      setLoadStatus("ok");
    } catch (err) {
      setLoadStatus("error");
      setFeatures(null);
      setBanner(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const runCoreAudit = useCallback(async () => {
    if (!selectedProjectId) {
      setBanner("請先選擇或新增專案");
      return;
    }
    setCoreAuditStatus("loading");
    setBanner("Pi Agent 核心審計中…");
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, mode: "core" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFeatures(data.features);
      setCoreAuditStatus("ok");
      setBanner(`核心審計完成，${data.featureCount} 條劇本`);
    } catch (err) {
      setCoreAuditStatus("error");
      setBanner(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProjectId]);

  const runFullAudit = useCallback(async () => {
    if (!selectedProjectId) {
      setBanner("請先選擇或新增專案");
      return;
    }
    auditLive.resetAudit();
    setFullAuditStatus("loading");
    setBanner("完整分模組審計已啟動…");
    try {
      const res = await fetch("/api/audit/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      auditLive.beginJob(data.jobId, data.job.modules ?? []);
      setBanner(`完整審計進行中（Job ${data.jobId.slice(0, 8)}…）`);
    } catch (err) {
      setFullAuditStatus("error");
      setBanner(err instanceof Error ? err.message : String(err));
    }
  }, [auditLive, selectedProjectId]);

  const runFeature = useCallback(
    async (featureId: string) => {
      if (!selectedProjectId) {
        setBanner("請先選擇或新增專案");
        return;
      }
      setRunBusy(true);
      live.resetLive();
      setBanner("");
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: selectedProjectId, featureId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      } catch (err) {
        setRunBusy(false);
        setBanner(err instanceof Error ? err.message : String(err));
      }
    },
    [live, selectedProjectId],
  );

  const handleProjectsChanged = useCallback(async () => {
    const list = await loadProjects();
    if (list.length === 0) {
      setSelectedProjectId(null);
      localStorage.removeItem(SELECTED_PROJECT_KEY);
      setFeatures(null);
      return;
    }
    const stillExists = list.some((p) => p.id === selectedProjectId);
    const nextId = stillExists ? selectedProjectId! : list[0]!.id;
    setSelectedProjectId(nextId);
    localStorage.setItem(SELECTED_PROJECT_KEY, nextId);
  }, [loadProjects, selectedProjectId]);

  useEffect(() => {
    void loadProjects()
      .then((list) => {
        if (list.length === 0) return;
        const stored = localStorage.getItem(SELECTED_PROJECT_KEY);
        const valid = list.some((p) => p.id === stored);
        const id = valid && stored ? stored : list[0]!.id;
        setSelectedProjectId(id);
        localStorage.setItem(SELECTED_PROJECT_KEY, id);
      })
      .catch((err) => {
        setBanner(err instanceof Error ? err.message : String(err));
      });
  }, [loadProjects]);

  useEffect(() => {
    void loadFeatures(selectedProjectId);
  }, [loadFeatures, selectedProjectId]);

  useEffect(() => {
    if (live.runFinished) {
      setRunBusy(false);
    }
  }, [live.runFinished]);

  useEffect(() => {
    if (!auditLive.jobFinished) return;
    setFullAuditStatus(auditLive.jobFinished.success ? "ok" : "error");
    setBanner(auditLive.jobFinished.message);
    if (auditLive.jobFinished.success) {
      void loadFeatures(selectedProjectId);
    }
  }, [auditLive.jobFinished, loadFeatures, selectedProjectId]);

  useEffect(() => {
    if (!auditLive.activeJobId || auditLive.jobFinished) return;
    const timer = window.setInterval(() => {
      void auditLive.pollJob(auditLive.activeJobId!);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [auditLive, auditLive.activeJobId, auditLive.jobFinished]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const fullAuditActive =
    fullAuditStatus === "loading" && auditLive.activeJobId !== null && !auditLive.jobFinished;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-400">AI 自動化測試控制台</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            BDD 劇本 · Pi Agent · Playwright
            {selectedProject ? ` · ${selectedProject.name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ProjectSelector
            projects={projects}
            selectedId={selectedProjectId}
            onSelect={(id) => {
              setSelectedProjectId(id);
              localStorage.setItem(SELECTED_PROJECT_KEY, id);
            }}
            onManage={() => setManagerOpen(true)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void runCoreAudit()}
              disabled={!selectedProjectId || auditBusy || runBusy}
              className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-40"
            >
              {coreAuditStatus === "loading" ? "核心審計中…" : "核心審計"}
            </button>
            <button
              type="button"
              onClick={() => void runFullAudit()}
              disabled={!selectedProjectId || auditBusy || runBusy}
              className="px-3 py-1.5 text-xs rounded-lg bg-emerald-950 border border-emerald-800 hover:bg-emerald-900 disabled:opacity-40"
            >
              {fullAuditActive ? "完整審計中…" : "完整審計"}
            </button>
            <button
              type="button"
              onClick={() => void loadFeatures(selectedProjectId)}
              disabled={!selectedProjectId}
              className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-40"
            >
              刷新列表
            </button>
          </div>
        </div>
      </header>

      {banner && (
        <p className="px-6 py-2 text-sm bg-slate-900/80 border-b border-slate-800 text-slate-400">
          {banner}
        </p>
      )}

      <AuditProgress
        modules={auditLive.modules}
        featureCount={auditLive.featureCount}
        active={fullAuditActive}
      />

      {!selectedProjectId && (
        <p className="px-6 py-3 text-sm text-amber-300 bg-amber-950/30 border-b border-amber-900/50">
          請先新增專案：點擊「管理專案」建立，並填寫原始碼路徑與被測 URL。
        </p>
      )}

      <div className="flex-1 grid lg:grid-cols-2 gap-0 min-h-0">
        <aside className="border-r border-slate-800 p-4 overflow-y-auto space-y-3 max-h-[calc(100vh-8rem)]">
          <h2 className="text-sm font-medium text-slate-400 sticky top-0 bg-slate-950 py-1">
            Gherkin 劇本 {features ? `(${features.features.length})` : ""}
          </h2>

          {loadStatus === "loading" && <p className="text-sm text-slate-500">載入中…</p>}

          {!features && loadStatus !== "loading" && selectedProjectId && (
            <p className="text-sm text-slate-500">
              暫無劇本，請先「核心審計」或「完整審計」產生 FEATURES.json
            </p>
          )}

          {features?.features.map((f) => (
            <FeatureCard
              key={f.id}
              feature={f}
              liveSteps={live.activeFeatureId === f.id ? live.steps : null}
              isActive={live.activeFeatureId === f.id}
              isRunning={runBusy || (!!live.activeRunId && !live.runFinished)}
              onRun={(id) => void runFeature(id)}
            />
          ))}
        </aside>

        <main className="p-4 min-h-[420px] lg:max-h-[calc(100vh-8rem)]">
          <LiveTerminal
            key={live.activeRunId ?? "idle"}
            connected={live.connected}
            title={live.activeTitle}
            steps={live.steps}
            logs={live.logs}
            milestones={live.milestones}
            finished={live.runFinished}
            testReport={live.testReport}
          />
        </main>
      </div>

      <ProjectManager
        open={managerOpen}
        projects={projects}
        allowedPrefixes={allowedPrefixes}
        onClose={() => setManagerOpen(false)}
        onChanged={() => void handleProjectsChanged()}
      />
    </div>
  );
}
