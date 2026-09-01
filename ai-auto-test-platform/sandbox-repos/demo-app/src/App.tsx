import { Link, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";

export default function App() {
  return (
    <div>
      <nav style={{ padding: "1rem 2rem", background: "#1e293b", color: "#fff" }}>
        <Link to="/" style={{ color: "#fff", marginRight: "1rem" }}>
          首页
        </Link>
        <Link to="/login" style={{ color: "#fff", marginRight: "1rem" }}>
          登录
        </Link>
        <Link to="/dashboard" style={{ color: "#fff" }}>
          控制台
        </Link>
      </nav>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </div>
  );
}
