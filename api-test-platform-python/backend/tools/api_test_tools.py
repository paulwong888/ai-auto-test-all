"""API Test Execution Tools — pytest-based test runner with rich output.

Supports:
- Running pytest test suites
- Single test execution
- OpenAPI contract validation via Schemathesis
- JSON schema validation
- Test result parsing
"""
# 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
# 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
# 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
# 课程咨询请联系微信：huice666

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import logging
import shutil
from datetime import datetime
from pathlib import Path

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def _default_test_dir() -> Path:
    """Return the resolved default test suites directory."""
    env_dir = os.getenv("API_TEST_DIR")
    if env_dir:
        return Path(env_dir).resolve()
    return (Path.cwd() / "workspace" / "test_suites").resolve()


DEFAULT_TEST_DIR = _default_test_dir()
PYTEST_TIMEOUT = int(os.getenv("PYTEST_TIMEOUT", "300"))


def _run_pytest(args: list[str], timeout: int = PYTEST_TIMEOUT, cwd: str | Path | None = None) -> dict:
    """Run pytest and return structured results."""
    cmd = [
        sys.executable, "-m", "pytest",
        "-v",
        "--tb=short",
        "--no-header",
        "--color=no",
        *args,
    ]
    effective_cwd = Path(cwd or DEFAULT_TEST_DIR)
    effective_cwd.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=str(effective_cwd),
        )
        return {
            "stdout": result.stdout[:5000],
            "stderr": result.stderr[:2000],
            "exit_code": result.returncode,
            "passed": result.returncode == 0,
        }
    except subprocess.TimeoutExpired:
        return {"error": f"Test execution timed out after {timeout}s", "passed": False}
    except FileNotFoundError:
        return {"error": "pytest not found. Install: pip install pytest", "passed": False}


def run_api_tests_impl(
    test_path: str = "",
    marker: str = "",
    parallel: int = 1,
    html_report: bool = False,
) -> str:
    """Underlying implementation for ``run_api_tests`` (also used by the REST API)."""
    args = []

    if test_path:
        args.append(test_path)
    if marker:
        args.extend(["-m", marker])
    if parallel > 1:
        args.extend(["-n", str(parallel)])
    if html_report:
        report_path = f"reports/api_test_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
        args.extend(["--html", report_path, "--self-contained-html"])

    result = _run_pytest(args)
    result["test_path"] = test_path or "all"
    result["marker"] = marker or "all"
    result["timestamp"] = datetime.now().isoformat()

    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def run_api_tests(
    test_path: str = "",
    marker: str = "",
    parallel: int = 1,
    html_report: bool = False,
) -> str:
    """运行 API 测试套件。

    执行 pytest 测试，支持：
    - 按目录/文件运行
    - 按 marker 筛选（smoke, critical, contract, regression）
    - 并行执行
    - HTML 报告生成

    Args:
        test_path: 测试文件或目录路径（相对于 test_suites/）
        marker: pytest marker 筛选（如 smoke, critical, contract）
        parallel: 并行 worker 数（默认 1）
        html_report: 是否生成 HTML 报告
    """
    return run_api_tests_impl(
        test_path=test_path,
        marker=marker,
        parallel=parallel,
        html_report=html_report,
    )


@tool
def run_single_test(test_name: str, test_file: str = "") -> str:
    """运行单个测试用例。

    用于快速验证单个 API 接口，不需要跑整个测试套件。
    支持 pytest -k 模式匹配。

    Args:
        test_name: 测试用例名称或关键字（如 "test_login_success"）
        test_file: 测试文件路径（可选，不指定则搜索全部）
    """
    args = ["-k", test_name]
    if test_file:
        args.append(test_file)

    result = _run_pytest(args)
    result["test_name"] = test_name

    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def run_api_request(
    method: str,
    url: str,
    headers: str = "",
    body: str = "",
    timeout: int = 30,
) -> str:
    """直接发送单个 HTTP 请求，用于单接口调试和快速验证。

    不依赖 pytest 脚本，直接调用目标接口并返回响应详情。
    支持 JSON / 文本 body，自动解析 JSON 响应。

    Args:
        method: HTTP 方法（GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS）
        url: 完整请求 URL
        headers: 请求头 JSON 字符串（如 '{"Authorization": "Bearer xxx"}'）
        body: 请求体字符串（JSON 会自动以 application/json 发送）
        timeout: 请求超时时间（秒，默认 30）
    """
    import requests

    try:
        headers_dict = json.loads(headers) if headers else {}
    except json.JSONDecodeError as e:
        return json.dumps(
            {"error": f"Headers must be valid JSON: {e}", "passed": False},
            ensure_ascii=False,
        )

    method = method.upper()
    request_kwargs: dict = {"timeout": timeout, "headers": headers_dict}

    if body:
        try:
            json_body = json.loads(body)
            request_kwargs["json"] = json_body
        except json.JSONDecodeError:
            request_kwargs["data"] = body.encode("utf-8")
            if "Content-Type" not in {k.lower(): k for k in headers_dict}:
                headers_dict["Content-Type"] = "application/json"

    try:
        resp = requests.request(method, url, **request_kwargs)
        content_type = resp.headers.get("Content-Type", "")
        try:
            if "application/json" in content_type:
                response_body = resp.json()
                response_body_str = json.dumps(response_body, ensure_ascii=False)
            else:
                response_body_str = resp.text
        except Exception:
            response_body_str = resp.text

        return json.dumps({
            "status_code": resp.status_code,
            "headers": dict(resp.headers),
            "body": response_body_str[:4000],
            "elapsed_ms": int(resp.elapsed.total_seconds() * 1000),
            "url": resp.url,
        }, ensure_ascii=False, indent=2)
    except requests.Timeout:
        return json.dumps(
            {"error": f"Request timed out after {timeout}s", "url": url, "passed": False},
            ensure_ascii=False,
        )
    except requests.RequestException as e:
        return json.dumps(
            {"error": f"Request failed: {e}", "url": url, "passed": False},
            ensure_ascii=False,
        )


@tool
def validate_api_contract(
    openapi_spec: str,
    base_url: str = "",
    endpoint: str = "",
    method: str = "",
) -> str:
    """验证 API 契约（OpenAPI/Swagger Contract Testing）。

    使用 Schemathesis 自动生成测试用例并验证 API 是否符合 OpenAPI 规范。
    支持：
    - 全量契约测试
    - 按 endpoint 筛选
    - 按 HTTP method 筛选

    Args:
        openapi_spec: OpenAPI 规范文件路径或 URL
        base_url: API 基础 URL（可选，覆盖 spec 中的 servers）
        endpoint: 特定 endpoint 路径（如 "/api/users"），留空测试全部
        method: HTTP method（如 GET, POST），留空测试全部
    """
    # 优先使用当前虚拟环境/解释器目录下的 schemathesis CLI 可执行文件
    schemathesis_bin: str | None = None
    candidate = Path(sys.executable).with_name(
        "schemathesis.exe" if sys.platform == "win32" else "schemathesis"
    )
    if candidate.exists():
        schemathesis_bin = str(candidate)
    else:
        schemathesis_bin = shutil.which("schemathesis")

    if not schemathesis_bin:
        return json.dumps(
            {"error": "schemathesis not found. Install: pip install schemathesis", "passed": False},
            ensure_ascii=False,
        )

    cmd = [
        schemathesis_bin,
        "run",
        openapi_spec,
        "--no-color",
        "--phases", "examples,coverage,fuzzing",
        "--workers", "2",
        "--max-examples", "5",
        "--request-timeout", "30",
    ]
    if base_url:
        cmd.extend(["--url", base_url])
    if endpoint:
        cmd.extend(["--include-path", endpoint])
    if method:
        cmd.extend(["--include-method", method.upper()])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        output = (result.stdout or "")[:4000]
        stderr = (result.stderr or "")[:2000]
        return json.dumps({
            "passed": result.returncode == 0,
            "output": output,
            "stderr": stderr,
            "exit_code": result.returncode,
        }, ensure_ascii=False, indent=2)
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "Contract validation timed out", "passed": False})
    except FileNotFoundError:
        return json.dumps(
            {"error": "schemathesis not found. Install: pip install schemathesis", "passed": False},
            ensure_ascii=False,
        )


@tool
def validate_json_schema(response_json: str, json_schema: str) -> str:
    """验证 JSON 响应是否符合指定的 JSON Schema。

    用于 API 测试中验证响应结构：
    - 字段类型是否正确
    - 必填字段是否存在
    - 嵌套结构是否正确

    Args:
        response_json: API 响应的 JSON 字符串
        json_schema: JSON Schema 定义字符串
    """
    try:
        from jsonschema import validate, ValidationError

        response = json.loads(response_json)
        schema = json.loads(json_schema)

        try:
            validate(instance=response, schema=schema)
            return json.dumps({"valid": True, "message": "Schema validation passed"}, ensure_ascii=False)
        except ValidationError as e:
            return json.dumps({
                "valid": False,
                "message": f"Schema validation failed: {e.message}",
                "path": list(e.path),
            }, ensure_ascii=False)
    except json.JSONDecodeError as e:
        return json.dumps({"valid": False, "message": f"JSON parse error: {str(e)}"}, ensure_ascii=False)
    except ImportError:
        return json.dumps({"valid": False, "message": "jsonschema not installed. Install: pip install jsonschema"}, ensure_ascii=False)


@tool
async def get_test_results(
    run_id: str = "",
    limit: int = 20,
) -> str:
    """获取历史测试执行结果。

    查询数据库中的测试运行记录，支持：
    - 按 run_id 查询单次运行详情
    - 最近的测试执行列表
    - 通过率统计

    Args:
        run_id: 运行 ID（留空返回最近列表）
        limit: 返回记录数（默认 20）
    """
    try:
        from services.db import get_db_pool

        pool = get_db_pool()
        if not pool:
            return json.dumps({"error": "Database not available"}, ensure_ascii=False)

        async def _query():
            async with pool.acquire() as conn:
                if run_id:
                    row = await conn.fetchrow(
                        """SELECT * FROM test_runs WHERE id = $1""",
                        run_id,
                    )
                    if row:
                        return {"run": dict(row)}
                    return {"error": f"Run {run_id} not found"}
                else:
                    rows = await conn.fetch(
                        """SELECT id, test_path, marker, status, passed, total,
                                  started_at, finished_at
                           FROM test_runs ORDER BY started_at DESC LIMIT $1""",
                        limit,
                    )
                    return {"runs": [dict(r) for r in rows]}

        result = await _query()
        return json.dumps(result, ensure_ascii=False, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


API_TEST_TOOLS = [
    run_api_tests,
    run_single_test,
    run_api_request,
    validate_api_contract,
    validate_json_schema,
    get_test_results,
]

__all__ = [
    "run_api_tests",
    "run_api_tests_impl",
    "run_single_test",
    "run_api_request",
    "validate_api_contract",
    "validate_json_schema",
    "get_test_results",
    "API_TEST_TOOLS",
]