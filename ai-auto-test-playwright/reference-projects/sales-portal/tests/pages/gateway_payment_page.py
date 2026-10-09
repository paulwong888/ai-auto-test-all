"""支付网关弹窗页（paygwuat.hthk.com）— 对齐录制 sales-portal-5GBB-0929。"""
import re

from playwright.sync_api import BrowserContext, Page, expect

from data.credit_card_factory import get_gateway_card

# 选 Online Payment 后 popup / 手动打开网关：不可达时秒级失败，避免 90s+180s 空等
PREFLIGHT_TIMEOUT_MS = 8_000
GATEWAY_GOTO_TIMEOUT_MS = 20_000
GATEWAY_DOM_TIMEOUT_MS = 10_000
GATEWAY_READY_TIMEOUT_MS = 15_000

GATEWAY_URL_HINT = re.compile(r"paygwuat|checkout/transaction|three\.com\.hk", re.I)
CONN_ERR_RE = re.compile(
    r"can't be reached|ERR_CONNECTION|took too long|DNS_PROBE|NET::ERR|chrome-error",
    re.I,
)

GATEWAY_HOST = "wwwuat.three.com.hk"


def gateway_connection_error(page: Page) -> str | None:
    try:
        url = page.url or ""
    except Exception:
        return "page closed"
    if "chrome-error" in url.lower():
        return f"browser error page ({url})"
    try:
        body = page.locator("body").inner_text()
    except Exception:
        return None
    if CONN_ERR_RE.search(body):
        return body[:400]
    if CONN_ERR_RE.search(url):
        return url
    return None


def preflight_payment_gateway(ctx: BrowserContext, *, host: str = GATEWAY_HOST) -> None:
    """Worker 到 wwwuat 不通时在选 Online Payment 后立刻失败。"""
    probe = f"https://{host}/"
    try:
        ctx.request.get(probe, timeout=PREFLIGHT_TIMEOUT_MS, fail_on_status_code=False)
    except Exception as exc:
        raise AssertionError(
            "支付网关 host 不可达（worker 无法访问 wwwuat.three.com.hk）。"
            "请为 ai-auto-test-playwright-worker 配置内网 DNS/路由后再 Run。"
            f" probe={probe!r} err={exc!r}"
        ) from exc


def assert_gateway_reachable(page: Page, *, context: str = "") -> None:
    """popup / 新 tab 打开后快速判定是否为 Chrome 网络错误页。"""
    suffix = f" {context}" if context else ""
    try:
        page.wait_for_load_state("domcontentloaded", timeout=GATEWAY_DOM_TIMEOUT_MS)
    except Exception:
        pass

    conn_err = gateway_connection_error(page)
    if conn_err:
        raise AssertionError(
            "支付网关页无法访问"
            f"{suffix}。请检查 worker 到 wwwuat.three.com.hk 的路由。"
            f" URL={page.url!r} 页面={conn_err[:200]}"
        )

    pay_btn = page.get_by_role("button", name="付款")
    if pay_btn.count() > 0:
        try:
            if pay_btn.first.is_visible():
                return
        except Exception:
            pass

    if GATEWAY_URL_HINT.search(page.url or ""):
        return

    for _ in range(6):
        conn_err = gateway_connection_error(page)
        if conn_err:
            raise AssertionError(
                f"支付网关页无法访问{suffix}。URL={page.url!r} 页面={conn_err[:200]}"
            )
        if pay_btn.count() > 0:
            try:
                if pay_btn.first.is_visible():
                    return
            except Exception:
                pass
        page.wait_for_timeout(500)

    raise AssertionError(
        f"支付网关页无响应{suffix}（{GATEWAY_READY_TIMEOUT_MS}ms 内未见「付款」按钮）。"
        f" URL={page.url!r}"
    )


def gateway_page_usable(page: Page) -> bool:
    try:
        assert_gateway_reachable(page)
        return True
    except AssertionError:
        return False


class GatewayPaymentPage:
    _NAME_FIELD_RE = re.compile(r"名字\s*\*?")
    _SURNAME_FIELD_RE = re.compile(r"姓氏\s*\*?")

    def __init__(self, page: Page) -> None:
        self.page = page

    def wait_ready(self) -> None:
        assert_gateway_reachable(self.page, context="（wait_ready）")
        expect(self.page.get_by_role("button", name="付款").first).to_be_visible(
            timeout=GATEWAY_READY_TIMEOUT_MS
        )

    def _raise_if_payment_alert(self) -> None:
        alert = self.page.get_by_role("alert")
        if alert.count() == 0:
            return
        try:
            if not alert.first.is_visible():
                return
            txt = (alert.first.inner_text() or "").strip()
        except Exception:
            return
        if txt:
            raise AssertionError(f"支付页 alert 阻止继续：{txt[:400]}")

    def _name_field(self):
        for root in (self.page, *self.page.frames):
            loc = root.get_by_role("textbox", name=self._NAME_FIELD_RE)
            if loc.count() > 0:
                return loc.first
        return self.page.get_by_role("textbox", name=self._NAME_FIELD_RE).first

    def _surname_field(self):
        for root in (self.page, *self.page.frames):
            loc = root.get_by_role("textbox", name=self._SURNAME_FIELD_RE)
            if loc.count() > 0:
                return loc.first
        return self.page.get_by_role("textbox", name=self._SURNAME_FIELD_RE).first

    def _name_field_visible(self) -> bool:
        try:
            field = self._name_field()
            return field.count() > 0 and field.is_visible()
        except Exception:
            return False

    def _enter_card_form(self) -> None:
        """wwwuat 汇总页只有金额+付款；paygwuat 需先点 Visa / 付款 才出现填卡区。"""
        if self._name_field_visible():
            return

        self._raise_if_payment_alert()

        visa = self.page.get_by_role("img", name=re.compile(r"^Visa$", re.I))
        if visa.count() > 0:
            try:
                visa.first.click()
                self.page.wait_for_timeout(600)
            except Exception:
                pass
        if self._name_field_visible():
            return

        section = self.page.locator(".d-flex.py-4").first
        if section.count() > 0:
            try:
                if section.is_visible():
                    section.click()
                    self.page.wait_for_timeout(600)
            except Exception:
                pass
        if self._name_field_visible():
            return

        pay = self.page.get_by_role("button", name="付款").first
        expect(pay).to_be_visible(timeout=10_000)
        pay.scroll_into_view_if_needed()
        try:
            with self.page.expect_navigation(timeout=20_000, wait_until="domcontentloaded"):
                pay.click(force=True)
        except Exception:
            pay.click(force=True)
            self.page.wait_for_load_state("domcontentloaded")

        for _ in range(40):
            self._raise_if_payment_alert()
            if self._name_field_visible():
                return
            if re.search(r"paygwuat", self.page.url or "", re.I):
                break
            self.page.wait_for_timeout(500)

        expect(self._name_field()).to_be_visible(timeout=15_000)

    def fill_payer(self) -> None:
        card = get_gateway_card()
        self._enter_card_form()
        first = self._name_field()
        expect(first).to_be_visible(timeout=15_000)
        first.fill(card["first_name"])
        self._surname_field().fill(card["last_name"])

    def _loc_in_form(self, factory):
        for root in (self.page, *self.page.frames):
            loc = factory(root)
            if loc.count() > 0:
                return loc.first
        return factory(self.page).first

    def fill_card(self) -> None:
        card = get_gateway_card()
        visa = self._loc_in_form(lambda r: r.get_by_role("radio", name="Visa"))
        if visa.count() > 0:
            visa.check(force=True)
        self._loc_in_form(
            lambda r: r.get_by_role("textbox", name=re.compile(r"信用卡號碼\s*\*?"))
        ).fill(card["number"])
        self._loc_in_form(lambda r: r.get_by_label(re.compile(r"到期月份\s*\*?"))).select_option(
            card["month"]
        )
        self._loc_in_form(lambda r: r.get_by_label(re.compile(r"到期年份\s*\*?"))).select_option(
            card["year"]
        )
        self._loc_in_form(
            lambda r: r.get_by_role("textbox", name=re.compile(r"CVN\s*\*?"))
        ).fill(card["cvn"])

    def submit_pay(self) -> None:
        pay_btn = self.page.get_by_role("button", name="付款").last
        expect(pay_btn).to_be_enabled(timeout=15_000)
        pay_btn.click()
        self.page.wait_for_url(
            re.compile(r"purchaseStatus=SUCCESS|checkout/transaction|redirectView|three\.com\.hk"),
            timeout=120_000,
        )

    def complete_payment(self) -> None:
        """录制：进入填卡页 → 填表 → 付款 → 等待成功回跳。"""
        self.wait_ready()
        self.fill_payer()
        self.fill_card()
        self.submit_pay()
