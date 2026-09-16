import type { E2eAuthConfig } from "../types.js";

export function parseE2eAuthFromRow(value: unknown): E2eAuthConfig | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return parseE2eAuthFromRow(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;
  const username = obj.username;
  const password = obj.password;
  if (typeof username !== "string" || !username.trim()) return null;
  if (typeof password !== "string" || !password) return null;

  const config: E2eAuthConfig = {
    username: username.trim(),
    password,
  };

  if (typeof obj.caseUsername === "string" && obj.caseUsername.trim()) {
    config.caseUsername = obj.caseUsername.trim();
  }
  if (typeof obj.casePassword === "string" && obj.casePassword) {
    config.casePassword = obj.casePassword;
  }
  if (typeof obj.corpUsername === "string" && obj.corpUsername.trim()) {
    config.corpUsername = obj.corpUsername.trim();
  }
  if (typeof obj.corpPassword === "string" && obj.corpPassword) {
    config.corpPassword = obj.corpPassword;
  }

  return config;
}

export function e2eAuthToEnv(auth: E2eAuthConfig): Record<string, string> {
  const env: Record<string, string> = {
    E2E_USERNAME: auth.username,
    E2E_PASSWORD: auth.password,
    E2E_CASE_USERNAME: auth.caseUsername ?? auth.username,
    E2E_CASE_PASSWORD: auth.casePassword ?? auth.password,
  };

  if (auth.corpUsername) {
    env.E2E_CORP_USERNAME = auth.corpUsername;
  }
  if (auth.corpPassword) {
    env.E2E_CORP_PASSWORD = auth.corpPassword;
  }

  return env;
}

export type E2eAuthUpdateInput = {
  username?: string;
  password?: string;
  caseUsername?: string;
  casePassword?: string;
  corpUsername?: string;
  corpPassword?: string;
};

export function mergeE2eAuthUpdate(
  existing: E2eAuthConfig | null,
  update: E2eAuthUpdateInput,
): E2eAuthConfig | null {
  if (!existing && !update.username && !update.password) {
    return null;
  }

  const base = existing ?? {
    username: update.username?.trim() ?? "",
    password: update.password ?? "",
  };

  const merged: E2eAuthConfig = {
    username: update.username?.trim() ?? base.username,
    password:
      update.password !== undefined && update.password !== ""
        ? update.password
        : base.password,
  };

  if (update.caseUsername !== undefined) {
    const trimmed = update.caseUsername.trim();
    if (trimmed) merged.caseUsername = trimmed;
    else delete merged.caseUsername;
  } else if (base.caseUsername) {
    merged.caseUsername = base.caseUsername;
  }

  if (update.casePassword !== undefined) {
    if (update.casePassword) merged.casePassword = update.casePassword;
    else delete merged.casePassword;
  } else if (base.casePassword) {
    merged.casePassword = base.casePassword;
  }

  if (update.corpUsername !== undefined) {
    const trimmed = update.corpUsername.trim();
    if (trimmed) merged.corpUsername = trimmed;
    else delete merged.corpUsername;
  } else if (base.corpUsername) {
    merged.corpUsername = base.corpUsername;
  }

  if (update.corpPassword !== undefined) {
    if (update.corpPassword) merged.corpPassword = update.corpPassword;
    else delete merged.corpPassword;
  } else if (base.corpPassword) {
    merged.corpPassword = base.corpPassword;
  }

  if (!merged.username || !merged.password) {
    return null;
  }

  return merged;
}
