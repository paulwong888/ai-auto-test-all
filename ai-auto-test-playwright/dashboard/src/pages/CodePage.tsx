import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";

interface FileEntry {
  path: string;
  content: string;
}

export function CodePage() {
  const { id } = useParams<{ id: string }>();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void fetchJson<{ files: FileEntry[] }>(`/api/projects/${id}/files`)
      .then((data) => {
        setFiles(data.files ?? []);
        if (data.files?.[0]) setSelected(data.files[0].path);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [id]);

  const current = files.find((f) => f.path === selected);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">代码预览</h1>
        <p className="text-slate-400 text-sm mt-1">只读查看生成的测试代码</p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 min-h-[480px]">
        <ul className="rounded-lg border border-slate-700 overflow-hidden text-sm">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => setSelected(f.path)}
                className={`w-full text-left px-3 py-2 font-mono text-xs truncate hover:bg-slate-800 ${
                  selected === f.path ? "bg-slate-800 text-emerald-300" : "text-slate-400"
                }`}
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
        <pre className="md:col-span-3 rounded-lg border border-slate-700 bg-slate-900/80 p-4 text-xs font-mono overflow-auto">
          {current?.content ?? "选择文件查看内容"}
        </pre>
      </div>
    </div>
  );
}
