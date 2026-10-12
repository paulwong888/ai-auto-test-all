"""Sales portal 登录账号数据工厂。

凭据从环境变量注入（安全要求，不写死明文），默认回退到 SIT 测试账号。
约定变量：
  - SALES_PORTAL_USERNAME
  - SALES_PORTAL_PASSWORD
  - SALES_PORTAL_WRONG_PASSWORD（TC002 错误密码；缺省时用派生错误密码）
  - SALES_PORTAL_POS_ACCOUNT（Choose user account 页 POS，默认 CRM-PAULHP-01）
"""
import os

# paulhp 下可选 POS → Payment Method 能力（见 Portal new-payment）
POS_ACCOUNT_CASHIER = "CRM-PAULHP-01"
POS_ACCOUNT_DIRECT_SALES = "CRM-PAULHP-SDIR"
POS_ACCOUNT_FORTRESS = "CRM-PAULHP-FORTRESS"


def get_username() -> str:
    return os.getenv("SALES_PORTAL_USERNAME", "paulhp")


def get_password() -> str:
    return os.getenv("SALES_PORTAL_PASSWORD", "#Support1001")


def get_wrong_password() -> str:
    return os.getenv("SALES_PORTAL_WRONG_PASSWORD", "wrong-password-SIT")


def get_pos_account() -> str:
    return os.getenv("SALES_PORTAL_POS_ACCOUNT", POS_ACCOUNT_CASHIER).strip()
