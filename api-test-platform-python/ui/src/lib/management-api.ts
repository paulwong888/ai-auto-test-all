/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

/**
 * Management API client — talks to the FastAPI backend.
 *
 * The agent server and the management API are separate
 * services. This client lets the UI trigger platform operations such as code
 * analysis, test execution and endpoint synchronisation directly, while the
 * chat agent uses the same operations through its tools.
 */

const MANAGEMENT_API_URL =
  process.env.NEXT_PUBLIC_MANAGEMENT_API_URL ?? "/management-api";

function getUrl(path: string): string {
  const base = MANAGEMENT_API_URL.replace(/\/$/, "");
  return `${base}${path}`;
}

async function fetchJson(
  path: string,
  options?: RequestInit,
): Promise<unknown> {
  const res = await fetch(getUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Management API error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface AnalyzeRequest {
  project_id?: string;
  project_path?: string;
  base_branch?: string;
}

export interface TestRequest {
  project_id?: string;
  test_path?: string;
  marker?: string;
  parallel?: number;
}

export interface EndpointSyncRequest {
  project_id: string;
}

export interface ProjectCreateRequest {
  name: string;
  repo_url?: string;
  openapi_spec?: string;
  base_url?: string;
  description?: string;
}

export async function analyzeCode(body: AnalyzeRequest): Promise<unknown> {
  return fetchJson("/api/analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function runTests(body: TestRequest): Promise<unknown> {
  return fetchJson("/api/test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listEndpoints(projectId?: string): Promise<unknown[]> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  return fetchJson(`/api/endpoints${qs}`) as Promise<unknown[]>;
}

export async function syncEndpoints(
  body: EndpointSyncRequest,
): Promise<unknown> {
  return fetchJson("/api/endpoints/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listProjects(): Promise<unknown[]> {
  return fetchJson("/api/projects") as Promise<unknown[]>;
}

export async function getProject(id: string): Promise<unknown> {
  return fetchJson(`/api/projects/${id}`);
}

export async function createProject(body: ProjectCreateRequest): Promise<unknown> {
  return fetchJson("/api/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listRuns(projectId?: string): Promise<unknown[]> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  return fetchJson(`/api/runs${qs}`) as Promise<unknown[]>;
}

export async function listReports(
  projectId?: string,
  reportType?: string,
): Promise<unknown[]> {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", projectId);
  if (reportType) params.set("report_type", reportType);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchJson(`/api/reports${qs}`) as Promise<unknown[]>;
}
