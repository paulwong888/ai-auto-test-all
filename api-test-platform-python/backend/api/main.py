"""FastAPI Management API — REST endpoints for the API Test Platform.

Endpoints:
- GET  /health                    — Health check
- GET  /api/projects              — List projects
- POST /api/projects              — Create project
- GET  /api/projects/{id}         — Get project
- GET  /api/runs                  — List test runs
- GET  /api/runs/{id}             — Get run details
- GET  /api/runs/{id}/results     — Get run results
- GET  /api/endpoints?project_id= — List API endpoints
- GET  /api/reports?project_id=   — List reports
- POST /api/analyze               — Trigger code analysis
- POST /api/test                  — Trigger test execution
"""
# 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
# 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
# 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
# 课程咨询请联系微信：huice666

from __future__ import annotations

import json
import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from services.db import (
    get_db_pool,
    init_db,
    create_test_run,
    update_test_run,
    save_test_result,
)

# Re-use the same tool layer that the agents use so that the REST API
# and the conversational agent stay aligned.
from tools.codegraph_tools import codegraph_affected_impl as codegraph_affected
from tools.api_test_tools import run_api_tests_impl as run_api_tests
from tools.api_gen_tools import parse_openapi_spec_impl as parse_openapi_spec

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="但问智能 API 测试平台",
    description="Enterprise Intelligent API Test Platform — Management API",
    version="1.0.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ──

class ProjectCreate(BaseModel):
    name: str
    repo_url: str = ""
    openapi_spec: str = ""
    base_url: str = ""
    description: str = ""


class AnalyzeRequest(BaseModel):
    project_id: str = ""
    project_path: str = ""
    base_branch: str = "main"


class TestRequest(BaseModel):
    project_id: str = ""
    test_path: str = ""
    marker: str = ""
    parallel: int = 1


class EndpointSyncRequest(BaseModel):
    project_id: str


# ── Lifespan ──

# Startup/shutdown logic moved to the `_lifespan` context manager above.

# ── Health ──

@app.get("/health")
async def health():
    db_ok = get_db_pool() is not None
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "timestamp": datetime.utcnow().isoformat(),
    }


# ── Projects ──

@app.get("/api/projects")
async def list_projects():
    pool = get_db_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM projects ORDER BY created_at DESC")
        return [dict(r) for r in rows]


@app.post("/api/projects")
async def create_project(project: ProjectCreate):
    pool = get_db_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO projects (name, repo_url, openapi_spec, base_url, description)
               VALUES ($1, $2, $3, $4, $5) RETURNING *""",
            project.name, project.repo_url, project.openapi_spec,
            project.base_url, project.description,
        )
        return dict(row)


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    pool = get_db_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        return dict(row)


# ── Test Runs ──

@app.get("/api/runs")
async def list_runs(project_id: str = "", limit: int = 20):
    pool = get_db_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        if project_id:
            rows = await conn.fetch(
                """SELECT * FROM test_runs WHERE project_id = $1
                   ORDER BY started_at DESC LIMIT $2""",
                project_id, limit,
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM test_runs ORDER BY started_at DESC LIMIT $1", limit,
            )
        return [dict(r) for r in rows]


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    pool = get_db_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with pool.acquire() as conn:
        run = await conn.fetchrow("SELECT * FROM test_runs WHERE id = $1", run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        results = await conn.fetch(
            "SELECT * FROM test_results WHERE run_id = $1", run_id,
        )
        return {
            "run": dict(run),
            "results": [dict(r) for r in results],
        }


# ── Reports ──

@app.get("/api/reports")
async def list_reports(project_id: str = "", report_type: str = "", limit: int = 20):
    pool = get_db_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        query = "SELECT * FROM reports WHERE 1=1"
        params = []
        if project_id:
            params.append(project_id)
            query += f" AND project_id = ${len(params)}"
        if report_type:
            params.append(report_type)
            query += f" AND report_type = ${len(params)}"
        query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
        params.append(limit)
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]


# ── API Endpoints ──

@app.get("/api/endpoints")
async def list_endpoints(project_id: str = ""):
    """List API endpoints for a project.

    If a project_id is provided the endpoints are read from the database.
    Otherwise an empty list is returned.
    """
    pool = get_db_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        if project_id:
            rows = await conn.fetch(
                "SELECT * FROM api_endpoints WHERE project_id = $1 ORDER BY path, method",
                project_id,
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM api_endpoints ORDER BY path, method LIMIT 100",
            )
        return [dict(r) for r in rows]


@app.post("/api/endpoints/sync")
async def sync_endpoints(body: EndpointSyncRequest):
    """Parse a project's OpenAPI spec and persist the endpoint inventory.

    This is the same parsing logic used by the test-generator agent, keeping
    the REST API and the agent capabilities in sync.
    """
    pool = get_db_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    async with pool.acquire() as conn:
        project = await conn.fetchrow(
            "SELECT * FROM projects WHERE id = $1", body.project_id,
        )
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        openapi_spec = project.get("openapi_spec") or ""
        if not openapi_spec:
            raise HTTPException(
                status_code=400,
                detail="Project has no openapi_spec set",
            )

        parsed = await run_in_threadpool(parse_openapi_spec, openapi_spec)
        try:
            data = json.loads(parsed)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to parse OpenAPI spec result: {e}",
            ) from e

        endpoints = data.get("endpoints", [])
        inserted = 0
        for ep in endpoints:
            await conn.execute(
                """INSERT INTO api_endpoints
                   (project_id, path, method, summary, tags, parameters, request_body, responses)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   ON CONFLICT (project_id, path, method) DO UPDATE SET
                     summary = EXCLUDED.summary,
                     tags = EXCLUDED.tags,
                     parameters = EXCLUDED.parameters,
                     request_body = EXCLUDED.request_body,
                     responses = EXCLUDED.responses""",
                body.project_id,
                ep.get("path", ""),
                ep.get("method", ""),
                ep.get("summary", ""),
                ep.get("tags", []),
                ep.get("parameters", []),
                ep.get("request_body") or None,
                ep.get("responses", {}),
            )
            inserted += 1

        return {
            "project_id": body.project_id,
            "synced": inserted,
            "title": data.get("title", ""),
            "version": data.get("version", ""),
        }


# ── Agent-fused actions ──

@app.post("/api/analyze")
async def analyze_code(body: AnalyzeRequest):
    """Trigger code-change impact analysis.

    Uses the same CodeGraph tool that the code-analyzer sub-agent uses, so
    REST-driven and chat-driven workflows share a single analysis backend.
    """
    pool = get_db_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    project = None
    if body.project_id:
        async with pool.acquire() as conn:
            project = await conn.fetchrow(
                "SELECT * FROM projects WHERE id = $1", body.project_id,
            )
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

    project_path = body.project_path or (
        project.get("repo_url") if project else ""
    )

    raw = await run_in_threadpool(
        codegraph_affected,
        project_path=project_path,
        base_branch=body.base_branch,
    )
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"raw": raw}

    report_title = f"代码变更影响分析 — {body.base_branch}"
    content = json.dumps(result, ensure_ascii=False, indent=2)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO reports (project_id, title, report_type, content, format)
               VALUES ($1, $2, $3, $4, $5) RETURNING *""",
            (body.project_id or project.get("id")) if project else (body.project_id or None),
            report_title,
            "impact_analysis",
            content,
            "json",
        )

    return {
        "report": dict(row),
        "analysis": result,
    }


@app.post("/api/test")
async def run_tests(body: TestRequest):
    """Trigger API test execution.

    Uses the same pytest runner that the api-tester sub-agent uses. The run
    is recorded in the database so the frontend can poll or display history.
    """
    pool = get_db_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not available")

    run_id = await create_test_run(
        project_id=body.project_id or None,
        test_path=body.test_path,
        marker=body.marker,
        status="running",
    )

    if not run_id:
        raise HTTPException(status_code=503, detail="Database not available")

    raw = await run_in_threadpool(
        run_api_tests,
        test_path=body.test_path,
        marker=body.marker,
        parallel=body.parallel,
        html_report=False,
    )

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"raw": raw, "passed": False}

    passed = result.get("passed", False)
    status = "passed" if passed else "failed"

    # Heuristic counts when pytest structured output is not available.
    stdout = result.get("stdout", "")
    total = stdout.count("::")
    if total == 0:
        total = 1
    failed_count = stdout.lower().count("failed") if not passed else 0
    passed_count = total - failed_count

    await update_test_run(
        run_id=run_id,
        status=status,
        passed=passed_count,
        failed=failed_count,
        skipped=0,
        total=total,
        duration_ms=0,
        report_json=json.dumps(result, ensure_ascii=False),
    )

    await save_test_result(
        run_id=run_id,
        test_name=body.test_path or "api-test-run",
        status="passed" if passed else "failed",
        endpoint="",
        method="",
        duration_ms=0,
        error_message=result.get("stderr", "")[:1000],
    )

    return {
        "run_id": run_id,
        "status": status,
        "result": result,
    }


# ── Main ──

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8100"))
    uvicorn.run(app, host=host, port=port)
