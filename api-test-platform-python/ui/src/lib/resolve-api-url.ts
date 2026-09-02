/**
 * Resolve a relative API URL (e.g. "/api") to an absolute URL for the LangGraph SDK.
 * The SDK uses `new URL(apiUrl)` internally, which rejects relative paths in the browser.
 */
export function resolveApiUrl(apiUrl: string): string {
  if (!apiUrl) return apiUrl;
  if (typeof window === "undefined") return apiUrl;
  try {
    new URL(apiUrl);
    return apiUrl;
  } catch {
    return new URL(apiUrl, window.location.origin).href;
  }
}
