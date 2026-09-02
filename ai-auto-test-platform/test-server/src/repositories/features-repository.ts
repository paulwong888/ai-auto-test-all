import { query } from "../db/pool.js";
import { featureItemSchema, parseFeaturesDocument, renderGherkinText } from "../schemas/features.js";
import {
  manualConfigSchema,
  type FeatureSource,
  type ManualConfig,
} from "../schemas/feature-manual.js";
import type { FeatureItem, FeaturesDocument, GherkinSteps } from "../pi/types.js";

interface FeatureSetRow {
  project_id: string;
  version: string;
  generated_at: Date;
  repo_path: string;
  updated_at: Date;
}

interface ProjectFeatureRow {
  project_id: string;
  feature_id: string;
  title: string;
  description: string;
  source_file: string;
  route: string | null;
  gherkin: GherkinSteps;
  gherkin_text: string;
  manual_config: ManualConfig;
  source: FeatureSource;
  created_at: Date;
  updated_at: Date;
}

function rowToFeatureItem(row: ProjectFeatureRow): FeatureItem {
  const item = featureItemSchema.parse({
    id: row.feature_id,
    title: row.title,
    description: row.description,
    sourceFile: row.source_file,
    route: row.route ?? undefined,
    gherkin: row.gherkin,
    gherkinText: row.gherkin_text,
  });
  return {
    ...item,
    manualConfig: row.manual_config,
    source: row.source,
  };
}

export class FeaturesRepository {
  async hasFeatureSet(projectId: string): Promise<boolean> {
    const result = await query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM feature_sets WHERE project_id = $1) AS exists",
      [projectId],
    );
    return result.rows[0]?.exists ?? false;
  }

  async getDocument(projectId: string): Promise<FeaturesDocument | null> {
    const metaResult = await query<FeatureSetRow>(
      "SELECT * FROM feature_sets WHERE project_id = $1",
      [projectId],
    );
    const meta = metaResult.rows[0];
    if (!meta) return null;

    const featuresResult = await query<ProjectFeatureRow>(
      "SELECT * FROM project_features WHERE project_id = $1 ORDER BY feature_id ASC",
      [projectId],
    );
    if (featuresResult.rows.length === 0) return null;

    return {
      version: meta.version as "1.0",
      generatedAt: meta.generated_at.toISOString(),
      repoPath: meta.repo_path,
      features: featuresResult.rows.map(rowToFeatureItem),
    };
  }

  async getFeature(projectId: string, featureId: string): Promise<FeatureItem | null> {
    const result = await query<ProjectFeatureRow>(
      "SELECT * FROM project_features WHERE project_id = $1 AND feature_id = $2",
      [projectId, featureId],
    );
    return result.rows[0] ? rowToFeatureItem(result.rows[0]) : null;
  }

  async upsertFeatureSetMeta(
    projectId: string,
    meta: { version: string; generatedAt: string; repoPath: string },
  ): Promise<void> {
    await query(
      `INSERT INTO feature_sets (project_id, version, generated_at, repo_path, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (project_id) DO UPDATE SET
         version = EXCLUDED.version,
         generated_at = EXCLUDED.generated_at,
         repo_path = EXCLUDED.repo_path,
         updated_at = NOW()`,
      [projectId, meta.version, meta.generatedAt, meta.repoPath],
    );
  }

  async upsertFeaturesFromAudit(
    projectId: string,
    repoPath: string,
    features: FeatureItem[],
    source: FeatureSource = "audit",
  ): Promise<FeaturesDocument> {
    const now = new Date().toISOString();
    await this.upsertFeatureSetMeta(projectId, {
      version: "1.0",
      generatedAt: now,
      repoPath,
    });

    for (const feature of features) {
      await this.upsertFeatureFromAudit(projectId, feature, source);
    }

    const doc = await this.getDocument(projectId);
    if (!doc) {
      throw new Error(`Failed to persist features for project ${projectId}`);
    }
    parseFeaturesDocument(doc);
    return doc;
  }

  async upsertFeatureFromAudit(
    projectId: string,
    feature: FeatureItem,
    source: FeatureSource = "audit",
  ): Promise<void> {
    const parsed = featureItemSchema.parse(feature);
    await query(
      `INSERT INTO project_features (
         project_id, feature_id, title, description, source_file, route,
         gherkin, gherkin_text, source, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (project_id, feature_id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         source_file = EXCLUDED.source_file,
         route = EXCLUDED.route,
         gherkin = EXCLUDED.gherkin,
         gherkin_text = EXCLUDED.gherkin_text,
         source = EXCLUDED.source,
         updated_at = NOW()
       WHERE project_features.source <> 'manual'`,
      [
        projectId,
        parsed.id,
        parsed.title,
        parsed.description,
        parsed.sourceFile,
        parsed.route ?? null,
        JSON.stringify(parsed.gherkin),
        parsed.gherkinText,
        source,
      ],
    );
  }

  async updateFeatureManual(
    projectId: string,
    featureId: string,
    patch: {
      title?: string;
      description?: string;
      sourceFile?: string;
      route?: string;
      gherkin?: GherkinSteps;
      gherkinText?: string;
      manualConfig?: ManualConfig;
    },
  ): Promise<FeatureItem> {
    const current = await this.getFeature(projectId, featureId);
    if (!current) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    const gherkin = patch.gherkin ?? current.gherkin;
    const gherkinText =
      patch.gherkinText ?? (patch.gherkin ? renderGherkinText(patch.gherkin) : current.gherkinText);
    const manualConfig = patch.manualConfig ?? current.manualConfig ?? {};

    await query(
      `UPDATE project_features SET
         title = $3,
         description = $4,
         source_file = $5,
         route = $6,
         gherkin = $7,
         gherkin_text = $8,
         manual_config = $9,
         source = 'manual',
         updated_at = NOW()
       WHERE project_id = $1 AND feature_id = $2`,
      [
        projectId,
        featureId,
        patch.title ?? current.title,
        patch.description ?? current.description,
        patch.sourceFile ?? current.sourceFile,
        patch.route ?? current.route ?? null,
        JSON.stringify(gherkin),
        gherkinText,
        JSON.stringify(manualConfigSchema.parse(manualConfig)),
      ],
    );

    const updated = await this.getFeature(projectId, featureId);
    if (!updated) {
      throw new Error(`Feature not found after update: ${featureId}`);
    }
    return updated;
  }

  async upsertPartial(
    projectId: string,
    moduleId: string,
    features: FeatureItem[],
  ): Promise<void> {
    await query(
      `INSERT INTO audit_module_partials (project_id, module_id, features, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (project_id, module_id) DO UPDATE SET
         features = EXCLUDED.features,
         updated_at = NOW()`,
      [projectId, moduleId, JSON.stringify(features)],
    );
  }

  async loadPartial(
    projectId: string,
    moduleId: string,
  ): Promise<{ moduleId: string; features: FeatureItem[] } | null> {
    const result = await query<{ module_id: string; features: FeatureItem[] }>(
      "SELECT module_id, features FROM audit_module_partials WHERE project_id = $1 AND module_id = $2",
      [projectId, moduleId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const features = (row.features as FeatureItem[]).map((f) => featureItemSchema.parse(f));
    return { moduleId: row.module_id, features };
  }

  async listPartialModuleIds(projectId: string): Promise<string[]> {
    const result = await query<{ module_id: string }>(
      "SELECT module_id FROM audit_module_partials WHERE project_id = $1 ORDER BY module_id",
      [projectId],
    );
    return result.rows.map((r) => r.module_id);
  }

  async deletePartials(projectId: string): Promise<void> {
    await query("DELETE FROM audit_module_partials WHERE project_id = $1", [projectId]);
  }

  async importDocument(projectId: string, doc: FeaturesDocument, source: FeatureSource): Promise<void> {
    parseFeaturesDocument(doc);
    await this.upsertFeaturesFromAudit(projectId, doc.repoPath, doc.features, source);
  }
}
