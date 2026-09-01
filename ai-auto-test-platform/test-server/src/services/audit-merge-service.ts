import fs from "node:fs/promises";
import path from "node:path";
import { parseFeaturesDocument } from "../schemas/features.js";
import {
  modulePartialToFeatures,
  normalizeModulePartial,
} from "../schemas/module-partial.js";
import type { FeatureItem, FeaturesDocument } from "../pi/types.js";

export type { ModulePartial } from "../schemas/module-partial.js";

export class AuditMergeService {
  piAuditDir(repoPath: string): string {
    return path.join(repoPath, ".pi-audit");
  }

  modulePartialPath(repoPath: string, moduleId: string): string {
    return path.join(this.piAuditDir(repoPath), `${moduleId}.json`);
  }

  featuresPath(repoPath: string): string {
    return path.join(repoPath, "FEATURES.json");
  }

  async ensurePiAuditDir(repoPath: string): Promise<void> {
    await fs.mkdir(this.piAuditDir(repoPath), { recursive: true });
  }

  async loadModulePartial(
    repoPath: string,
    moduleId: string,
  ): Promise<{ moduleId: string; features: FeatureItem[] } | null> {
    try {
      const raw = await fs.readFile(
        this.modulePartialPath(repoPath, moduleId),
        "utf8",
      );
      const partial = normalizeModulePartial(JSON.parse(raw));
      if (partial.moduleId !== moduleId) {
        partial.moduleId = moduleId;
      }
      return {
        moduleId: partial.moduleId,
        features: modulePartialToFeatures(partial),
      };
    } catch {
      return null;
    }
  }

  mergeFeatures(
    existing: FeatureItem[],
    incoming: FeatureItem[],
    moduleId: string,
  ): FeatureItem[] {
    const byId = new Map(existing.map((f) => [f.id, f]));

    for (const feature of incoming) {
      let id = feature.id;
      if (byId.has(id) && byId.get(id) !== feature) {
        const prefixed = `${moduleId}-${id}`;
        if (byId.has(prefixed)) {
          console.warn(`[audit-merge] duplicate feature id: ${id} in module ${moduleId}`);
        } else {
          id = prefixed;
        }
      }
      byId.set(id, { ...feature, id });
    }

    return [...byId.values()];
  }

  async mergeAllPartials(
    repoPath: string,
    moduleIds: string[],
  ): Promise<FeatureItem[]> {
    let merged: FeatureItem[] = [];

    for (const moduleId of moduleIds) {
      const partial = await this.loadModulePartial(repoPath, moduleId);
      if (partial) {
        merged = this.mergeFeatures(merged, partial.features, moduleId);
      }
    }

    return merged;
  }

  async writeFeaturesDocument(
    repoPath: string,
    features: FeatureItem[],
  ): Promise<FeaturesDocument> {
    const doc: FeaturesDocument = {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      repoPath,
      features,
    };
    parseFeaturesDocument(doc);
    await fs.writeFile(
      this.featuresPath(repoPath),
      JSON.stringify(doc, null, 2) + "\n",
      "utf8",
    );
    return doc;
  }

  async mergeAndWrite(
    repoPath: string,
    moduleIds: string[],
  ): Promise<FeaturesDocument> {
    const features = await this.mergeAllPartials(repoPath, moduleIds);
    if (features.length === 0) {
      throw new Error("No module partials found to merge");
    }
    return this.writeFeaturesDocument(repoPath, features);
  }
}
