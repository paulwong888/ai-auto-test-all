import { createHash } from "node:crypto";

export type VncTokenKind = "record" | "run";

export function createVncToken(subjectId: string, userId: string, kind: VncTokenKind): string {
  const secret = process.env.JWT_SECRET ?? "dev-jwt-secret";
  const payload = Buffer.from(
    JSON.stringify({ subjectId, kind, userId, exp: Date.now() + 300_000 }),
  ).toString("base64url");
  const sig = createHash("sha256").update(`${payload}.${secret}`).digest("base64url");
  return `${payload}.${sig}`;
}

/** @deprecated Use createVncToken(sessionId, userId, "record") */
export function createRecordVncToken(sessionId: string, userId: string): string {
  return createVncToken(sessionId, userId, "record");
}

export function verifyVncToken(token: string, subjectId: string, kind: VncTokenKind): string | null {
  const secret = process.env.JWT_SECRET ?? "dev-jwt-secret";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHash("sha256").update(`${payload}.${secret}`).digest("base64url");
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      subjectId?: string;
      sessionId?: string;
      kind?: VncTokenKind;
      userId?: string;
      exp?: number;
    };
    if (!data.userId || !data.exp || Date.now() > data.exp) return null;
    const id = data.subjectId ?? data.sessionId;
    if (!id || id !== subjectId) return null;
    if (data.kind && data.kind !== kind) return null;
    if (!data.kind && kind !== "record") return null;
    return data.userId;
  } catch {
    return null;
  }
}
