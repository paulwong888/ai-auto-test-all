import { mkdir, readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import type { JourneysDocument, LocatorCatalog } from "../artifacts/types.js";
import { enrichPomsForJourneys, repairPomsInDirectory } from "./pom-utils.js";

export interface MaterializeResult {
  specFiles: string[];
  pomFiles: string[];
  e2eDir: string;
}

function rewriteSpecImports(content: string): string {
  return content
    .replace(/from ['"]\.\.\/poms\//g, "from './poms/")
    .replace(/from ['"]\.\.\/\.\.\/poms\//g, "from './poms/");
}

export async function materializeArtifacts(
  artifactRoot: string,
  repoRoot: string,
): Promise<MaterializeResult> {
  const e2eDir = path.join(repoRoot, "tests", "e2e");
  const pomDest = path.join(e2eDir, "poms");
  await mkdir(pomDest, { recursive: true });

  const specFiles: string[] = [];
  const pomFiles: string[] = [];

  const testsDir = path.join(artifactRoot, "tests");
  try {
    const specs = (await readdir(testsDir)).filter((f) => f.endsWith(".spec.ts"));
    for (const file of specs) {
      const content = await readFile(path.join(testsDir, file), "utf8");
      const dest = path.join(e2eDir, file);
      await writeFile(dest, rewriteSpecImports(content), "utf8");
      specFiles.push(dest);
    }
  } catch {
    // no generated tests
  }

  try {
    const catalogRaw = await readFile(
      path.join(artifactRoot, "locator-catalog.json"),
      "utf8",
    );
    const catalog = JSON.parse(catalogRaw) as LocatorCatalog;
    try {
      const journeysRaw = await readFile(
        path.join(artifactRoot, "journeys.json"),
        "utf8",
      );
      const journeysDoc = JSON.parse(journeysRaw) as JourneysDocument;
      await enrichPomsForJourneys(
        journeysDoc.journeys,
        path.join(artifactRoot, "poms"),
        catalog,
      );
    } catch {
      // journeys may be missing during partial runs
    }
    await repairPomsInDirectory(path.join(artifactRoot, "poms"), catalog);
  } catch {
    // catalog or poms may be missing
  }

  const pomsDir = path.join(artifactRoot, "poms");
  try {
    const poms = (await readdir(pomsDir)).filter((f) => f.endsWith(".ts"));
    for (const file of poms) {
      const src = path.join(pomsDir, file);
      const dest = path.join(pomDest, file);
      await copyFile(src, dest);
      pomFiles.push(dest);
    }
  } catch {
    // no poms
  }

  return { specFiles, pomFiles, e2eDir };
}
