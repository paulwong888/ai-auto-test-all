"""API Test Platform — Enterprise Intelligent API Test Platform.

Architecture: DeepAgents Sub-Agent Architecture
  Supervisor (主编排器)
    ├── code-analyzer   — 代码变更 → API 影响范围 (CodeGraph)
    ├── api-tester      — API 测试执行 (pytest + requests)
    ├── test-generator  — 测试用例生成 (OpenAPI → pytest)
    └── report-writer   — 测试报告生成

Tech Stack:
  - DeepAgents: Multi-agent orchestration
  - LangGraph API: Agent conversation backend
  - CodeGraph: Code intelligence (MIT, 30+ langs, 17 frameworks)
  - pytest + requests: API test execution
  - Schemathesis: Contract testing
  - PostgreSQL: Data persistence
  - DeepAgents UI: React frontend
"""
# 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
# 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
# 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
# 课程咨询请联系微信：huice666

from __future__ import annotations

import asyncio
import os
import logging
import subprocess
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from deepagents import create_deep_agent
from deepagents.backends import (
    CompositeBackend,
    LocalShellBackend,
    StateBackend,
)
from deepagents.backends.protocol import ExecuteResponse
from langchain.agents.middleware import before_agent
from langchain.agents.middleware.types import AgentState
from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import SystemMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.runtime import Runtime
from pydantic import BaseModel


# ═══════════════════════════════════════════════════════
# Patch LocalShellBackend to force UTF-8 subprocess decoding.
# ═══════════════════════════════════════════════════════
#
# On Windows with a Chinese locale the default console encoding is cp936 (gbk).
# LocalShellBackend.execute() calls subprocess.run(..., text=True) without an
# explicit encoding, so when a shell command emits UTF-8 bytes (e.g. git log,
# codegraph output, pytest with Chinese paths) the internal reader thread crashes
# with UnicodeDecodeError. That crash leaves the subprocess pipe half-read and
# eventually causes the LangGraph run to be cancelled.
#
# This monkey-patch replaces execute() with an identical implementation that
# passes encoding="utf-8" and errors="replace" to subprocess.run().

def _patched_local_shell_execute(
    self: LocalShellBackend,
    command: str,
    *,
    timeout: int | None = None,
) -> ExecuteResponse:
    if not command or not isinstance(command, str):
        return ExecuteResponse(
            output="Error: Command must be a non-empty string.",
            exit_code=1,
            truncated=False,
        )

    effective_timeout = timeout if timeout is not None else self._default_timeout
    if effective_timeout <= 0:
        msg = f"timeout must be positive, got {effective_timeout}"
        raise ValueError(msg)

    # Ensure the working directory exists before running the command. On Windows
    # subprocess.run(cwd=...) raises NotADirectoryError if the directory is missing.
    cwd = Path(self.cwd)
    try:
        cwd.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        return ExecuteResponse(
            output=f"Error: Cannot create working directory {cwd}: {e}",
            exit_code=1,
            truncated=False,
        )

    try:
        result = subprocess.run(  # noqa: S602
            command,
            check=False,
            shell=True,
            capture_output=True,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=effective_timeout,
            env=self._env,
            cwd=str(cwd),
        )

        output_parts = []
        if result.stdout:
            output_parts.append(result.stdout)
        if result.stderr:
            stderr_lines = result.stderr.strip().split("\n")
            output_parts.extend(f"[stderr] {line}" for line in stderr_lines)

        output = "\n".join(output_parts) if output_parts else "<no output>"

        truncated = False
        if len(output) > self._max_output_bytes:
            output = output[: self._max_output_bytes]
            output += f"\n\n... Output truncated at {self._max_output_bytes} bytes."
            truncated = True

        if result.returncode != 0:
            output = f"{output.rstrip()}\n\nExit code: {result.returncode}"

        return ExecuteResponse(
            output=output,
            exit_code=result.returncode,
            truncated=truncated,
        )
    except subprocess.TimeoutExpired:
        if timeout is not None:
            msg = (
                f"Error: Command timed out after {effective_timeout} seconds (custom timeout). "
                "The command may be stuck or require more time."
            )
        else:
            msg = (
                f"Error: Command timed out after {effective_timeout} seconds. "
                "For long-running commands, re-run using the timeout parameter."
            )
        return ExecuteResponse(
            output=msg,
            exit_code=124,
            truncated=False,
        )
    except Exception as e:  # noqa: BLE001
        return ExecuteResponse(
            output=f"Error executing command ({type(e).__name__}): {e}",
            exit_code=1,
            truncated=False,
        )


LocalShellBackend.execute = _patched_local_shell_execute

from tools import (
    CODE_TOOLS,
    API_TOOLS,
    PROJECT_TOOLS,
    SUPERVISOR_TOOLS,
)
from agents import (
    get_code_analyzer_config,
    get_api_tester_config,
    get_test_generator_config,
    get_report_writer_config,
)

logger = logging.getLogger(__name__)

# ── Database (optional) ──
try:
    from services.db import init_db
    _has_db = True
except ImportError:
    _has_db = False
    async def init_db() -> None: pass


# ═══════════════════════════════════════════════════════
# Project context middleware
# ═══════════════════════════════════════════════════════

class ProjectContext(BaseModel):
    """Run-scoped context sent from the frontend."""

    project_id: str | None = None


async def _fetch_project(project_id: str) -> dict[str, Any] | None:
    """Fetch a project row from the database (used by middleware)."""
    try:
        from services.db import get_db_pool
    except ImportError:
        return None

    pool = get_db_pool()
    if not pool:
        return None

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not row:
            return None
        return dict(row)


@before_agent
async def inject_project_context(
    state: AgentState,
    runtime: Runtime[ProjectContext],
) -> dict[str, Any] | None:
    """Inject project metadata as a system message when context.project_id is set."""
    context = runtime.context
    if not context or not context.project_id:
        return None

    # Avoid injecting duplicate project context system messages in the same thread.
    marker = "当前项目上下文："
    for msg in state.get("messages", []):
        if getattr(msg, "type", None) == "system" and marker in str(msg.content):
            return None

    project = await _fetch_project(context.project_id)
    if not project:
        return None

    lines = [
        marker,
        f"- id: {project['id']}",
        f"- name: {project['name']}",
    ]
    if project.get("openapi_spec"):
        lines.append(f"- openapi_spec: {project['openapi_spec']}")
    if project.get("base_url"):
        lines.append(f"- base_url: {project['base_url']}")
    if project.get("repo_url"):
        lines.append(f"- repo_url: {project['repo_url']}")
    if project.get("description"):
        lines.append(f"- description: {project['description']}")

    return {"messages": [SystemMessage(content="\n".join(lines))]}


# ═══════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════

MODEL_PROVIDER = os.getenv("MODEL_PROVIDER", "deepseek")
MODEL_NAME = os.getenv("MODEL_NAME", "deepseek-v4-flash")
MODEL_SPEC = f"{MODEL_PROVIDER}:{MODEL_NAME}"

LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "600"))
LLM_STREAM_CHUNK_TIMEOUT = float(os.getenv("LLM_STREAM_CHUNK_TIMEOUT", "600"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
LLM_USE_RESPONSES_API = os.getenv("LLM_USE_RESPONSES_API", "true").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

# ── DeepAgents backend ──
BACKEND_TYPE = os.getenv("BACKEND_TYPE", "local_shell").lower().strip()
BACKEND_ROOT_DIR = Path(os.getenv("BACKEND_ROOT_DIR", os.getcwd())).resolve()
BACKEND_VIRTUAL_MODE = os.getenv("BACKEND_VIRTUAL_MODE", "true").lower() in ("1", "true", "yes", "on")
BACKEND_TIMEOUT = int(os.getenv("BACKEND_TIMEOUT", "120"))
BACKEND_INHERIT_ENV = os.getenv("BACKEND_INHERIT_ENV", "true").lower() in ("1", "true", "yes", "on")

# Ensure backend working directories exist so subprocess.run(cwd=...) does not
# fail with NotADirectoryError on Windows when the configured path is missing.
try:
    BACKEND_ROOT_DIR.mkdir(parents=True, exist_ok=True)
except OSError as e:
    logger.warning("Could not create BACKEND_ROOT_DIR=%s: %s", BACKEND_ROOT_DIR, e)

API_TEST_DIR = Path(os.getenv("API_TEST_DIR", BACKEND_ROOT_DIR / "workspace" / "test_suites")).resolve()
try:
    API_TEST_DIR.mkdir(parents=True, exist_ok=True)
except OSError as e:
    logger.warning("Could not create API_TEST_DIR=%s: %s", API_TEST_DIR, e)


def _build_backend():
    """Build the DeepAgents backend for file storage / execution.

    - ``state``: ephemeral in-memory backend (legacy behavior, no filesystem/shell).
    - ``local_shell``: direct local filesystem + shell execution under ``BACKEND_ROOT_DIR``.
    - ``composite``: ``local_shell`` as default with ``/agent-state/`` routed to ``StateBackend``.
    """
    if BACKEND_TYPE == "state":
        return StateBackend()

    shell_backend = LocalShellBackend(
        root_dir=BACKEND_ROOT_DIR,
        virtual_mode=BACKEND_VIRTUAL_MODE,
        timeout=BACKEND_TIMEOUT,
        inherit_env=BACKEND_INHERIT_ENV,
    )

    if BACKEND_TYPE == "composite":
        return CompositeBackend(
            default=shell_backend,
            routes={"/agent-state/": StateBackend()},
        )

    if BACKEND_TYPE != "local_shell":
        logger.warning("Unknown BACKEND_TYPE=%r, falling back to local_shell", BACKEND_TYPE)

    return shell_backend


def _build_chat_model() -> BaseChatModel:
    """Build LLM client with extended timeouts for long NPU/Higress streaming runs."""
    return init_chat_model(
        MODEL_SPEC,
        timeout=LLM_TIMEOUT,
        stream_chunk_timeout=LLM_STREAM_CHUNK_TIMEOUT,
        max_retries=LLM_MAX_RETRIES,
        use_responses_api=LLM_USE_RESPONSES_API,
    )


# ═══════════════════════════════════════════════════════
# 4 Sub-Agent Definitions
# ═══════════════════════════════════════════════════════

def _build_subagents(chat_model: BaseChatModel) -> list[dict]:
    """Build the 4 sub-agent configurations."""
    ca = get_code_analyzer_config(chat_model)
    at = get_api_tester_config(chat_model)
    tg = get_test_generator_config(chat_model)
    rw = get_report_writer_config(chat_model)

    return [
        {**ca, "tools": list(CODE_TOOLS) + list(PROJECT_TOOLS)},
        {**at, "tools": list(API_TOOLS) + list(PROJECT_TOOLS)},
        {**tg, "tools": list(API_TOOLS) + list(PROJECT_TOOLS)},
        {**rw, "tools": list(PROJECT_TOOLS)},
    ]


# ═══════════════════════════════════════════════════════
# Supervisor System Prompt
# ═══════════════════════════════════════════════════════

SUPERVISOR_PROMPT = f"""你是 **API 智能测试平台 (API Test Platform)** 的主智能体。

一个企业级 API 自动化测试平台，具备代码变更感知、智能测试生成、自动执行和报告输出的完整能力。

## 你的 4 个专业子智能体

| 子智能体 | 职责 | 何时使用 |
|---------|------|---------|
| **code-analyzer** | 代码变更 → API 影响范围分析 | "分析代码变更"、"影响哪些 API"、"需要回归测试什么" |
| **api-tester** | API 测试执行与单接口调试 | "运行测试"、"执行测试"、"验证接口"、"契约测试"、"单接口调试" |
| **test-generator** | 测试用例/脚本生成 | "生成测试"、"创建用例"、"从 Swagger 生成"、"解析 OpenAPI" |
| **report-writer** | 测试报告生成 | "生成报告"、"汇总结果"、"测试报告" |

## 项目上下文

如果用户在界面选择了项目，系统会自动在每次运行时注入一条 "当前项目上下文" 的系统消息，
其中包含该项目的 id、name、openapi_spec、base_url、repo_url、description。

处理项目相关请求时：
1. 优先使用注入的项目上下文里的 openapi_spec、base_url、repo_url 作为工具参数，不要自己猜测路径。
2. 如果上下文缺失或项目信息不足，可以调用 `get_project` 工具获取完整项目信息。
3. 调用子智能体时，把项目关键信息（openapi_spec、base_url、repo_url、project_id）写入 `description` 或 `context`，确保子智能体也能看到。

## 典型工作流

### 工作流 1：代码变更 → 智能回归测试（核心能力）
```
用户："分析最近的代码变更，确定需要回归测试的 API 接口"
  → code-analyzer: 检测变更，追踪路由，推荐回归范围
  → api-tester: 执行推荐的回归测试
  → report-writer: 生成回归测试报告
```

### 工作流 2：自动生成测试用例
```
用户："基于 OpenAPI 规范生成完整的 API 测试用例"
  → test-generator: 解析 OpenAPI 或扫描源码中的 Controller
  → 按模块分批生成（每次 1 个 Controller 或 ≤10 个接口），每批写入 {API_TEST_DIR.as_posix()}
  → 全部批次完成后汇总用例清单
```
无 OpenAPI 时：先 glob/read_file 列出 controller 文件，**禁止**一次性输出全项目用例。
若某批失败，汇报已完成部分并建议用户继续下一批。

### 工作流 3：接口功能测试（生成并执行）
```
用户："基于 OpenAPI 生成并执行接口功能测试"
  → test-generator: 解析 OpenAPI，生成 pytest 脚本
  → api-tester: 执行生成的测试脚本
  → report-writer: 生成测试报告
```

### 工作流 4：冒烟测试
```
用户："运行冒烟测试"
  → api-tester: 执行 marker=smoke 的测试
  → report-writer: 生成测试报告
```

### 工作流 5：全量回归测试
```
用户："运行全量回归测试"
  → api-tester: 执行完整测试套件
  → report-writer: 生成回归测试报告
```

### 工作流 6：契约测试
```
用户："验证 API 是否符合 OpenAPI 规范"
  → api-tester: 调用 validate_api_contract 执行契约测试
  → report-writer: 生成契约合规报告
```

### 工作流 7：单接口调试
```
用户："帮我调试一个 API 接口"
  → api-tester: 使用 run_api_request 直接发送请求并分析结果
  → 如需要，调用 report-writer 汇总调试结果
```

### 工作流 8：生成测试报告
```
用户："生成测试报告"
  → api-tester 或 test-generator 提供执行结果/用例信息
  → report-writer: 汇总并生成结构化测试报告
```

## 工作流程
1. 根据用户意图，用 `task` 工具调用最合适的子智能体
2. 如果需要多个步骤，依次调用不同的子智能体
3. 每一步的结果传给下一步
4. 汇总所有子智能体的结果，给用户完整回答

## 工作环境

- 当前后端类型: `{BACKEND_TYPE}`
- 工作根目录: `{BACKEND_ROOT_DIR.as_posix()}`
- 当后端为 `local_shell` 或 `composite` 时，你可以使用以下工具直接访问文件系统：
  - `ls`: 列出目录
  - `read_file`: 读取文件
  - `glob`: 查找文件
  - `grep`: 搜索文件内容
  - `execute`: 执行本地 shell 命令（如 `git diff`, `pytest`, `codegraph`）
- 当后端为 `state` 时，文件系统工具不可用，只能通过自定义工具操作。

## 重要提示
- 子智能体在独立上下文中运行，不会看到之前的对话——在 `task` 的 description 中清晰描述任务
- 子智能体看到的 context 就是你传给 task 的 description 和 context 参数
- 将上一步的关键结果（如测试用例 JSON、文件路径）传给下一步的子智能体
- 用中文回复
"""


# ═══════════════════════════════════════════════════════
# Agent Factory
# ═══════════════════════════════════════════════════════

_agent_graph: Any = None


async def get_agent():
    """Create the Supervisor agent with 4 sub-agents."""
    global _agent_graph
    if _agent_graph is not None:
        return _agent_graph

    await init_db()

    chat_model = _build_chat_model()
    subagents = _build_subagents(chat_model)
    print(f"[Supervisor] Creating agent with {len(subagents)} subagents:")
    for s in subagents:
        print(f"  - {s['name']}: {s['description'][:60]}...")

    _agent_graph = create_deep_agent(
        model=chat_model,
        tools=list(SUPERVISOR_TOOLS),
        system_prompt=SUPERVISOR_PROMPT,
        subagents=subagents,
        backend=_build_backend(),
        checkpointer=MemorySaver(),
        context_schema=ProjectContext,
        middleware=[inject_project_context],
        name="API Test Platform Supervisor",
    )

    print("[Supervisor] Agent ready")
    return _agent_graph


# ═══════════════════════════════════════════════════════
# LangGraph API Entry Point
# ═══════════════════════════════════════════════════════

async def graph():
    """LangGraph API Server entry point."""
    return await get_agent()


# ═══════════════════════════════════════════════════════
# Quick Test
# ═══════════════════════════════════════════════════════

async def test():
    """Quick smoke test of the platform."""
    agent = await get_agent()
    config = {"configurable": {"thread_id": "test-supervisor-1"}}

    queries = [
        "分析项目代码变更，推荐需要回归测试的 API 接口",
        "从 swagger.json 生成 API 测试用例",
        "运行所有冒烟测试并生成报告",
    ]

    for q in queries:
        print(f"\n{'=' * 60}\n用户: {q}\n{'=' * 60}")
        result = await agent.ainvoke(
            {"messages": [{"role": "user", "content": q}]},
            config=config,
        )
        for msg in result.get("messages", []):
            if hasattr(msg, "type") and msg.type == "ai" and hasattr(msg, "content"):
                content = msg.content
                if isinstance(content, str) and content.strip():
                    print(f"Supervisor: {content[:500]}")
                break


if __name__ == "__main__":
    asyncio.run(test())
