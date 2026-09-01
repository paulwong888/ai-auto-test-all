import type { Project } from "../types/project";

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onManage: () => void;
}

export default function ProjectSelector({
  projects,
  selectedId,
  onSelect,
  onManage,
}: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-xs text-slate-500" htmlFor="project-select">
        當前專案
      </label>
      <select
        id="project-select"
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        disabled={projects.length === 0}
        className="text-xs rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 min-w-[160px]"
      >
        {projects.length === 0 ? (
          <option value="">暫無專案</option>
        ) : (
          projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))
        )}
      </select>
      <button
        type="button"
        onClick={onManage}
        className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700"
      >
        管理專案
      </button>
    </div>
  );
}
