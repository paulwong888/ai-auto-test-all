"""Agents package — sub-agent definitions.

4 sub-agents:
- code-analyzer: Code change → API impact analysis (CodeGraph)
- api-tester: API test execution (pytest + requests)
- test-generator: Test case generation (OpenAPI → pytest)
- report-writer: Test report generation (Markdown/JSON)
"""
"""
版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。

本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。

授权商业应用请联系微信：huice666
"""


from agents.code_analyzer import get_code_analyzer_config
from agents.api_tester import get_api_tester_config
from agents.test_generator import get_test_generator_config
from agents.report_writer import get_report_writer_config

__all__ = [
    "get_code_analyzer_config",
    "get_api_tester_config",
    "get_test_generator_config",
    "get_report_writer_config",
]