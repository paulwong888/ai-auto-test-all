import type { FeatureItem } from "../pi/types.js";
import { buildPlaywrightTestCommand } from "./playwright-runner.js";
import type { AppConfig } from "../config.js";
import type { RunPromptContext } from "./run-prompt-context.js";

/** 每个 feature 独立 spec，避免执行时跑完全部用例 */
export function specRelPath(featureId: string): string {
  return `tests/e2e/${featureId}.spec.ts`;
}

function buildReferenceSpecsSection(referenceSpecs: string[]): string {
  if (referenceSpecs.length === 0) return "";
  const lines = referenceSpecs.map((p) => `- \`read ${p}\` **只读**，学习 initApp / mock / 导航模式，**禁止修改**`);
  return `
## 执行前必读（只读）
${lines.join("\n")}
`;
}

function buildManualConfigSection(feature: FeatureItem): string {
  const cfg = feature.manualConfig;
  if (!cfg) return "";

  const lines: string[] = ["\n## 人工测试配置（必须遵守）"];
  if (cfg.accounts?.length) {
    for (const acc of cfg.accounts) {
      const cred = acc.password ? `${acc.username} / ${acc.password}` : acc.username;
      lines.push(`- 测试帐号（${acc.role}）: ${cred}${acc.note ? ` — ${acc.note}` : ""}`);
    }
  }
  if (cfg.env && Object.keys(cfg.env).length > 0) {
    for (const [k, v] of Object.entries(cfg.env)) {
      lines.push(`- 环境变量: ${k}=${v}`);
    }
  }
  if (cfg.notes?.trim()) {
    lines.push(`- 备注: ${cfg.notes.trim()}`);
  }
  return lines.length > 1 ? `${lines.join("\n")}\n` : "";
}

function buildLastFailureSection(ctx: RunPromptContext): string {
  const last = ctx.lastRun;
  if (!last) return "";
  const err = last.failureSummary ?? last.lastPlaywrightExitError ?? "（无详细错误）";
  return `
## 上次执行失败摘要（勿重复相同错误）
- 时间: ${last.lastRunAt}
- Playwright 次数: ${last.playwrightAttempts}
- 错误: ${err}
请在此基础小步修正，勿整文件重写。
`;
}

function buildSpecIronLaw(ctx: RunPromptContext): string {
  if (ctx.specExists) {
    return `1. **优先**在现有 \`${ctx.specRelPath}\` 上 **edit** 小步修正；先 \`read\` 当前 spec 再改；**禁止**无必要 write 整文件覆写。禁止修改其他 \`tests/e2e/*.spec.ts\``;
  }
  return `1. **只能**建立 \`${ctx.specRelPath}\`，禁止修改其他 \`tests/e2e/*.spec.ts\``;
}

export function buildRunPrompt(
  feature: FeatureItem,
  repoPath: string,
  targetUrl: string,
  config: AppConfig,
  ctx: RunPromptContext,
): string {
  const specFile = ctx.specRelPath;
  const testTitle = feature.gherkin.scenario;
  const playwrightCmd = buildPlaywrightTestCommand(config, repoPath, targetUrl, specFile);
  const skillPrefix = config.piRunSkillName
    ? `/skill:${config.piRunSkillName}\n\n`
    : "";
  const maxAttempts = config.runMaxPlaywrightAttempts;
  const referenceSection = buildReferenceSpecsSection(ctx.referenceSpecs);
  const lastFailureSection = buildLastFailureSection(ctx);
  const manualConfigSection = buildManualConfigSection(feature);
  const specIronLaw = buildSpecIronLaw(ctx);

  return `${skillPrefix}【Gherkin 劇本驅動執行 — 單劇本模式】

請將以下 Gherkin 劇本翻譯為 Playwright (TypeScript) 腳本並執行，直到 Then 斷言全部通過。
${referenceSection}${lastFailureSection}${manualConfigSection}
## 被測應用
- Base URL: ${targetUrl}（執行測試時必須設定 PLAYWRIGHT_BASE_URL=${targetUrl}）
- 路由參考: ${feature.route ?? "見劇本"}
- 相關原始碼: ${feature.sourceFile}

## 鐵律
${specIronLaw}
2. 該檔案只包含 **1 個** test，標題為：\`${testTitle}\`
3. **只能**使用以下命令執行（不要跑整個目錄或其他 spec，**禁止 npm install**）：
   \`${playwrightCmd}\`
4. 禁止修改 \`src/\`、\`package.json\` 等業務檔案
5. 若專案已配置 \`tests/e2e/auth.setup.ts\` 與 \`storageState\`，**禁止在 spec 裡寫 Keycloak 登入**；Given「已登入」時须先 \`initApp('/')\` 或等價流程，**禁止**对 \`/NewCreatePage/*\`、\`/View/*\` 等深链路由冷启动 \`page.goto\`
6. Given → initApp / page.goto / 初始斷言；When/And → fill/click；Then → expect
7. 使用 \`test.step\` 组织 Gherkin 步骤时**必须** \`await test.step(...)\`，否则测试会提前结束并报 \`Test ended\`
8. 若選擇器失效，使用 read 閱讀 ${feature.sourceFile} 及關聯元件，修正 \`${specFile}\` 後重跑，直至 Then 通過
9. 已加载 skill **${config.piRunSkillName || "e2e-test-env"}**，Playwright 命令、SSO、禁止 npm install 等**一律严格遵循 skill**，**禁止 npm install**
10. Playwright 针对本 spec **最多执行 ${maxAttempts} 次**；超过后必须停止并输出失败原因，勿继续 bash 重跑
11. 完成後以**繁體中文** Markdown 說明測試結果，包含 Gherkin 步驟與 Playwright 實作對照表

## Gherkin 劇本
${feature.gherkinText}

完成後簡要說明測試結果（繁體中文 Markdown）。`;
}

/** 累积型 stdout（Playwright 流式输出）只推送增量，避免直播间重复 */
export class BashStreamDeduper {
  private readonly cursors = new Map<string, string>();

  /** @returns 新增文本片段（无新增则返回空字符串） */
  push(toolCallId: string, cumulative: string): string {
    const prev = this.cursors.get(toolCallId) ?? "";
    if (cumulative.length <= prev.length) return "";
    const delta = cumulative.slice(prev.length);
    this.cursors.set(toolCallId, cumulative);
    return delta;
  }

  clear(toolCallId: string): void {
    this.cursors.delete(toolCallId);
  }

  reset(): void {
    this.cursors.clear();
  }
}
