"""API Test Generation Tools — OpenAPI/Swagger parsing and test case generation.

Supports:
- Parsing OpenAPI 2.0 / 3.0 / 3.1 specs
- Extracting endpoints, methods, parameters, schemas
- Generating pytest test cases
- Generating test data (boundary values, edge cases)
"""
# 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
# 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
# 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
# 课程咨询请联系微信：huice666

from __future__ import annotations

import json
import os
import tempfile
import logging
from datetime import datetime
from pathlib import Path

import yaml
from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def _default_test_dir() -> Path:
    """Return the resolved default test suites directory."""
    env_dir = os.getenv("API_TEST_DIR")
    if env_dir:
        return Path(env_dir).resolve()
    return (Path.cwd() / "workspace" / "test_suites").resolve()


DEFAULT_TEST_DIR = _default_test_dir()


def parse_openapi_spec_impl(spec_path: str) -> str:
    """Underlying implementation for ``parse_openapi_spec`` (also used by the REST API)."""
    import urllib.request

    try:
        # Load spec
        if spec_path.startswith(("http://", "https://")):
            with urllib.request.urlopen(spec_path, timeout=30) as resp:
                content = resp.read().decode("utf-8")
        else:
            with open(spec_path, "r", encoding="utf-8") as f:
                content = f.read()

        # Parse JSON or YAML
        spec = json.loads(content) if content.strip().startswith("{") else yaml.safe_load(content)

        endpoints = []
        paths = spec.get("paths", {})

        for path, methods in paths.items():
            if not methods:
                continue
            for method, details in methods.items():
                if method.upper() not in ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
                    continue

                endpoint = {
                    "path": path,
                    "method": method.upper(),
                    "summary": details.get("summary", ""),
                    "description": (details.get("description", "") or "")[:200],
                    "tags": details.get("tags", []),
                    "parameters": [],
                    "request_body": None,
                    "responses": {},
                }

                # Parameters
                for param in details.get("parameters", []):
                    endpoint["parameters"].append({
                        "name": param.get("name"),
                        "in": param.get("in"),
                        "required": param.get("required", False),
                        "type": param.get("schema", {}).get("type", "string") if param.get("schema") else "string",
                        "description": (param.get("description", "") or "")[:100],
                    })

                # Request body
                if "requestBody" in details:
                    content = details["requestBody"].get("content", {})
                    if "application/json" in content:
                        schema = content["application/json"].get("schema", {})
                        endpoint["request_body"] = {
                            "required": details["requestBody"].get("required", False),
                            "schema_ref": schema.get("$ref", "").split("/")[-1] if "$ref" in schema else "",
                            "properties": list(schema.get("properties", {}).keys()) if "properties" in schema else [],
                        }

                # Responses
                for status, resp in details.get("responses", {}).items():
                    resp_content = resp.get("content", {})
                    ref = ""
                    if "application/json" in resp_content:
                        schema = resp_content["application/json"].get("schema", {})
                        ref = schema.get("$ref", "").split("/")[-1] if "$ref" in schema else ""
                    endpoint["responses"][status] = {
                        "description": (resp.get("description", "") or "")[:100],
                        "schema_ref": ref,
                    }

                endpoints.append(endpoint)

        return json.dumps({
            "title": spec.get("info", {}).get("title", "Unknown"),
            "version": spec.get("info", {}).get("version", "0.0.0"),
            "openapi_version": spec.get("openapi", spec.get("swagger", "unknown")),
            "base_url": spec.get("servers", [{}])[0].get("url", "") if "servers" in spec else "",
            "endpoint_count": len(endpoints),
            "endpoints": endpoints,
        }, ensure_ascii=False, indent=2)

    except Exception as e:
        return json.dumps({"error": f"Failed to parse OpenAPI spec: {str(e)}"}, ensure_ascii=False)


@tool
def parse_openapi_spec(spec_path: str) -> str:
    """解析 OpenAPI/Swagger 规范文件，提取 API 接口信息。

    支持：
    - OpenAPI 3.0 / 3.1 (JSON/YAML)
    - Swagger 2.0 (JSON/YAML)
    - 远程 URL 或本地文件

    返回接口清单：路径、方法、参数、响应结构。

    Args:
        spec_path: OpenAPI 规范文件路径或 URL
    """
    return parse_openapi_spec_impl(spec_path)


@tool
def generate_api_test_cases(
    spec_path: str,
    include_positive: bool = True,
    include_negative: bool = True,
    include_boundary: bool = True,
) -> str:
    """从 OpenAPI 规范生成 API 测试用例。

    自动分析接口定义，生成结构化测试用例：
    - 正向测试：正常请求，验证 200/201 响应
    - 负向测试：缺失必填字段、错误类型、无效值
    - 边界测试：空值、超长字符串、特殊字符

    输出格式与 test-generator 子智能体兼容。

    Args:
        spec_path: OpenAPI 规范文件路径或 URL
        include_positive: 是否生成正向测试用例
        include_negative: 是否生成负向测试用例
        include_boundary: 是否生成边界测试用例
    """
    import urllib.request

    try:
        # Load spec
        if spec_path.startswith(("http://", "https://")):
            with urllib.request.urlopen(spec_path, timeout=30) as resp:
                content = resp.read().decode("utf-8")
        else:
            with open(spec_path, "r", encoding="utf-8") as f:
                content = f.read()

        spec = json.loads(content) if content.strip().startswith("{") else yaml.safe_load(content)

        test_cases = []
        case_id = 0
        paths = spec.get("paths", {})

        for path, methods in paths.items():
            if not methods:
                continue
            for method, details in methods.items():
                if method.upper() not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                    continue

                tag = (details.get("tags", ["General"])[0] if details.get("tags") else "General")
                summary = details.get("summary", "")
                has_body = "requestBody" in details

                method_name = method.upper()
                path_slug = path.strip("/").replace("/", "_").replace("{", "").replace("}", "")

                # ── Positive tests ──
                if include_positive:
                    case_id += 1
                    status_ok = "201" if method_name in ("POST", "PUT", "PATCH") else "200"
                    test_cases.append({
                        "id": f"TC-{case_id:03d}",
                        "title": f"[{tag}] {method_name} {path} - 正常请求",
                        "priority": "high",
                        "category": "positive",
                        "preconditions": [f"API 服务正常运行", f"有效的认证凭据"],
                        "steps": [
                            {"type": "request", "method": method_name, "path": path,
                             "description": f"发送正常的 {method_name} 请求到 {path}",
                             "headers": {"Content-Type": "application/json"},
                             "body": "{}" if has_body else None,
                             "expected_status": status_ok,
                             "expected": f"响应状态码 {status_ok}"},
                            {"type": "assert", "description": "验证响应结构",
                             "expected": "响应包含预期字段"},
                        ],
                        "expected_result": f"API 返回 {status_ok}，响应数据正确",
                        "tags": [tag, method_name],
                    })

                # ── Negative tests ──
                if include_negative:
                    # Missing auth
                    case_id += 1
                    test_cases.append({
                        "id": f"TC-{case_id:03d}",
                        "title": f"[{tag}] {method_name} {path} - 无认证请求",
                        "priority": "high",
                        "category": "negative",
                        "preconditions": [],
                        "steps": [
                            {"type": "request", "method": method_name, "path": path,
                             "description": f"发送不带认证的 {method_name} 请求",
                             "headers": {},
                             "expected_status": "401",
                             "expected": "响应状态码 401"},
                        ],
                        "expected_result": "API 返回 401 Unauthorized",
                        "tags": [tag, method_name],
                    })

                    # Missing required fields (for POST/PUT/PATCH)
                    if has_body:
                        case_id += 1
                        test_cases.append({
                            "id": f"TC-{case_id:03d}",
                            "title": f"[{tag}] {method_name} {path} - 缺少必填字段",
                            "priority": "medium",
                            "category": "negative",
                            "preconditions": [],
                            "steps": [
                                {"type": "request", "method": method_name, "path": path,
                                 "description": "发送空 body 的请求",
                                 "headers": {"Content-Type": "application/json"},
                                 "body": "{}",
                                 "expected_status": "400|422",
                                 "expected": "响应状态码 400 或 422"},
                            ],
                            "expected_result": "API 返回验证错误",
                            "tags": [tag, method_name],
                        })

                # ── Boundary tests ──
                if include_boundary and has_body:
                    case_id += 1
                    test_cases.append({
                        "id": f"TC-{case_id:03d}",
                        "title": f"[{tag}] {method_name} {path} - 边界值测试",
                        "priority": "low",
                        "category": "boundary",
                        "preconditions": [],
                        "steps": [
                            {"type": "request", "method": method_name, "path": path,
                             "description": "发送超长/特殊字符的请求",
                             "headers": {"Content-Type": "application/json"},
                             "body": '{"name": "<script>alert(1)</script>", "description": "' + "A" * 10000 + '"}',
                             "expected_status": "400|422",
                             "expected": "API 应拒绝或处理异常输入"},
                        ],
                        "expected_result": "API 正确处理边界输入，不崩溃",
                        "tags": [tag, method_name],
                    })

        return json.dumps({
            "spec_title": spec.get("info", {}).get("title", "Unknown"),
            "spec_version": spec.get("info", {}).get("version", "0.0.0"),
            "total_cases": len(test_cases),
            "test_cases": test_cases,
        }, ensure_ascii=False, indent=2)

    except Exception as e:
        return json.dumps({"error": f"Failed to generate test cases: {str(e)}"}, ensure_ascii=False)


@tool
def generate_pytest_script(
    test_cases_json: str,
    base_url: str = "http://localhost:8000",
    output_file: str = "",
) -> str:
    """将测试用例 JSON 转换为可执行的 pytest 脚本。

    生成的脚本包含：
    - 完整的 pytest fixture（session, auth）
    - 参数化测试用例
    - 请求发送和响应断言
    - 测试报告配置

    Args:
        test_cases_json: 测试用例 JSON 字符串（generate_api_test_cases 的输出格式）
        base_url: API 基础 URL
        output_file: 输出文件路径（留空自动生成到 test_suites/）
    """
    try:
        import textwrap

        data = json.loads(test_cases_json)
        cases = data.get("test_cases", [])

        if not cases:
            return json.dumps({"error": "No test cases provided"}, ensure_ascii=False)

        # Group by tag
        grouped = {}
        for c in cases:
            tag = c.get("tags", ["General"])[0]
            grouped.setdefault(tag, []).append(c)

        script = textwrap.dedent(f'''\
        """Auto-generated API test suite — {data.get("spec_title", "API")} v{data.get("spec_version", "1.0")}

        Generated: {datetime.now().isoformat()}
        Base URL: {base_url}
        Total test cases: {len(cases)}
        """

        import pytest
        import requests
        import json

        BASE_URL = "{base_url}"


        @pytest.fixture(scope="session")
        def api_session():
            """Reusable HTTP session with auth."""
            session = requests.Session()
            session.headers.update({{"Content-Type": "application/json"}})
            # TODO: Configure auth - replace with actual auth logic
            # session.headers["Authorization"] = f"Bearer YOUR_TOKEN"
            yield session
            session.close()


        def _request(session, method, path, body=None, headers=None):
            """Send an API request and return the response."""
            url = f"{{BASE_URL}}{{path}}"
            kwargs = {{"timeout": 10}}
            if headers:
                kwargs["headers"] = headers
            if body is not None:
                kwargs["json"] = json.loads(body) if isinstance(body, str) else body
            return session.request(method, url, **kwargs)


        def _parse_status(expected: str):
            """Parse expected status string like '200' or '400|422'."""
            return [int(s) for s in expected.split("|")]

        ''')

        # Generate test functions
        for tag, group in grouped.items():
            script += f"\n\n# ═══════════════ {tag} ═══════════════\n"
            for tc in group:
                steps = tc.get("steps", [])
                req_step = next((s for s in steps if s["type"] == "request"), None)

                if not req_step:
                    continue

                func_name = tc["id"].lower().replace("-", "_")
                script += f'''
@pytest.mark.{tc.get("category", "positive")}
def test_{func_name}(api_session):
    """{tc["title"]}"""
    resp = _request(
        api_session,
        "{req_step.get("method", "GET")}",
        "{req_step.get("path", "/")}",
        body={json.dumps(req_step.get("body"))},
        headers={json.dumps(req_step.get("headers"))},
    )
    expected = _parse_status("{req_step.get("expected_status", "200")}")
    assert resp.status_code in expected, (
        f"Expected status {{expected}}, got {{resp.status_code}}: {{resp.text[:500]}}"
    )
    # Optional: validate response body
    if resp.status_code < 400 and resp.text:
        try:
            data = resp.json()
            assert data is not None
        except json.JSONDecodeError:
            pass  # Non-JSON response is OK for non-200 responses
'''

        # Write to file
        if not output_file:
            os.makedirs(DEFAULT_TEST_DIR, exist_ok=True)
            slug = data.get("spec_title", "api").lower().replace(" ", "_")
            output_file = f"{DEFAULT_TEST_DIR}/test_{slug}.py"

        with open(output_file, "w", encoding="utf-8") as f:
            f.write(script)

        return json.dumps({
            "output_file": output_file,
            "total_cases": len(cases),
            "groups": list(grouped.keys()),
            "message": f"Generated {len(cases)} test cases in {output_file}",
        }, ensure_ascii=False, indent=2)

    except Exception as e:
        return json.dumps({"error": f"Failed to generate pytest script: {str(e)}"}, ensure_ascii=False)


API_GEN_TOOLS = [
    parse_openapi_spec,
    generate_api_test_cases,
    generate_pytest_script,
]

__all__ = [
    "parse_openapi_spec",
    "parse_openapi_spec_impl",
    "generate_api_test_cases",
    "generate_pytest_script",
    "API_GEN_TOOLS",
    "DEFAULT_TEST_DIR",
]