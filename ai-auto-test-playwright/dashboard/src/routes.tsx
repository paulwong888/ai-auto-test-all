import { createBrowserRouter, Navigate } from "react-router-dom";
import { AuthGuard } from "./components/AuthGuard.js";
import { Layout } from "./components/Layout.js";
import { CodePage } from "./pages/CodePage.js";
import { FixReviewPage } from "./pages/FixReviewPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MembersPage } from "./pages/MembersPage.js";
import { PlanPage } from "./pages/PlanPage.js";
import { ProjectOverviewPage } from "./pages/ProjectOverviewPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { RecordPage } from "./pages/RecordPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { ReportPage } from "./pages/ReportPage.js";
import { RunPage } from "./pages/RunPage.js";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    path: "/",
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "projects/:id", element: <ProjectOverviewPage /> },
      { path: "projects/:id/settings/members", element: <MembersPage /> },
      { path: "projects/:id/record", element: <RecordPage /> },
      { path: "projects/:id/plan", element: <PlanPage /> },
      { path: "projects/:id/code", element: <CodePage /> },
      { path: "projects/:id/run", element: <RunPage /> },
      { path: "projects/:id/history", element: <HistoryPage /> },
      { path: "projects/:id/fix/:runId", element: <FixReviewPage /> },
      { path: "projects/:id/report/:runId", element: <ReportPage /> },
    ],
  },
]);
