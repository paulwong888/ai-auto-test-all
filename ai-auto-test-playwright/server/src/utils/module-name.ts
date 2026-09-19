import { AppError } from "../errors.js";

const MODULE_NAME_RE = /^[a-z][a-z0-9_-]*$/i;

export function normalizeModuleName(raw: string): string {
  const name = raw.trim();
  if (!MODULE_NAME_RE.test(name)) {
    throw new AppError(
      "INVALID_MODULE_NAME",
      "moduleName must start with a letter and contain only letters, numbers, _ or -",
      422,
    );
  }
  return name;
}
