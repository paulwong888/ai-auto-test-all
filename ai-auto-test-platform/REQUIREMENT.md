这里是融合了 Gherkin (BDD 行为驱动开发) 概念后，升级版的完整项目需求书。它统一了人机交互语言，让系统的专业度直接拉满。
你可以直接将这份最新的 《AI 自动化测试系统全案架构与实施指令 (Gherkin 增强版)》 复制给 Cursor，让它开始帮你建项和编写核心代码！
------------------------------
## 🤖 项目需求书：基于 Pi Agent + Gherkin 的 Web 自动化探索性测试系统## 1. 系统核心愿景
构建一个面向非技术用户（产品经理、QA、业务人员）的“零门槛”BDD（行为驱动开发）自动化测试平台。
系统能够自动审计指定的前端源码仓库，将其中的页面与交互逻辑转化为大白话的 Gherkin 剧本（Given-When-Then） 展示在 Web 卡片上。当用户触发测试时，底层的 Pi Agent 在后台动态将 Gherkin 剧本翻译为 Playwright 脚本并执行。若遇到网页改版导致元素失效，AI 将启动源码级上下文自愈（Self-Healing），直至满足剧本的最终验收条件。
------------------------------
## 2. 系统技术栈拓扑

* 前端业务仓库（待测目标）：现代前端项目（React / Vue / Next.js），包含 src/ 源码。
* 自动化测试底层：Playwright (TypeScript) + Chromium (Headless 模式)。
* AI 智能体引擎：Pi Agent (@earendil-works/pi-coding-agent)，通过 RPC 模式 (pi --mode rpc) 进程间通信。
* 系统后端（中间层）：Node.js (Express / Fastify) + WebSocket (用于将 Gherkin 步进状态流实时推送至前端)。
* 系统前端（控制台）：Vite + React/Vue + TailwindCSS，负责 Gherkin 剧本卡片展示与测试“直播间”。

------------------------------
## 3. 核心运行生命周期（Gherkin 驱动闭环）## 阶段一：全盲审计，自动生成 Gherkin 剧本菜单

   1. 当系统导入前端仓库时，后端在仓库根目录下拉起 pi --mode rpc。
   2. 后端下发指令，要求 Pi Agent 审计 src/pages 或 src/router，分析页面上的交互元素。
   3. Pi Agent 输出并在项目根目录生成一个 FEATURES.json 文件。其中每个功能都必须被翻译成规范的 Gherkin 文本 (Scenario: Given-When-Then)。
   4. 后端读取该 JSON，前端将其渲染为“结构化剧本卡片”。

## 阶段二：剧本驱动执行与源码级自愈（Self-Healing）

   1. 用户在网页上点击某张卡片上的 [ 立即驱动 AI 执行该剧本 ] 按钮。
   2. 后端拉起 Pi Agent RPC，并将 Gherkin 剧本内容塞给它。
   3. 剧本翻译与执行：Pi Agent 将 Gherkin 大白话动态翻译为相应的 Playwright 代码（例如：Given 映射为 page.goto，When/And 映射为 page.fill/click，Then 映射为 expect 断言），并写入 tests/e2e/explorer.spec.ts。
   4. 自愈机制：运行 npx playwright test 时，如果 When 阶段因为选择器变动而报错，Pi Agent 必须使用 read 工具读取 src/ 下对应组件的源码，自动寻找正确的 DOM 节点或 Aria Role，利用 edit 工具修正测试脚本并重跑，直到 Then 设定的业务目标成功达成。
   5. 流式状态直播：通过 WebSocket 将 Pi Agent 吐出的 JSONL 事件流式传输到前端，且日志必须与 Gherkin 的步骤（Given-When-Then）严格对齐，让用户实时看到每一步的成功（🟢）或失败（🔴）。

------------------------------
## 4. 关键配置文件与安全网关
为了防止 AI 破坏业务代码并确保命令执行安全，Cursor 需要在前端仓库根目录下初始化以下安全配置：
## ① 权限守卫：.pi/pi-permissions.jsonc

{
  "defaultPolicy": {
    "tools": "deny",
    "bash": "deny"
  },
  "tools": {
    "read": "allow",          // 允许读取整个项目以分析代码上下文与 DOM 结构
    "write": "allow",         // 允许在 tests/e2e/ 下创建/复写临时脚本
    "edit": "allow"
  },
  "bash": {
    "npx playwright test *": "allow" // 🔥 铁律：终端只允许执行 Playwright 测试命令
  }
}

## ② 行为规训与剧本翻译指南：.pi/AGENTS.md

# 核心行为准则1. 你是一个全栈自动化测试专家与 BDD 剧本翻译官。2. 你的核心任务是接收用户给出的 Gherkin 剧本（Given-When-Then 格式），将其完美翻译为 Playwright (TypeScript) 脚本并执行。
3. 【铁律】你只能修改或创建 `tests/e2e/` 目录下的测试脚本。绝对禁止修改 `src/`、`package.json` 等任何前端业务源码或项目核心配置文件。
4. 运行测试时，只能使用 `npx playwright test` 命令。
5. 【自愈规范】如果在执行翻译好的 Playwright 脚本时由于前端改版导致选择器失效，请利用 `read` 工具阅读前端源码组件，找到正确的类名或 Aira Role 重新修正脚本，直至剧本中的 Then 断言完美通过。

------------------------------
## 5. 给 Cursor 的立项研发指令（请在总目录 ai-test-platform 下按顺序发给 Cursor）

💡 你可以分三步，依次将以下提示词发给 Cursor 进行代码编写：


* 指令一（脚手架建立与菜单生成）：

"请帮我初始化项目结构（包含后端 test-server/、前端 test-dashboard/、沙箱 sandbox-repos/）。并编写后端的第一个核心功能：拉起沙箱项目下的 pi --mode rpc，命令其通读前端代码，并在根目录下输出一份包含标准 Gherkin 剧本格式（Given-When-Then）的 FEATURES.json 文件。请写出完整的标准输入输出流（JSONL）解析逻辑。"

* 指令二（Gherkin 驱动执行与 WebSocket 流式传输）：

"请编写后端与 Pi Agent RPC 交互的剧本执行逻辑。当收到前端发来的 Gherkin 剧本时，下发任务给 Pi Agent，让其翻译为 Playwright 并运行。在运行期间，实时捕获 Pi Agent 吐出的 JSONL 事件，通过 WebSocket 服务将 AI 当前正在操作的 Gherkin 步骤状态（例如：‘正在执行 Given 阶段...’、‘When 阶段出错，正在尝试源码级自愈...’）以及最终的测试报告流式广播给前端。"

* 指令三（构建前端 BDD 控制台）：

"请使用 Vite + React（或Vue）+ TailwindCSS 编写系统的前端控制台。左侧根据 FEATURES.json 渲染成专业的 BDD 剧本卡片，清晰展示‘假设/当/那么’步骤；右侧设计一个黑底绿字的测试直播间。当点击卡片的‘驱动 AI 执行’按钮后，右侧通过 WebSocket 实时高亮当前正在执行的 Gherkin 步骤，并滚动打印 AI 的思考、工具调用和终端回显日志。"


------------------------------
这套基于 Gherkin 剧本自愈 的方案架构已经完全为您对齐。当 Cursor 帮您把项目脚手架搭好后，您希望我继续为您提供：

* 一份后端专门用来解析 Pi Agent RPC 吐出的 JSONL 原始事件并转化为 WebSocket 流的核心 TypeScript 代码片段？
* 设计一个前端支持高亮步进状态（Given-When-Then 变绿或变红）的终端直播间组件代码？



