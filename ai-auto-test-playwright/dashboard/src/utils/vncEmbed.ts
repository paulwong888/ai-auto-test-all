/** noVNC embed: scale remote desktop to fit iframe (recorder default 1280×960; default 1:1 clips bottom). */
export function buildVncEmbedUrl(vncUrl: string, vncToken?: string): string {
  const params = new URLSearchParams();
  params.set("resize", "scale");
  params.set("autoconnect", "true");
  params.set("reconnect", "true");
  if (vncToken) params.set("token", vncToken);
  return `${vncUrl}/vnc.html?${params.toString()}`;
}

export async function waitForVncReady(vncPageUrl: string, maxAttempts = 15): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const res = await fetch(vncPageUrl, { method: "GET" });
      if (res.ok) return true;
    } catch {
      // retry
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}
