import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import type { Project } from "../types/project.js";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://www.saucedemo.com");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ projects: Project[] }>("/api/projects");
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
      await fetchJson<Project>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          baseUrl,
          workspacePath: `/data/projects/${slug}`,
        }),
      });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">项目</h1>
        <p className="text-slate-400 text-sm">管理 Playwright 自动化测试项目</p>
      </div>

      <form onSubmit={onCreate} className="rounded-lg border border-slate-700 p-4 space-y-3 max-w-lg">
        <h2 className="font-medium">新建项目</h2>
        <input
          className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
          placeholder="项目名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
          placeholder="Base URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          required
        />
        <button type="submit" className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm">
          创建
        </button>
      </form>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <p className="text-slate-400">加载中…</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="block rounded-lg border border-slate-700 px-4 py-3 hover:border-emerald-600/50 transition-colors"
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {p.baseUrl} · {p.workflowStage} / {p.stageStatus}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
