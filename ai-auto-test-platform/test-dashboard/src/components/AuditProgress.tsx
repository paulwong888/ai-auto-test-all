import type { AuditModuleJobState, AuditModuleJobStatus } from "../types/audit";

function statusLabel(status: AuditModuleJobStatus): string {
  switch (status) {
    case "running":
      return "進行中";
    case "completed":
      return "完成";
    case "failed":
      return "失敗";
    case "skipped":
      return "略過";
    default:
      return "待處理";
  }
}

function statusClass(status: AuditModuleJobStatus): string {
  switch (status) {
    case "running":
      return "text-amber-400";
    case "completed":
      return "text-emerald-400";
    case "failed":
      return "text-red-400";
    default:
      return "text-slate-500";
  }
}

interface AuditProgressProps {
  modules: AuditModuleJobState[];
  featureCount: number;
  active: boolean;
}

export default function AuditProgress({
  modules,
  featureCount,
  active,
}: AuditProgressProps) {
  if (!active && modules.length === 0) return null;

  const done = modules.filter((m) => m.status === "completed").length;

  return (
    <div className="mx-6 mb-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-medium text-slate-300">完整審計進度</h3>
        <span className="text-xs text-slate-500">
          {done}/{modules.length} 模組 · 累計 {featureCount} 條
        </span>
      </div>
      <ul className="space-y-1.5 max-h-48 overflow-y-auto">
        {modules.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between gap-2 text-xs py-1 border-b border-slate-800/50 last:border-0"
          >
            <span className="text-slate-300 truncate">{m.title}</span>
            <span className={`shrink-0 ${statusClass(m.status)}`}>
              {statusLabel(m.status)}
              {m.featureCount != null && m.status === "completed"
                ? ` (${m.featureCount})`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
