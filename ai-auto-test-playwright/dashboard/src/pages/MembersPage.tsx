import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";

interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
}

export function MembersPage() {
  const { id } = useParams<{ id: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [canInvite, setCanInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await fetchJson<{ members: Member[] }>(`/api/projects/${id}/members`);
      setMembers(data.members);
      setCanInvite(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败";
      setError(message);
      if (message.includes("403") || message.toLowerCase().includes("permission")) {
        setCanInvite(false);
      }
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const onInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/projects/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      setEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (userId: string) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/projects/${id}/members/${userId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">项目成员</h1>
          <p className="text-slate-400 text-sm mt-1">管理 editor / viewer 角色</p>
        </div>
        {id && (
          <Link to={`/projects/${id}`} className="text-sm text-emerald-400 hover:underline">
            返回概览
          </Link>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="rounded-lg border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="text-left px-4 py-2">邮箱</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-left px-4 py-2">角色</th>
              {canInvite && <th className="text-right px-4 py-2">操作</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t border-slate-800">
                <td className="px-4 py-2 font-mono text-xs">{m.email}</td>
                <td className="px-4 py-2">{m.displayName ?? "—"}</td>
                <td className="px-4 py-2">{m.role}</td>
                {canInvite && (
                  <td className="px-4 py-2 text-right">
                    {m.role !== "owner" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onRemove(m.userId)}
                        className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                      >
                        移除
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canInvite && (
        <form onSubmit={(e) => void onInvite(e)} className="rounded-lg border border-slate-700 p-4 space-y-3 max-w-md">
          <h2 className="font-medium">邀请成员</h2>
          <input
            className="w-full rounded bg-slate-900 border border-slate-600 px-3 py-2 text-sm"
            placeholder="已注册用户的邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="w-full rounded bg-slate-900 border border-slate-600 px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
          >
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-50"
          >
            {busy ? "提交中…" : "邀请"}
          </button>
        </form>
      )}
    </div>
  );
}
