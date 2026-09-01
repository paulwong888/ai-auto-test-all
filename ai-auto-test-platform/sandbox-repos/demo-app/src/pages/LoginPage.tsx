import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === "admin" && password === "123456") {
      navigate("/dashboard");
      return;
    }
    setError("用户名或密码错误");
  };

  return (
    <main style={{ padding: "2rem", maxWidth: 400, margin: "0 auto" }}>
      <h1>用户登录</h1>
      <form onSubmit={handleSubmit} aria-label="登录表单">
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="username">用户名</label>
          <input
            id="username"
            name="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-label="用户名"
            style={{ display: "block", width: "100%", padding: "0.5rem" }}
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="password">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="密码"
            style={{ display: "block", width: "100%", padding: "0.5rem" }}
          />
        </div>
        {error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )}
        <button type="submit" aria-label="登录按钮">
          登录
        </button>
      </form>
    </main>
  );
}
