import type { UpdateFeatureInput } from "../schemas/feature-manual.js";
import type { FeatureItem } from "../pi/types.js";
import { FeaturesRepository } from "../repositories/features-repository.js";

export class FeatureService {
  constructor(private readonly repo: FeaturesRepository = new FeaturesRepository()) {}

  async getFeature(projectId: string, featureId: string): Promise<FeatureItem | null> {
    return this.repo.getFeature(projectId, featureId);
  }

  async updateFeature(
    projectId: string,
    featureId: string,
    input: UpdateFeatureInput,
  ): Promise<FeatureItem> {
    return this.repo.updateFeatureManual(projectId, featureId, {
      title: input.title,
      description: input.description,
      sourceFile: input.sourceFile,
      route: input.route,
      gherkin: input.gherkin,
      gherkinText: input.gherkinText,
      manualConfig: input.manualConfig,
    });
  }
}
