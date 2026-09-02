import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { parseFeaturesDocument } from "../schemas/features.js";
import type { AuditModule } from "../schemas/audit-profile.js";
import { PiRpcClient } from "../pi/rpc-client.js";
import type { AuditProgressEvent, FeaturesDocument } from "../pi/types.js";
import type { ProjectService } from "./project-service.js";
import { AuditMergeService } from "./audit-merge-service.js";
import { AuditProfileService } from "./audit-profile-service.js";
import { extractJsonFromText } from "./extract-json-from-text.js";
import { FeaturesRepository } from "../repositories/features-repository.js";

const FEATURES_JSON_SCHEMA = `
\`\`\`json
{
  "version": "1.0",
  "generatedAt": "<ISO8601 時間戳>",
  "repoPath": "<倉庫絕對路徑>",
  "features": [
    {
      "id": "kebab-case-id",
      "title": "功能標題（繁體中文）",
      "description": "功能描述（繁體中文）",
      "sourceFile": "src/pages/Example.tsx",
      "route": "/example",
      "gherkin": {
        "scenario": "場景名稱（繁體中文）",
        "given": ["假設條件1"],
        "when": ["使用者操作1", "使用者操作2"],
        "then": ["預期結果1"],
        "and": ["可選附加步驟"]
      },
      "gherkinText": "Scenario: ...\\n  Given ...\\n  When ...\\n  Then ..."
    }
  ]
}
\`\`\``;

const MODULE_PARTIAL_SCHEMA = `
\`\`\`json
{
  "moduleId": "<模組 id>",
  "features": [ /* 同上 features 陣列，5～8 條 */ ]
}
\`\`\``;

const CORE_AUDIT_PROMPT = `【核心審計任務】

請分析本倉庫的前端路由與核心使用者互動流程，產出 Gherkin 測試劇本。

**路由探索（依專案結構擇一，勿 exhaustive 通讀所有模組）：**
1. 先讀 \`src/App.js\`、\`src/App.tsx\` 或 \`src/router/\` 取得路由表。
2. 若無 \`src/pages/\`，改看 \`src/Case/\`、\`src/components/view/\` 等實際頁面目錄。
3. **僅深入 6～8 個最核心的使用者流程**（例如：首頁、搜尋、建立、檢視、審批、報表），其餘模組可略過。

**產出要求：**
在回覆**最末尾**輸出完整 JSON（\`\`\`json 代碼塊），結構如下：
${FEATURES_JSON_SCHEMA}

要求：
1. 產生 **6～8 條** Scenario，每條對應一個核心流程（大型專案勿超過 10 條）。
2. \`gherkinText\` 必須是標準 Gherkin 格式（Given/When/Then/And，每行前兩個空格縮排）。
3. **所有 title、description、scenario、步驟文字必須使用繁體中文**，面向非技術使用者。
4. 審計階段禁止修改 \`src/\` 業務程式碼，**禁止寫入任何檔案**。
5. **必須在回覆末尾輸出完整 JSON 代碼塊後才可結束**；禁止只在分析文字中描述而不輸出 JSON。`;

const CORE_WRITE_RETRY_PROMPT = `【審計補寫任務】

你剛才已完成程式碼分析，但回覆中 **尚未包含有效的 JSON 代碼塊**。

請**立即**在回覆最末尾輸出完整 JSON（\`\`\`json 代碼塊），結構如下：
${FEATURES_JSON_SCHEMA}

要求：
1. 至少 6 條、最多 10 條 Scenario，繁體中文。
2. 不要繼續大量讀檔，直接輸出 JSON。
3. **JSON 代碼塊輸出完成後才可結束**。`;

function buildModuleAuditPrompt(module: AuditModule, repoPath: string): string {
  const routes = module.routes.map((r) => `- \`${r}\``).join("\n");
  const dirs =
    module.sourceDirs?.map((d) => `- \`${d}/\``).join("\n") ??
    "（依 routes 對應元件自行定位）";

  return `【分模組審計任務 · ${module.title}】

模組 id：\`${module.id}\`
倉庫路徑：\`${repoPath}\`

**本模組路由（僅分析這些，禁止通讀全倉庫）：**
${routes}

**建議閱讀目錄：**
${dirs}

**步驟：**
1. 先讀 \`src/App.js\` 或 \`src/App.tsx\` 確認上述路由對應的元件。
2. 僅深入本模組相關頁面，分析使用者互動流程。
3. 產生 **5～8 條** Scenario（本模組內主要流程，勿超過 10 條）。
4. 在回覆**最末尾**輸出 JSON 代碼塊，格式如下：
${MODULE_PARTIAL_SCHEMA}

要求：
- \`moduleId\` 必須為 \`${module.id}\`
- 每條 feature 的 \`id\` 使用 kebab-case，建議前綴 \`${module.id}-\`
- 所有文字使用**繁體中文**
- \`gherkinText\` 為標準 Gherkin（Given/When/Then/And，每行前兩空格）
- 禁止修改 \`src/\` 業務程式碼，**禁止寫入任何檔案**
- **JSON 代碼塊輸出完成後才可結束**`;
}

function buildModuleWriteRetryPrompt(module: AuditModule): string {
  return `【模組審計補寫 · ${module.title}】

你已完成分析，但回覆中 **尚未包含有效的 JSON 代碼塊**。

請**立即**在回覆最末尾輸出 JSON 代碼塊：
${MODULE_PARTIAL_SCHEMA}

要求：
- \`moduleId\` = \`${module.id}\`
- 5～8 條 Scenario，繁體中文
- 不要繼續大量讀檔，直接輸出 JSON`;
}

export type AuditMode = "core" | "full";

export interface AuditOptions {
  projectId?: string;
  /** @deprecated 优先使用 projectId */
  repoPath?: string;
  mode?: AuditMode;
  onProgress?: (event: AuditProgressEvent) => void;
  moduleIds?: string[];
  client?: PiRpcClient;
  onModuleComplete?: (moduleId: string, featureCount: number) => void;
}

export interface AuditResult {
  featuresPath: string;
  features: FeaturesDocument;
}

export interface ModuleAuditResult {
  moduleId: string;
  featureCount: number;
}

function dbFeaturesPath(projectId: string): string {
  return `db://${projectId}`;
}

export class AuditService {
  private readonly featuresRepo: FeaturesRepository;
  private readonly mergeService: AuditMergeService;
  private readonly profileService: AuditProfileService;

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
    featuresRepo?: FeaturesRepository,
  ) {
    this.featuresRepo = featuresRepo ?? new FeaturesRepository();
    this.mergeService = new AuditMergeService(this.featuresRepo);
    this.profileService = new AuditProfileService(config);
  }

  private async resolveRepoPath(options: {
    projectId?: string;
    repoPath?: string;
  }): Promise<string> {
    if (options.projectId) {
      const project = await this.projectService.resolve(options.projectId);
      return project.repoPath;
    }
    return path.resolve(options.repoPath ?? this.config.defaultSandboxRepo);
  }

  private async resolveProjectId(options: {
    projectId?: string;
    repoPath?: string;
  }): Promise<string> {
    if (options.projectId) return options.projectId;
    const repoPath = await this.resolveRepoPath(options);
    const id = await this.projectService.resolveIdByRepoPath(repoPath);
    if (!id) {
      throw new Error("projectId required (repo not registered in platform)");
    }
    return id;
  }

  private parseDocumentFromClient(client: PiRpcClient, repoPath: string): FeaturesDocument {
    const raw = extractJsonFromText(client.getLastAssistantText());
    const doc = parseFeaturesDocument(raw);
    return {
      ...doc,
      repoPath,
      generatedAt: doc.generatedAt || new Date().toISOString(),
    };
  }

  async runAudit(options: AuditOptions = {}): Promise<AuditResult> {
    const mode = options.mode ?? "core";
    if (mode === "full") {
      throw new Error("Use AuditJobService for full modular audit");
    }
    return this.runCoreAudit(options);
  }

  async runCoreAudit(options: AuditOptions): Promise<AuditResult> {
    const repoPath = await this.resolveRepoPath(options);
    const projectId = await this.resolveProjectId(options);
    const featuresPath = dbFeaturesPath(projectId);

    const emit = (event: AuditProgressEvent) => {
      options.onProgress?.(event);
    };

    emit({ kind: "started", repoPath, mode: "core" });

    await fs.access(repoPath).catch(() => {
      throw new Error(`Sandbox repo not found: ${repoPath}`);
    });

    const client = new PiRpcClient({
      cwd: repoPath,
      piCliPath: this.config.piCliPath,
      rpcArgs: [...this.config.piRpcArgs],
      onProgress: emit,
    });

    try {
      const pid = await client.start();
      emit({ kind: "pi_spawned", pid });

      const prompts = [
        { message: CORE_AUDIT_PROMPT, timeoutMs: this.config.auditTimeoutMs },
        { message: CORE_WRITE_RETRY_PROMPT, timeoutMs: 300_000 },
        { message: CORE_WRITE_RETRY_PROMPT, timeoutMs: 300_000 },
      ];

      let features: FeaturesDocument | null = null;

      for (const [index, { message, timeoutMs }] of prompts.entries()) {
        if (index > 0) {
          emit({
            kind: "error",
            message: `劇本 JSON 尚未解析成功，正在進行第 ${index} 次補寫…`,
          });
        }
        await client.promptAndWait(message, timeoutMs);
        try {
          features = this.parseDocumentFromClient(client, repoPath);
          break;
        } catch {
          features = null;
        }
      }

      if (!features) {
        throw new Error("Pi Agent finished but valid features JSON was not found in reply");
      }

      const persisted = await this.featuresRepo.upsertFeaturesFromAudit(
        projectId,
        repoPath,
        features.features,
      );

      emit({ kind: "features_loaded", features: persisted });
      emit({
        kind: "completed",
        featuresPath,
        featureCount: persisted.features.length,
        mode: "core",
      });

      return { featuresPath, features: persisted };
    } finally {
      client.stop();
    }
  }

  async runModuleAudit(
    options: AuditOptions & { module: AuditModule },
  ): Promise<ModuleAuditResult> {
    const repoPath = await this.resolveRepoPath(options);
    const projectId = await this.resolveProjectId(options);
    const { module } = options;

    const emit = (event: AuditProgressEvent) => {
      options.onProgress?.(event);
    };

    emit({
      kind: "module_started",
      moduleId: module.id,
      moduleTitle: module.title,
    });

    const ownClient = !options.client;
    const client =
      options.client ??
      new PiRpcClient({
        cwd: repoPath,
        piCliPath: this.config.piCliPath,
        rpcArgs: [...this.config.piRpcArgs],
        onProgress: emit,
      });

    if (ownClient) {
      await client.start();
    }

    try {
      const prompts = [
        {
          message: buildModuleAuditPrompt(module, repoPath),
          timeoutMs: this.config.auditModuleTimeoutMs,
        },
        {
          message: buildModuleWriteRetryPrompt(module),
          timeoutMs: 300_000,
        },
        {
          message: buildModuleWriteRetryPrompt(module),
          timeoutMs: 300_000,
        },
      ];

      let partial = null as Awaited<ReturnType<AuditMergeService["loadModulePartial"]>>;

      for (const [index, { message, timeoutMs }] of prompts.entries()) {
        if (index > 0) {
          emit({
            kind: "error",
            message: `模組 ${module.title} JSON 尚未解析成功，第 ${index} 次補寫…`,
          });
        }
        await client.promptAndWait(message, timeoutMs);
        try {
          const raw = extractJsonFromText(client.getLastAssistantText());
          partial = await this.mergeService.saveModulePartial(projectId, module.id, raw);
          break;
        } catch {
          partial = null;
        }
      }

      if (!partial) {
        throw new Error(`Module ${module.id} finished but valid partial JSON was not found in reply`);
      }

      emit({
        kind: "module_completed",
        moduleId: module.id,
        moduleTitle: module.title,
        featureCount: partial.features.length,
      });

      options.onModuleComplete?.(module.id, partial.features.length);

      return { moduleId: module.id, featureCount: partial.features.length };
    } finally {
      if (ownClient) {
        client.stop();
      }
    }
  }

  async runFullAuditModules(
    options: AuditOptions & {
      modules: AuditModule[];
      skipCompleted?: boolean;
    },
  ): Promise<AuditResult> {
    const repoPath = await this.resolveRepoPath(options);
    const projectId = await this.resolveProjectId(options);
    const featuresPath = dbFeaturesPath(projectId);

    const emit = (event: AuditProgressEvent) => {
      options.onProgress?.(event);
    };

    emit({ kind: "started", repoPath, mode: "full" });

    await fs.access(repoPath).catch(() => {
      throw new Error(`Sandbox repo not found: ${repoPath}`);
    });

    const client = new PiRpcClient({
      cwd: repoPath,
      piCliPath: this.config.piCliPath,
      rpcArgs: [...this.config.piRpcArgs],
      onProgress: emit,
    });

    try {
      const pid = await client.start();
      emit({ kind: "pi_spawned", pid });

      for (const module of options.modules) {
        if (options.skipCompleted) {
          const existing = await this.mergeService.loadModulePartial(projectId, module.id);
          if (existing) {
            emit({
              kind: "module_completed",
              moduleId: module.id,
              moduleTitle: module.title,
              featureCount: existing.features.length,
            });
            continue;
          }
        }

        try {
          await this.runModuleAudit({
            ...options,
            client,
            module,
            onModuleComplete: (moduleId, count) => {
              options.onModuleComplete?.(moduleId, count);
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emit({
            kind: "module_failed",
            moduleId: module.id,
            moduleTitle: module.title,
            message,
          });
        }
      }

      const allModuleIds = options.modules.map((m) => m.id);
      const features = await this.mergeService.mergeAndPersist(
        projectId,
        repoPath,
        allModuleIds,
      );

      emit({ kind: "features_loaded", features });
      emit({
        kind: "merge_completed",
        featureCount: features.features.length,
      });
      emit({
        kind: "completed",
        featuresPath,
        featureCount: features.features.length,
        mode: "full",
      });

      return { featuresPath, features };
    } finally {
      client.stop();
    }
  }

  async loadFeatures(options: {
    projectId?: string;
    repoPath?: string;
  } = {}): Promise<FeaturesDocument | null> {
    if (options.projectId) {
      return this.featuresRepo.getDocument(options.projectId);
    }
    const repoPath = await this.resolveRepoPath(options);
    const projectId = await this.projectService.resolveIdByRepoPath(repoPath);
    if (!projectId) return null;
    return this.featuresRepo.getDocument(projectId);
  }

  getProfileService(): AuditProfileService {
    return this.profileService;
  }

  getMergeService(): AuditMergeService {
    return this.mergeService;
  }

  getFeaturesRepository(): FeaturesRepository {
    return this.featuresRepo;
  }
}
