import { useCallback, useEffect, useState } from "react";
import { ProjectPanel, type ProjectRecord } from "./components/ProjectPanel";

const AGENTS = [
  { id: "scriptAnalyst", label: "Script Analyst" },
  { id: "stageManager", label: "Stage Manager" },
  { id: "blockingCoach", label: "Blocking Coach" },
  { id: "setDesigner", label: "Set Designer" },
  { id: "choreographer", label: "Choreographer" },
  { id: "assistantDirector", label: "Assistant Director" },
];

const BASE_ARTIFACT_LINKS = [
  { key: "registry", label: "component-registry.json", agent: "scriptAnalyst" },
  { key: "injections", label: "testid-injections.json", agent: "stageManager" },
  { key: "locators", label: "locator-catalog.json", agent: "blockingCoach" },
  { key: "journeys", label: "journeys.json", agent: "choreographer" },
  { key: "sample-spec", label: "tests/sample.spec.ts", agent: "assistantDirector" },
] as const;

interface ArtifactLink {
  key: string;
  label: string;
  agent: string;
}

interface Progress {
  status: string;
  currentAgent: string | null;
  completedAgents: string[];
  artifactRoot?: string;
  error?: string;
}

export default function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [previewMeta, setPreviewMeta] = useState<string>("");
  const [artifactLinks, setArtifactLinks] = useState<ArtifactLink[]>([
    ...BASE_ARTIFACT_LINKS,
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    const list = (data.projects ?? []) as ProjectRecord[];
    setProjects(list);
    setProjectId((prev) => {
      if (prev && list.some((p) => p.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    void loadProjects().catch((e) => setError(String(e)));
  }, [loadProjects]);

  const selectedProject = projects.find((p) => p.id === projectId);
  const canRunPipeline = selectedProject?.cloneStatus === "ready";

  const pollRun = useCallback(async (id: string) => {
    const res = await fetch(`/api/pipeline/runs/${id}`);
    const data = await res.json();
    if (data.progress) setProgress(data.progress);
    if (data.progress?.status === "completed" || data.progress?.status === "failed") {
      setLoading(false);
      const listRes = await fetch(`/api/pipeline/runs/${id}/artifacts/list`);
      const listData = await listRes.json();
      if (listData.ok && listData.files?.length) {
        setArtifactLinks(
          listData.files.map(
            (f: { key: string; label: string }) => ({
              key: f.key,
              label: f.label,
              agent:
                BASE_ARTIFACT_LINKS.find((b) => b.key === f.key)?.agent ??
                (f.key.startsWith("pom-") ? "setDesigner" : "scriptAnalyst"),
            }),
          ),
        );
      }
    }
  }, []);

  useEffect(() => {
    if (!runId || !loading) return;
    const t = setInterval(() => void pollRun(runId), 2000);
    return () => clearInterval(t);
  }, [runId, loading, pollRun]);

  async function startPipeline() {
    if (!projectId || !canRunPipeline) return;
    setLoading(true);
    setError(null);
    setPreview("");
    setPreviewMeta("");
    setArtifactLinks([...BASE_ARTIFACT_LINKS]);
    setProgress(null);
    try {
      const res = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "start failed",
        );
      }
      setRunId(data.runId);
      void pollRun(data.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  async function loadArtifact(name: string) {
    if (!runId) return;
    const res = await fetch(`/api/pipeline/runs/${runId}/artifacts/${encodeURIComponent(name)}`);
    const text = await res.text();
    setPreview(text);
    if (name === "registry") {
      try {
        const reg = JSON.parse(text) as {
          components?: unknown[];
          scanStats?: { componentsFound?: number };
        };
        const count =
          reg.components?.length ?? reg.scanStats?.componentsFound ?? 0;
        setPreviewMeta(`组件数: ${count}`);
      } catch {
        setPreviewMeta("");
      }
    } else {
      setPreviewMeta("");
    }
  }

  function stepStatus(agentId: string): "done" | "active" | "pending" {
    if (progress?.completedAgents?.includes(agentId)) return "done";
    if (progress?.currentAgent === agentId) return "active";
    return "pending";
  }

  return (
    <div className="app">
      <header>
        <h1>Monday Director — Artifact 工作台</h1>
        <p>Temporal 编排 · M2 Scanner + LLM（Agent 1–4）</p>
      </header>

      <ProjectPanel
        projects={projects}
        selectedId={projectId}
        onRefresh={loadProjects}
        onSelect={setProjectId}
      />

      <div className="toolbar">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={loading}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.cloneStatus})
            </option>
          ))}
        </select>
        <button
          onClick={() => void startPipeline()}
          disabled={loading || !projectId || !canRunPipeline}
          title={
            canRunPipeline ? undefined : "请先 Clone 项目（状态 ready）"
          }
        >
          {loading ? "流水线运行中…" : "启动 Director 流水线"}
        </button>
        {runId && <span>runId: {runId.slice(0, 8)}…</span>}
      </div>

      {!canRunPipeline && selectedProject && (
        <p className="hint warn">请先 Clone 项目后再启动 pipeline</p>
      )}

      {error && <div className="error">{error}</div>}

      <div className="layout">
        <section className="panel">
          <h2>Pipeline 进度</h2>
          <ul className="steps">
            {AGENTS.map((a) => (
              <li key={a.id} className={stepStatus(a.id)}>
                <span>{a.label}</span>
                <span>{stepStatus(a.id)}</span>
              </li>
            ))}
          </ul>
          {progress?.status && (
            <p>
              状态: <strong>{progress.status}</strong>
            </p>
          )}
          {progress?.artifactRoot && (
            <p className="mono muted">{progress.artifactRoot}</p>
          )}
        </section>

        <section className="panel">
          <h2>Artifact 预览 {previewMeta && <span className="hint">({previewMeta})</span>}</h2>
          <div className="links">
            {artifactLinks.map((a) => (
              <a
                key={a.key}
                href="#"
                className={
                  stepStatus(a.agent) === "pending" && loading ? "disabled" : ""
                }
                onClick={(e) => {
                  e.preventDefault();
                  void loadArtifact(a.key);
                }}
              >
                {a.label}
              </a>
            ))}
          </div>
          <pre>{preview || "点击上方链接加载 artifact…"}</pre>
        </section>
      </div>
    </div>
  );
}
