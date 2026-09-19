import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchJson } from "../api/client.js";

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const data = await fetchJson<{ token: string }>(`/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName: displayName || undefined }),
      });
      localStorage.setItem("authToken", data.token);
      navigate("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm space-y-4 rounded border border-slate-700 p-6">
        <h1 className="text-xl font-semibold">注册</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input
          className="w-full rounded bg-slate-900 border border-slate-600 px-3 py-2 text-sm"
          placeholder="显示名"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          className="w-full rounded bg-slate-900 border border-slate-600 px-3 py-2 text-sm"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          className="w-full rounded bg-slate-900 border border-slate-600 px-3 py-2 text-sm"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="w-full py-2 rounded bg-emerald-600 text-sm">
          注册
        </button>
        <p className="text-sm text-slate-400">
          已有账号？ <Link to="/login" className="text-emerald-400">登录</Link>
        </p>
      </form>
    </div>
  );
}
