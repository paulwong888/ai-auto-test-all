"""Sales portal 登录账号数据工厂。

凭据从环境变量注入（安全要求，不写死明文），默认回退到 SIT 测试账号。
约定变量：
  - SALES_PORTAL_USERNAME
  - SALES_PORTAL_PASSWORD
  - SALES_PORTAL_WRONG_PASSWORD（TC002 错误密码；缺省时用派生错误密码）
  - SALES_PORTAL_POS_ACCOUNT（Choose user account 页 POS，默认 CRM-AUTOTEST-PREPAID001；
    Sim Only TC-100 用 CRM-AUTOTEST-PREPAID001；Direct Sale 用 CRM-AUTOTEST-SDIR；Fortress 用 CRM-AUTOTEST-FORTRESS）
  - SALES_PORTAL_SECOND_AGENT（Direct Sales 部门必填 Second Agent，默认 Test Agent）
  - SALES_PORTAL_FORTRESS_SHOP_ID（Fortress POS 必填 Shop ID，无代码默认值）
"""
import os

# crmautotest 下 POS → Payment Method（见 Portal new-payment）
POS_ACCOUNT_CASHIER = "CRM-AUTOTEST-PREPAID001"  # Cashier + Online Payment
POS_ACCOUNT_DIRECT_SALES = "CRM-AUTOTEST-SDIR"
POS_ACCOUNT_FORTRESS = "CRM-AUTOTEST-FORTRESS"
POS_ACCOUNT_SIM_ONLY = "CRM-AUTOTEST-PREPAID001"


def get_username() -> str:
    return os.getenv("SALES_PORTAL_USERNAME", "crmautotest")


def get_password() -> str:
    return os.getenv("SALES_PORTAL_PASSWORD", "crmautotest")


def get_wrong_password() -> str:
    return os.getenv("SALES_PORTAL_WRONG_PASSWORD", "wrong-password-SIT")


def get_pos_account() -> str:
    return os.getenv("SALES_PORTAL_POS_ACCOUNT", POS_ACCOUNT_CASHIER).strip()


def get_second_agent_name() -> str:
    return os.getenv("SALES_PORTAL_SECOND_AGENT", "Test Agent").strip()


def get_fortress_shop_id() -> str:
    shop_id = os.getenv("SALES_PORTAL_FORTRESS_SHOP_ID", "").strip()
    if not shop_id:
        raise RuntimeError(
            "缺少 SALES_PORTAL_FORTRESS_SHOP_ID。"
            "Fortress 用例请在 Dashboard 项目概览运行环境变量或 Worker env 中配置。"
        )
    return shop_id
