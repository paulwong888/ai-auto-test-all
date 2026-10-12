"""SIT Cashier：调用 crm-postpaid-api topupMultipleWallet 模拟门店销账。"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from typing import Any

from playwright.sync_api import Page

from pages.overlay_helpers import parse_footer_cart_amount

DEFAULT_TOPUP_URL = (
    "https://crm-postpaid-api-ogp-sit-crm.apps.ocpuat.three.com.hk"
    "/api/matrixx/THREE/THREE/THREE/null/topupMultipleWallet"
)

_CAPTURES: dict[int, dict[str, Any] | None] = {}

# Angular SimOnlyStorageService：键写在 localStorage[module].common 下（如 5g-bb），非顶层 key。
_READ_STORAGE_KEY_JS = """(key) => {
  const direct = localStorage.getItem(key) || sessionStorage.getItem(key);
  if (direct) return direct;
  const modules = [
    '5g-bb', '5g-bb-taihing', '5g-bb-hsbc', '5g-bb-in-base', '5g-bb-hos',
  ];
  for (const mod of modules) {
    const raw = localStorage.getItem(mod);
    if (!raw) continue;
    try {
      const bucket = JSON.parse(raw);
      const common = bucket && bucket.common;
      if (common && common[key] != null && common[key] !== '') {
        const v = common[key];
        return typeof v === 'string' ? v : JSON.stringify(v);
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}"""


def _transaction_id_from_capture(page: Page) -> str | None:
    data = _CAPTURES.get(id(page))
    if not isinstance(data, dict):
        return None
    for field in ("transactionId", "paymentTransactionId", "txnId", "refId"):
        val = data.get(field)
        if val is not None and str(val).strip():
            return str(val).strip()
    return None


def install_payment_txn_capture(page: Page) -> None:
    """监听 createTxn（onlinePayment POST）响应，供 topup 取 paymentAmount / cashierPayments。"""
    key = id(page)
    if key in _CAPTURES:
        return
    _CAPTURES[key] = None

    def on_response(response) -> None:
        try:
            if response.request.method != "POST":
                return
            if "onlinePayment" not in response.url:
                return
            if response.status not in (200, 201):
                return
            body = response.json()
            if not isinstance(body, dict):
                return
            data = body.get("data")
            if isinstance(data, dict):
                _CAPTURES[key] = data
        except Exception:
            pass

    page.on("response", on_response)


def _parse_storage_value(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    if text.startswith('"') and text.endswith('"'):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text.strip('"')
    return text


def read_payment_transaction_id(page: Page) -> str | None:
    raw = page.evaluate(_READ_STORAGE_KEY_JS, "PAYMENT_TRANSACTION_ID")
    parsed = _parse_storage_value(raw)
    if parsed:
        return parsed
    return _transaction_id_from_capture(page)


def read_draft_order_id(page: Page) -> str | None:
    for key in ("SIM_ONLY_DRAFT_ORDER_ID", "DRAFT_ORDER_ID"):
        raw = page.evaluate(_READ_STORAGE_KEY_JS, key)
        parsed = _parse_storage_value(raw)
        if parsed:
            return parsed
    return None


def read_total_price(page: Page) -> float | None:
    raw = page.evaluate(_READ_STORAGE_KEY_JS, "TOTAL_PRICE")
    parsed = _parse_storage_value(raw)
    if parsed is None:
        return None
    try:
        return float(parsed)
    except ValueError:
        return None


def _cashier_ids_from_txn(txn: dict[str, Any]) -> tuple[str | None, str | None]:
    cps = txn.get("cashierPayments")
    if not cps:
        return None, None
    if isinstance(cps, dict):
        cp = next(iter(cps.values()), None)
    elif isinstance(cps, list):
        cp = cps[0] if cps else None
    else:
        cp = next(iter(cps), None)
    if not isinstance(cp, dict):
        return None, None
    info = cp.get("paymentId")
    ptns = cp.get("paymentTxn") or []
    if isinstance(ptns, dict):
        ptns = list(ptns.values())
    pay_id = None
    if ptns and isinstance(ptns[0], dict):
        pay_id = ptns[0].get("payId")
    return (
        str(info) if info is not None else None,
        str(pay_id) if pay_id is not None else None,
    )


def _resolve_grant_amount(page: Page, txn: dict[str, Any] | None) -> float:
    if txn is not None:
        for key in ("paymentAmount", "totalAmount", "amount"):
            val = txn.get(key)
            if val is not None:
                return float(val)
    total = read_total_price(page)
    if total is not None:
        return total
    cart = parse_footer_cart_amount(page)
    if cart is not None:
        return float(cart)
    override = os.getenv("SALES_PORTAL_TOPUP_GRANT_AMOUNT")
    if override:
        return float(override)
    raise AssertionError(
        "无法解析 grantAmount：请设置 SALES_PORTAL_TOPUP_GRANT_AMOUNT，或确保 TOTAL_PRICE / 购物车金额可见"
    )


def build_topup_payload(page: Page) -> list[dict[str, Any]]:
    txn_id = read_payment_transaction_id(page)
    if not txn_id:
        raise AssertionError(
            "localStorage 缺少 PAYMENT_TRANSACTION_ID；请确认已进入 Step8 且 createTxn 成功"
        )

    captured = _CAPTURES.get(id(page))
    info, merchant_tran_id = _cashier_ids_from_txn(captured or {})
    draft = read_draft_order_id(page)
    if not info and draft:
        info = os.getenv("SALES_PORTAL_TOPUP_INFO", f"{draft}-105")
    if not merchant_tran_id and draft:
        merchant_tran_id = os.getenv("SALES_PORTAL_TOPUP_MERCHANT_TRAN_ID", f"{draft}-106")
    if not info or not merchant_tran_id:
        raise AssertionError(
            "无法解析 topup 的 info / merchantTranId；"
            "需 createTxn 响应含 cashierPayments，或 localStorage 有 SIM_ONLY_DRAFT_ORDER_ID，"
            "或设置 SALES_PORTAL_TOPUP_INFO / SALES_PORTAL_TOPUP_MERCHANT_TRAN_ID"
        )

    grant = _resolve_grant_amount(page, captured)
    return [
        {
            "externalId": "null",
            "walletExternalId": os.getenv(
                "SALES_PORTAL_TOPUP_WALLET_EXTERNAL_ID", "TPO_Fun_Topup_POS_Wallet"
            ),
            "catalogOfferId": os.getenv(
                "SALES_PORTAL_TOPUP_CATALOG_OFFER_ID", "TPO_Fun_Topup_POS_Wallet"
            ),
            "grantAmount": round(grant, 2),
            "reason": os.getenv("SALES_PORTAL_TOPUP_REASON", "MV_VI"),
            "info": info,
            "actionType": "SALES_PORTAL_PAYMENT",
            "isExtensionDay": False,
            "isEnableTopUpPromo": False,
            "operatorID": os.getenv("SALES_PORTAL_TOPUP_OPERATOR_ID", "MY3APP"),
            "channelID": os.getenv("SALES_PORTAL_TOPUP_CHANNEL_ID", "ONLINE"),
            "evoucherProductCode": "",
            "transactionRefId": txn_id,
            "merchantTranId": merchant_tran_id,
        }
    ]


def _topup_ssl_context() -> ssl.SSLContext | None:
    """SIT crm-api 常无公网 CA；默认不校验（与 Playwright ignore_https_errors 一致）。"""
    verify = os.getenv("SALES_PORTAL_TOPUP_SSL_VERIFY", "0").strip().lower()
    if verify in ("1", "true", "yes"):
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def post_topup_multiple_wallet(page: Page, payload: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """POST topupMultipleWallet（Bearer 用 env，勿写死 token）。"""
    bearer = os.getenv("SALES_PORTAL_CRM_API_BEARER", "").strip()
    if not bearer:
        raise AssertionError(
            "缺少 SALES_PORTAL_CRM_API_BEARER（crm-api Keycloak Bearer），无法调用 topupMultipleWallet"
        )
    url = os.getenv("SALES_PORTAL_TOPUP_URL", DEFAULT_TOPUP_URL)
    body = payload if payload is not None else build_topup_payload(page)
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {bearer}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120, context=_topup_ssl_context()) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise AssertionError(
            f"topupMultipleWallet HTTP {exc.code}: {err_body[:500]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise AssertionError(f"topupMultipleWallet 网络错误: {exc}") from exc

    try:
        parsed = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        parsed = {"raw": raw[:2000]}
    code = str(parsed.get("code", ""))
    if code and code not in ("0", "200"):
        raise AssertionError(f"topupMultipleWallet 业务失败: {parsed}")
    return parsed if isinstance(parsed, dict) else {"raw": raw}


def wait_for_payment_transaction_id(page: Page, *, timeout_ms: int = 60_000) -> str:
    txn = read_payment_transaction_id(page)
    if txn:
        return txn
    deadline = page.evaluate("() => Date.now()") + timeout_ms
    while page.evaluate("() => Date.now()") < deadline:
        txn = read_payment_transaction_id(page)
        if txn:
            return txn
        page.wait_for_timeout(500)
    raise AssertionError(
        f"{timeout_ms}ms 内未读到 PAYMENT_TRANSACTION_ID"
        "（已查顶层 localStorage、5g-bb.common 与 onlinePayment 响应）"
    )


def apply_sit_cashier_topup(page: Page) -> None:
    """Step8 Cashier：topup → 再 Check Payment Status。"""
    wait_for_payment_transaction_id(page)
    post_topup_multiple_wallet(page)
    page.wait_for_timeout(1_000)
