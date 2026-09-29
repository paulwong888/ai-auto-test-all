/** Default moduleName from project workspace slug, e.g. /data/projects/sales-portal → sales-portal */
export function defaultModuleFromWorkspace(workspacePath: string): string {
  const seg = workspacePath.split("/").filter(Boolean).pop();
  if (!seg) return "project";
  return seg.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-|-$/g, "") || "project";
}
