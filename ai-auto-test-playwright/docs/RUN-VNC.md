# Run 期浏览器预览（noVNC）速查

> **状态（2026-09-22）：** Run 页 **debug / custom+预览** 已支持 noVNC（Phase 4）。录制 Tab 的 Web noVNC 仍用于 **人工录制**（Phase 3）。

---

## 现在：Run 勾选 Headed 会怎样？

| 现象 | 原因 |
|------|------|
| Mac/Windows **不会弹出** Chromium | pytest 在 **Docker Worker** 里执行，不是你的桌面 |
| **ci** preset **没有**浏览器画面 | headless，不启 VNC |
| **debug** 仍 **不会**在本机弹窗 | 浏览器在 Worker 虚拟桌面；Run 页 iframe 为 noVNC |
| Run 页 **有** LiveTerminal | 正常；日志是主要实时反馈 |

**debug preset** 同样如此：headed + slowmo 在容器内生效，不等于本机有头窗口。

---

## Record VNC vs Run VNC

| | 录制 · Web 录制 Tab | 执行 · Run 页 |
|--|---------------------|---------------|
| **阶段** | 录操作 → `recorded/*.py` | 跑 pytest → 报告 |
| **noVNC** | ✅ 已实现 | ✅ debug 默认；custom 可勾选「浏览器预览」 |
| **你在 VNC 里做什么** | **亲手点**浏览器 | （计划）**只看**自动化执行 |
| **入口** | `/projects/:id/record` | `/projects/:id/run` |

---

## 现在想看浏览器，可以怎么做？

1. **事后：** 运行历史 → **报告**（HTML）；失败用例看 **trace**。
2. **实时（仅日志）：** Run 页终端输出。
3. **本机真弹窗：** 进入项目 workspace（宿主机 `docker/data/projects/<slug>/tests`）：

   ```bash
   pip install -r requirements.txt
   playwright install chromium
   pytest specs/ --headed --slowmo 600 -v
   ```

4. **人工录场景：** 用 **录制 → Web 录制** 的 noVNC，不是 Run 页。

---

## 验收脚本

```bash
cd docker && docker-compose up -d --build worker server dashboard
../scripts/demo-run-vnc.sh
# 或 SEED_TESTS=always ../scripts/demo-run-vnc.sh
```

产品 / 工程说明：[PRD-Phase4.md](../PRD-Phase4.md)、[PRD-Phase4-Implementation.md](../PRD-Phase4-Implementation.md)。
