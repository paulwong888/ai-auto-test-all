"""CodeGraph CLI tools — 3 tools for code change → API impact analysis.

CodeGraph (github.com/colbymchenry/codegraph):
  MIT license, single binary, 30+ languages, 17 framework-aware routes.
  Install: npm install -g codegraph
"""
# 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
# 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
# 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
# 课程咨询请联系微信：huice666

from __future__ import annotations

import json
import os
import subprocess
import logging

from langchain_core.tools import tool

logger = logging.getLogger(__name__)

CODEGRAPH_PATH = os.getenv("CODEGRAPH_PATH", "codegraph")
DEFAULT_PROJECT = os.getenv("CODEGRAPH_DEFAULT_PROJECT", os.getcwd())


def _run_codegraph(subcommand: str, args: list[str] | None = None) -> dict:
    """Run a codegraph CLI command and return parsed JSON."""
    cmd = [CODEGRAPH_PATH, subcommand, "--json"]
    if args:
        cmd.extend(args)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            cwd=DEFAULT_PROJECT,
        )
        output = (result.stdout or "").strip()
        if result.returncode != 0:
            return {"error": (result.stderr or output or "Unknown error"), "exit_code": result.returncode}
        if not output:
            return {"error": f"Empty output from codegraph {subcommand}"}
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return {"raw": output[:3000]}
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out after 60s"}
    except FileNotFoundError:
        return {"error": "codegraph not found. Install: npm install -g codegraph"}


def codegraph_affected_impl(
    project_path: str = "",
    base_branch: str = "main",
) -> str:
    """Underlying implementation for ``codegraph_affected`` (also used by the REST API)."""
    args = [f"--base={base_branch}"]
    if project_path:
        args.extend(["--project", project_path])

    result = _run_codegraph("affected", args)
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def codegraph_affected(
    project_path: str = "",
    base_branch: str = "main",
) -> str:
    """检测代码变更影响范围，输出受影响的 API 路由和测试文件。

    这是 CI/CD 集成中最关键的工具。提交代码后，自动分析：
    - 哪些文件被修改了
    - 哪些 API 路由/接口受到影响
    - 哪些测试文件需要重新运行

    支持 17 种框架的路由识别：Django, FastAPI, Flask, Express, Spring, Gin, Laravel, Rails, ASP.NET 等。

    Args:
        project_path: 项目路径，留空使用当前目录
        base_branch: 基准分支 (默认 main)
    """
    return codegraph_affected_impl(project_path=project_path, base_branch=base_branch)


@tool
def codegraph_explore(query: str, project_path: str = "") -> str:
    """探索代码结构，回答架构问题。

    支持自然语言查询和结构化问题：
    - "这个项目有哪些 API 路由？"
    - "订单模块的调用链是什么？"
    - "哪些中间件处理认证？"
    - "支付模块依赖哪些服务？"
    - "API 层的入口点在哪里？"

    能识别 17 种框架的路由：Django, Flask, FastAPI, Express, Next.js, Rails, Spring, Gin, Laravel, ASP.NET 等。

    Args:
        query: 探索查询（自然语言或结构化问题）
        project_path: 项目路径
    """
    args = [query]
    if project_path:
        args.extend(["--project", project_path])

    result = _run_codegraph("explore", args)
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def codegraph_search(
    symbol: str,
    project_path: str = "",
    callers: bool = True,
    callees: bool = True,
) -> str:
    """搜索代码符号（函数、类、路由），获取调用者和被调用者。

    用于追踪 API 代码变更的影响范围：
    - 改了某个 Handler → 找到所有调用者 → 确定受影响的 API 接口
    - 改了某个 Service → 追踪依赖链 → 确定集成测试范围
    - 改了某个路由 → 找到所有依赖的中间件和服务 → 确定回归测试范围

    Args:
        symbol: 符号名称（函数名、类名、路由路径）
        project_path: 项目路径
        callers: 是否查找调用者（谁调用了这个符号）
        callees: 是否查找被调用者（这个符号调用了谁）
    """
    args = [symbol]
    if callers:
        args.append("--callers")
    if callees:
        args.append("--callees")
    if project_path:
        args.extend(["--project", project_path])

    result = _run_codegraph("search", args)
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def codegraph_callers(symbol: str, project_path: str = "", limit: int = 20) -> str:
    """查找某个符号的所有调用者（谁调用了它）。

    适用场景：
    - 改变了一个 API 函数，想知道哪些路由会受影响
    - 修改了一个工具函数，需要评估影响范围

    Args:
        symbol: 符号名称
        project_path: 项目路径
        limit: 最多返回的调用者数量
    """
    args = [symbol, f"--limit={limit}"]
    if project_path:
        args.extend(["--project", project_path])

    result = _run_codegraph("callers", args)
    return json.dumps(result, ensure_ascii=False, indent=2)


CODEGRAPH_TOOLS = [
    codegraph_affected,
    codegraph_explore,
    codegraph_search,
    codegraph_callers,
]

__all__ = [
    "codegraph_affected",
    "codegraph_affected_impl",
    "codegraph_explore",
    "codegraph_search",
    "codegraph_callers",
    "CODEGRAPH_TOOLS",
]