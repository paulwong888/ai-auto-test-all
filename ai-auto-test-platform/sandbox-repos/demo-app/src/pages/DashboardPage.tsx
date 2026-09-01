export default function DashboardPage() {
  return (
    <main style={{ padding: "2rem" }}>
      <h1>控制台</h1>
      <p role="status">登录成功，欢迎回来！</p>
      <section aria-label="统计概览">
        <h2>今日概览</h2>
        <ul>
          <li>活跃用户：128</li>
          <li>待办事项：5</li>
        </ul>
      </section>
    </main>
  );
}
