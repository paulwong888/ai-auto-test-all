"""Database service — PostgreSQL connection and CRUD operations.

Tables:
- projects:    测试项目
- test_runs:   测试执行记录
- test_results: 测试结果详情
- api_endpoints: API 接口清单
- reports:     测试报告
"""
# 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
# 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
# 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
# 课程咨询请联系微信：huice666

from __future__ import annotations

import os
import asyncio
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

_pool: Any = None

POSTGRES_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "database": os.getenv("POSTGRES_DB", "api_test_platform"),
    "user": os.getenv("POSTGRES_USER", "postgres"),
    "password": os.getenv("POSTGRES_PASSWORD", "postgres"),
}


def get_db_pool():
    """Get the database connection pool."""
    return _pool


async def init_db() -> bool:
    """Initialize database connection and create tables."""
    global _pool
    try:
        import asyncpg

        _pool = await asyncpg.create_pool(
            host=POSTGRES_CONFIG["host"],
            port=POSTGRES_CONFIG["port"],
            database=POSTGRES_CONFIG["database"],
            user=POSTGRES_CONFIG["user"],
            password=POSTGRES_CONFIG["password"],
            min_size=2,
            max_size=10,
        )

        async with _pool.acquire() as conn:
            # Read migration SQL
            sql_path = os.path.join(os.path.dirname(__file__), "..", "migrations", "001_init.sql")
            if os.path.exists(sql_path):
                with open(sql_path, encoding="utf-8") as f:
                    await conn.execute(f.read())
                logger.info("Database tables initialized")
            else:
                logger.warning(f"Migration file not found: {sql_path}")

        logger.info("Database connected")
        return True
    except ImportError:
        logger.warning("asyncpg not installed — database disabled")
        return False
    except Exception as e:
        logger.warning(f"Database not available: {e}")
        _pool = None
        return False


async def close_db():
    """Close the database connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ── CRUD Operations ──


async def create_test_run(
    project_id: str,
    test_path: str = "",
    marker: str = "",
    status: str = "running",
) -> str:
    """Create a new test run record."""
    if not _pool:
        return ""
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO test_runs (project_id, test_path, marker, status, started_at)
               VALUES ($1, $2, $3, $4, $5) RETURNING id""",
            project_id, test_path, marker, status, datetime.utcnow(),
        )
        return str(row["id"])


async def update_test_run(
    run_id: str,
    status: str,
    passed: int = 0,
    failed: int = 0,
    skipped: int = 0,
    total: int = 0,
    duration_ms: int = 0,
    report_json: str = "",
) -> bool:
    """Update a test run with results."""
    if not _pool:
        return False
    async with _pool.acquire() as conn:
        await conn.execute(
            """UPDATE test_runs
               SET status = $2, passed = $3, failed = $4, skipped = $5,
                   total = $6, duration_ms = $7, report_json = $8,
                   finished_at = $9
               WHERE id = $1""",
            run_id, status, passed, failed, skipped, total,
            duration_ms, report_json, datetime.utcnow(),
        )
        return True


async def save_test_result(
    run_id: str,
    test_name: str,
    status: str,
    endpoint: str = "",
    method: str = "",
    duration_ms: int = 0,
    error_message: str = "",
) -> bool:
    """Save a single test result."""
    if not _pool:
        return False
    async with _pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO test_results (run_id, test_name, status, endpoint, method, duration_ms, error_message)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            run_id, test_name, status, endpoint, method, duration_ms, error_message,
        )
        return True


async def get_recent_runs(limit: int = 20) -> list[dict]:
    """Get recent test runs."""
    if not _pool:
        return []
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, project_id, test_path, marker, status,
                      passed, failed, skipped, total, duration_ms,
                      started_at, finished_at
               FROM test_runs ORDER BY started_at DESC LIMIT $1""",
            limit,
        )
        return [dict(r) for r in rows]


async def get_run_details(run_id: str) -> dict | None:
    """Get details of a specific test run."""
    if not _pool:
        return None
    async with _pool.acquire() as conn:
        run = await conn.fetchrow(
            "SELECT * FROM test_runs WHERE id = $1", run_id,
        )
        if not run:
            return None
        results = await conn.fetch(
            "SELECT * FROM test_results WHERE run_id = $1", run_id,
        )
        return {
            "run": dict(run),
            "results": [dict(r) for r in results],
        }