"""Tools package — API testing platform tools.

3 tool groups:
- CODEGRAPH_TOOLS (4): Code change → API impact analysis
- API_TEST_TOOLS (5): Test execution, contract validation
- API_GEN_TOOLS (3): OpenAPI parsing, test case generation

Note: Low-level filesystem/shell tools (ls, read_file, execute, etc.) are
provided automatically by the DeepAgents backend when ``LocalShellBackend``
or ``CompositeBackend`` is configured in ``agent.py``.
"""
"""
版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。

本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。

授权商业应用请联系微信：huice666
"""


from tools.codegraph_tools import CODEGRAPH_TOOLS
from tools.api_test_tools import API_TEST_TOOLS
from tools.api_gen_tools import API_GEN_TOOLS
from tools.project_tools import PROJECT_TOOLS

# Code analysis tools
CODE_TOOLS = list(CODEGRAPH_TOOLS)

# API testing tools (execution + generation)
TEST_TOOLS = list(API_TEST_TOOLS)
GEN_TOOLS = list(API_GEN_TOOLS)

# Full tool set for api-tester
API_TOOLS = list(API_TEST_TOOLS) + list(API_GEN_TOOLS)

# Supervisor tools include project lookup so it can resolve context.project_id
SUPERVISOR_TOOLS: list = list(PROJECT_TOOLS)

__all__ = [
    "CODEGRAPH_TOOLS", "API_TEST_TOOLS", "API_GEN_TOOLS", "PROJECT_TOOLS",
    "CODE_TOOLS", "TEST_TOOLS", "GEN_TOOLS", "API_TOOLS",
    "SUPERVISOR_TOOLS",
]