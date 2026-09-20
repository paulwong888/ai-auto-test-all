export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

function authHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem("authToken");
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && init?.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function handleUnauthorized(status: number): void {
  if (status !== 401) return;
  localStorage.removeItem("authToken");
  if (!window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/register")) {
    window.location.href = "/login";
  }
}

export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, { ...init, headers: authHeaders(init) });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || !body.ok) {
    handleUnauthorized(res.status);
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

export async function uploadFile(
  path: string,
  formData: FormData,
): Promise<unknown> {
  const res = await fetch(path, { method: "POST", body: formData, headers: authHeaders() });
  const body = (await res.json()) as ApiResponse<unknown>;
  if (!res.ok || !body.ok) {
    handleUnauthorized(res.status);
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return body.data;
}
