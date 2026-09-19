import { Link, Outlet, useLocation, useParams } from "react-router-dom";
import { isTabEnabled, useWorkflow } from "../hooks/useWorkflow.js";

const TABS = [
  { path: "", label: "概览", key: "overview" as const },
  { path: "record", label: "录制", key: "record" as const },
  { path: "plan", label: "计划", key: "plan" as const },
  { path: "code", label: "代码", key: "code" as const },
  { path: "run", label: "执行", key: "run" as const },
  { path: "history", label: "历史", key: "run" as const },
];

export function Layout() {
  const { id } = useParams();
  const location = useLocation();
  const base = id ? `/projects/${id}` : "";
  const { workflow } = useWorkflow(id);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/projects" className="text-lg font-semibold text-emerald-400">
            AI Auto Test Playwright
          </Link>
          {id && (
            <span className="text-sm text-slate-400 font-mono truncate max-w-md">{id}</span>
          )}
        </div>
      </header>

      {id && (
        <nav className="border-b border-slate-800 bg-slate-900/50 px-6">
          <div className="max-w-6xl mx-auto flex gap-1">
            {TABS.map((tab) => {
              const href = tab.path ? `${base}/${tab.path}` : base;
              const active =
                tab.path === ""
                  ? location.pathname === base
                  : location.pathname.startsWith(`${base}/${tab.path}`);
              const enabled = isTabEnabled(tab.key, workflow);
              const className = `px-4 py-3 text-sm border-b-2 transition-colors ${
                active
                  ? "border-emerald-400 text-emerald-300"
                  : enabled
                    ? "border-transparent text-slate-400 hover:text-slate-200"
                    : "border-transparent text-slate-600 cursor-not-allowed opacity-40"
              }`;

              if (!enabled) {
                return (
                  <span key={tab.path || "overview"} className={className} title="尚未到达该阶段">
                    {tab.label}
                  </span>
                );
              }

              return (
                <Link key={tab.path || "overview"} to={href} className={className}>
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
