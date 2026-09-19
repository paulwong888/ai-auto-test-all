---
name: playwright-fix
description: 修复 Playwright UI 自动化用例报错。当用例执行失败、用户贴上报错信息、trace 分析或要求修复自动化脚本时使用。AI 先分析根因给出修复建议，由用户确认后再改代码。
---

# 自动化用例问题修复

非必选环节。用例报错时使用，原则：**先给建议，用户确认后再改**。

## 工作流程

### 1. 收集报错信息

以下来源按优先级取：

1. 用户直接粘贴的报错信息
2. 上下文中已有的执行报错
3. 都没有时，询问用户或重新执行失败用例获取：

```bash
cd tests && pytest specs/ --headed -v --tracing retain-on-failure --output test-results -x
```

### 2. 分析根因

结合报错堆栈、失败截图与 trace（`npx playwright show-trace <trace.zip>`）定位，常见类别：

| 类别 | 特征 | 典型修法 |
|------|------|----------|
| 定位器失效 | strict mode violation / 元素找不到 | 换 get_by_role/get_by_label，或缩小定位范围 |
| 时序问题 | 超时、元素未加载 | 用 web-first 断言自动等待，避免写死 sleep |
| 数据问题 | 唯一性冲突、脏数据 | 数据工厂随机化，或加前置清理 |
| 断言问题 | 期望值与实际不符 | 核对需求，修正断言或补充等待条件 |
| 环境/登录态 | 跳转登录页、storage state 失效 | 重新生成 fixtures/auth.json |

### 3. 输出修复建议（不直接改代码）

在对话中给出：

```
【失败用例】TC-005 xxx
【根因判断】<类别 + 依据>
【修复建议】<具体改法，指明文件与位置>
是否按此修改？也可说明你的调整意见。
```

**等待用户确认**。用户同意后再修改对应文件（pages/ specs/ data/ 等），一次只改确认过的内容。

### 4. 验证修复

修改完成后重新执行该失败用例验证：

```bash
cd tests && pytest specs/<文件>::<类>::<用例> --headed -v
```

- 通过：提示可调用 `playwright-run-report` 全量回归
- 仍失败：回到第 2 步重新分析，最多迭代 3 轮，仍不通过则汇总已知信息请用户人工介入
