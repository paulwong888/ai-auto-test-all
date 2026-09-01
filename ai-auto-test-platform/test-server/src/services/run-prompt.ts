import type { FeatureItem } from "../pi/types.js";

/** 每个 feature 独立 spec，避免执行时跑完全部用例 */
export function specRelPath(featureId: string): string {
  return `tests/e2e/${featureId}.spec.ts`;
}

export function buildRunPrompt(feature: FeatureItem, targetUrl: string): string {
  const specFile = specRelPath(feature.id);
  const testTitle = feature.gherkin.scenario;

  return `【Gherkin 劇本驅動執行 — 單劇本模式】

請將以下 Gherkin 劇本翻譯為 Playwright (TypeScript) 腳本並執行，直到 Then 斷言全部通過。

## 被測應用
- Base URL: ${targetUrl}（執行測試時必須設定 PLAYWRIGHT_BASE_URL=${targetUrl}）
- 路由參考: ${feature.route ?? "見劇本"}
- 相關原始碼: ${feature.sourceFile}

## 鐵律
1. **只能**建立或覆寫 \`${specFile}\`，禁止修改其他 \`tests/e2e/*.spec.ts\`
2. 該檔案只包含 **1 個** test，標題為：\`${testTitle}\`
3. **只能**使用以下命令執行（不要跑整個目錄或其他 spec）：
   \`PLAYWRIGHT_BASE_URL=${targetUrl} npx playwright test ${specFile}\`
4. 禁止修改 \`src/\`、\`package.json\` 等業務檔案
5. 若專案已配置 \`tests/e2e/auth.setup.ts\` 與 \`storageState\`，**禁止在 spec 裡寫 Keycloak 登入**；Given「已登入」時直接 \`page.goto\` 目標路由
6. Given → page.goto / 初始斷言；When/And → fill/click；Then → expect
7. 若選擇器失效，使用 read 閱讀 ${feature.sourceFile} 及關聯元件，修正 \`${specFile}\` 後重跑，直至 Then 通過
8. 完成後以**繁體中文** Markdown 說明測試結果，包含 Gherkin 步驟與 Playwright 實作對照表

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
