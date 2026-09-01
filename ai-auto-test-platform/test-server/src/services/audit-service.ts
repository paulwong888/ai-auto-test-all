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
在專案根目錄建立或覆寫 \`FEATURES.json\`，必須嚴格使用以下 JSON 結構：
${FEATURES_JSON_SCHEMA}

要求：
1. 產生 **6～8 條** Scenario，每條對應一個核心流程（大型專案勿超過 10 條）。
2. \`gherkinText\` 必須是標準 Gherkin 格式（Given/When/Then/And，每行前兩個空格縮排）。
3. **所有 title、description、scenario、步驟文字必須使用繁體中文**，面向非技術使用者。
4. 審計階段禁止修改 \`src/\` 業務程式碼，只允許寫入 \`FEATURES.json\`。
5. **必須使用 write 工具將完整 JSON 寫入 \`FEATURES.json\`，寫入成功後才可結束**；禁止只在對話中輸出 JSON 而不落盤。`;

const CORE_WRITE_RETRY_PROMPT = `【審計補寫任務】

你剛才已完成程式碼分析，但專案根目錄 **尚未存在有效的 FEATURES.json**。

請**立即**使用 write 工具，將先前分析結果寫入 \`FEATURES.json\`（專案根目錄）。

必須嚴格使用以下 JSON 結構：
${FEATURES_JSON_SCHEMA}

要求：
1. 至少 6 條、最多 10 條 Scenario，繁體中文。
2. 只寫入 \`FEATURES.json\`，不要繼續大量讀檔。
3. **寫入完成並確認檔案存在後才可結束**。`;

function buildModuleAuditPrompt(module: AuditModule, repoPath: string): string {
  const routes = module.routes.map((r) => `- \`${r}\``).join("\n");
  const dirs =
    module.sourceDirs?.map((d) => `- \`${d}/\``).join("\n") ??
    "（依 routes 對應元件自行定位）";
  const partialPath = `.pi-audit/${module.id}.json`;

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
4. **必須**使用 write 工具寫入 \`${partialPath}\`，格式如下：
${MODULE_PARTIAL_SCHEMA}

要求：
- \`moduleId\` 必須為 \`${module.id}\`
- 每條 feature 的 \`id\` 使用 kebab-case，建議前綴 \`${module.id}-\`
- 所有文字使用**繁體中文**
- \`gherkinText\` 為標準 Gherkin（Given/When/Then/And，每行前兩空格）
- 禁止修改 \`src/\` 業務程式碼
- **寫入 \`${partialPath}\` 成功後才可結束**`;
}

function buildModuleWriteRetryPrompt(module: AuditModule): string {
  const partialPath = `.pi-audit/${module.id}.json`;
  return `【模組審計補寫 · ${module.title}】

你已完成分析，但 \`${partialPath}\` **尚未存在或無效**。

請**立即**使用 write 工具寫入 \`${partialPath}\`：
${MODULE_PARTIAL_SCHEMA}

要求：
- \`moduleId\` = \`${module.id}\`
- 5～8 條 Scenario，繁體中文
- 不要繼續大量讀檔，直接落盤`;
}

export type AuditMode = "core" | "full";

export interface AuditOptions {
  projectId?: string;
  /** @deprecated 优先使用 projectId */
  repoPath?: string;
  mode?: AuditMode;
  onProgress?: (event: AuditProgressEvent) => void;
  /** full 模式：仅跑指定模块（续跑失败模块） */
  moduleIds?: string[];
  /** 外部传入已启动的 Pi 客户端（full job 复用） */
  client?: PiRpcClient;
  /** 模块完成后回调（full job 增量合并） */
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

export class AuditService {
  private readonly mergeService = new AuditMergeService();
  private readonly profileService: AuditProfileService;

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
  ) {
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

  async runAudit(options: AuditOptions = {}): Promise<AuditResult> {
    const mode = options.mode ?? "core";
    if (mode === "full") {
      throw new Error("Use AuditJobService for full modular audit");
    }
    return this.runCoreAudit(options);
  }

  async runCoreAudit(options: AuditOptions): Promise<AuditResult> {
    const repoPath = await this.resolveRepoPath(options);
    const featuresPath = this.mergeService.featuresPath(repoPath);

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
            message: `FEATURES.json 尚未產生，正在進行第 ${index} 次補寫…`,
          });
        }
        await client.promptAndWait(message, timeoutMs);
        features = await this.tryLoadFeatures(featuresPath);
        if (features) break;
      }

      if (!features) {
        throw new Error(
          `Pi Agent finished but FEATURES.json is missing or invalid at ${featuresPath}`,
        );
      }

      emit({ kind: "features_loaded", features });
      emit({
        kind: "completed",
        featuresPath,
        featureCount: features.features.length,
        mode: "core",
      });

      return { featuresPath, features };
    } finally {
      client.stop();
    }
  }

  async runModuleAudit(
    options: AuditOptions & { module: AuditModule },
  ): Promise<ModuleAuditResult> {
    const repoPath = await this.resolveRepoPath(options);
    const { module } = options;
    const partialPath = this.mergeService.modulePartialPath(repoPath, module.id);

    const emit = (event: AuditProgressEvent) => {
      options.onProgress?.(event);
    };

    emit({
      kind: "module_started",
      moduleId: module.id,
      moduleTitle: module.title,
    });

    await this.mergeService.ensurePiAuditDir(repoPath);

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

      let partial = null as Awaited<
        ReturnType<AuditMergeService["loadModulePartial"]>
      >;

      for (const [index, { message, timeoutMs }] of prompts.entries()) {
        if (index > 0) {
          emit({
            kind: "error",
            message: `模組 ${module.title} 尚未落盤，第 ${index} 次補寫…`,
          });
        }
        await client.promptAndWait(message, timeoutMs);
        partial = await this.mergeService.loadModulePartial(repoPath, module.id);
        if (partial) break;
      }

      if (!partial) {
        throw new Error(
          `Module ${module.id} finished but partial file missing at ${partialPath}`,
        );
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
    const featuresPath = this.mergeService.featuresPath(repoPath);

    const emit = (event: AuditProgressEvent) => {
      options.onProgress?.(event);
    };

    emit({ kind: "started", repoPath, mode: "full" });

    await fs.access(repoPath).catch(() => {
      throw new Error(`Sandbox repo not found: ${repoPath}`);
    });

    await this.mergeService.ensurePiAuditDir(repoPath);

    const client = new PiRpcClient({
      cwd: repoPath,
      piCliPath: this.config.piCliPath,
      rpcArgs: [...this.config.piRpcArgs],
      onProgress: emit,
    });

    const completedModuleIds: string[] = [];

    try {
      const pid = await client.start();
      emit({ kind: "pi_spawned", pid });

      for (const module of options.modules) {
        if (options.skipCompleted) {
          const existing = await this.mergeService.loadModulePartial(
            repoPath,
            module.id,
          );
          if (existing) {
            completedModuleIds.push(module.id);
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
              completedModuleIds.push(moduleId);
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
      const features = await this.mergeService.mergeAndWrite(
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
    const resolved = await this.resolveRepoPath(options);
    const featuresPath = this.mergeService.featuresPath(resolved);
    return this.tryLoadFeatures(featuresPath);
  }

  getProfileService(): AuditProfileService {
    return this.profileService;
  }

  getMergeService(): AuditMergeService {
    return this.mergeService;
  }

  private async tryLoadFeatures(
    featuresPath: string,
  ): Promise<FeaturesDocument | null> {
    try {
      const raw = await fs.readFile(featuresPath, "utf8");
      return parseFeaturesDocument(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}
