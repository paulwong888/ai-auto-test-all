export default function HomePage() {
  return (
    <main style={{ padding: "2rem" }}>
      <h1>欢迎使用 Demo App</h1>
      <p>这是一个用于 AI 自动化测试平台审计的沙箱前端项目。</p>
      <a href="/login" data-testid="go-login">
        前往登录
      </a>
    </main>
  );
}
