import type { FeatureItem, FeaturesDocument } from "../pi/types.js";
import {
  modulePartialToFeatures,
  normalizeModulePartial,
} from "../schemas/module-partial.js";
import { FeaturesRepository } from "../repositories/features-repository.js";

export type { ModulePartial } from "../schemas/module-partial.js";

export class AuditMergeService {
  constructor(private readonly featuresRepo: FeaturesRepository = new FeaturesRepository()) {}

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

  async loadModulePartial(
    projectId: string,
    moduleId: string,
  ): Promise<{ moduleId: string; features: FeatureItem[] } | null> {
    return this.featuresRepo.loadPartial(projectId, moduleId);
  }

  async saveModulePartial(
    projectId: string,
    moduleId: string,
    partialRaw: unknown,
  ): Promise<{ moduleId: string; features: FeatureItem[] }> {
    const partial = normalizeModulePartial(partialRaw);
    if (partial.moduleId !== moduleId) {
      partial.moduleId = moduleId;
    }
    const features = modulePartialToFeatures(partial);
    await this.featuresRepo.upsertPartial(projectId, moduleId, features);
    return { moduleId, features };
  }

  async mergeAllPartials(
    projectId: string,
    moduleIds: string[],
  ): Promise<FeatureItem[]> {
    let merged: FeatureItem[] = [];

    for (const moduleId of moduleIds) {
      const partial = await this.loadModulePartial(projectId, moduleId);
      if (partial) {
        merged = this.mergeFeatures(merged, partial.features, moduleId);
      }
    }

    return merged;
  }

  async mergeAndPersist(
    projectId: string,
    repoPath: string,
    moduleIds: string[],
  ): Promise<FeaturesDocument> {
    const features = await this.mergeAllPartials(projectId, moduleIds);
    if (features.length === 0) {
      throw new Error("No module partials found to merge");
    }
    const doc = await this.featuresRepo.upsertFeaturesFromAudit(projectId, repoPath, features);
    await this.featuresRepo.deletePartials(projectId);
    return doc;
  }
}
