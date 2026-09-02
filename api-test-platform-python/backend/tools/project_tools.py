"""Project metadata tools — let the agent read project configuration from DB.

These tools bridge the management API's project records and the conversational
agent, so the supervisor/sub-agents can resolve a project_id into the fields
needed by the testing tools (openapi_spec, base_url, repo_url).
"""
# 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
# 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
# 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
# 课程咨询请联系微信：huice666

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


async def _get_project_from_db(project_id: str) -> dict[str, Any] | None:
    """Fetch a single project row from the database by id."""
    try:
        from services.db import get_db_pool
    except ImportError:
        logger.warning("Database service not available")
        return None

    pool = get_db_pool()
    if not pool:
        return None

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not row:
            return None
        return dict(row)


@tool
async def get_project(project_id: str) -> str:
    """根据项目 ID 从数据库读取项目配置信息。

    返回字段包括：id、name、repo_url、openapi_spec、base_url、description。
    当用户消息中包含 <project_context> 块或上下文里只有 project_id 时，
    优先调用此工具获取完整项目信息，再执行后续操作。

    Args:
        project_id: 项目 ID（UUID 字符串）
    """
    if not project_id or not isinstance(project_id, str):
        return json.dumps({"error": "project_id must be a non-empty string"}, ensure_ascii=False)

    try:
        project = await _get_project_from_db(project_id)
    except Exception as e:  # noqa: BLE001
        logger.exception("Failed to fetch project %s", project_id)
        return json.dumps({"error": f"Database error: {e}"}, ensure_ascii=False)

    if not project:
        return json.dumps({"error": f"Project {project_id} not found"}, ensure_ascii=False)

    # Drop internal timestamps to keep the response compact.
    project.pop("created_at", None)
    project.pop("updated_at", None)

    return json.dumps(project, ensure_ascii=False, indent=2, default=str)


@tool
async def list_projects_tool() -> str:
    """列出数据库中所有已注册的项目。

    用于当用户没有指定项目、或需要确认项目存在时查找项目 ID。
    """
    try:
        from services.db import get_db_pool
    except ImportError:
        return json.dumps({"error": "Database service not available"}, ensure_ascii=False)

    pool = get_db_pool()
    if not pool:
        return json.dumps({"error": "Database not available"}, ensure_ascii=False)

    async def _query():
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, name, openapi_spec, base_url, repo_url, description "
                "FROM projects ORDER BY created_at DESC"
            )
            return [dict(r) for r in rows]

    try:
        projects = await _query()
    except Exception as e:  # noqa: BLE001
        logger.exception("Failed to list projects")
        return json.dumps({"error": f"Database error: {e}"}, ensure_ascii=False)

    return json.dumps({"projects": projects}, ensure_ascii=False, indent=2, default=str)


PROJECT_TOOLS = [
    get_project,
    list_projects_tool,
]

__all__ = [
    "get_project",
    "list_projects_tool",
    "PROJECT_TOOLS",
]
