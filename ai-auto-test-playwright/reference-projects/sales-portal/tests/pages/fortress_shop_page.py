"""Fortress Payment Shop — Customer Profile 手风琴内 Shop ID 校验。"""
import re

from playwright.sync_api import Page, expect

from data.account_factory import get_fortress_shop_id
from pages.activation_date_page import ActivationDatePage
from pages.overlay_helpers import dismiss_shop_cart_drawer

FORTRESS_SHOP_TAB_RE = re.compile(r"Fortress Payment Shop", re.I)
HEADER_SHOP_RE = re.compile(
    r"\|\s*([A-Za-z0-9]+)\s*\|\s*Fortress\s+Payment", re.I
)
KYC_STEP_RE = re.compile(r"Test ID|Credit Check|HKID|香港身份", re.I)
SHOP_ID_LABEL_RE = re.compile(r"^Shop ID$", re.I)
SHOP_ID_ERROR_RE = re.compile(
    r"Shop ID Not Found|Invalid Fortress Shop ID|cannot find Fortress shop|Verify Failed",
    re.I,
)


class FortressShopPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def _body_text(self) -> str:
        return self.page.locator("body").inner_text()

    def _header_shop_id(self) -> str | None:
        m = HEADER_SHOP_RE.search(self._body_text())
        return m.group(1).strip() if m else None

    def complete_activation_date_if_present(self) -> None:
        """FORTRESS POS 选套餐后常先进入激活日，再进入 Customer Profile / KYC。"""
        ActivationDatePage(self.page).advance_past_activation_date(pick_first_cell=True)

    def prepare_after_select_offer(self) -> None:
        """选套餐后：激活日 → Fortress 手风琴 Shop ID（env）校验。

        页眉 ``| B001 | Fortress Payment`` 来自 agentDetail.shopId（CRM 门店）；
        手风琴校验走 findFortressShop 白名单，二者通常不同（例如页眉 B001、env 649）。
        """
        self.complete_activation_date_if_present()
        expected = get_fortress_shop_id().strip()
        header = self._header_shop_id()
        if header and header.upper() == expected.upper():
            return
        try:
            self.fill_and_verify_shop_id(expected)
        except AssertionError as exc:
            if "未找到 Fortress Shop ID 输入框" not in str(exc):
                raise
            raise AssertionError(
                f"无法配置 Fortress Shop ID（期望 {expected!r}，页眉 agent shop={header!r}）。"
                "请确认 SALES_PORTAL_FORTRESS_SHOP_ID 在 SIT fortressPaymentShop 列表中。"
            ) from exc

    def expand_fortress_shop_section(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        tab = self.page.get_by_role("button", name=FORTRESS_SHOP_TAB_RE)
        if tab.count() == 0:
            return
        for i in range(tab.count()):
            candidate = tab.nth(i)
            try:
                if not candidate.is_visible():
                    continue
                if candidate.get_attribute("aria-expanded") == "false":
                    candidate.scroll_into_view_if_needed()
                    candidate.click()
                    self.page.wait_for_timeout(400)
                return
            except Exception:
                candidate.click(force=True)
                self.page.wait_for_timeout(400)
                return

    def _shop_id_input(self):
        for candidate in (
            self.page.get_by_role("textbox", name=SHOP_ID_LABEL_RE),
            self.page.get_by_placeholder(re.compile(r"Please enter Shop ID", re.I)),
            self.page.locator(
                'input[formcontrolname="shopId"], input[formControlName="shopId"]'
            ),
        ):
            if candidate.count() > 0:
                return candidate.first
        return self.page.locator("input#shopId, input.shop-id").first

    def _visible_shop_id_errors(self) -> list[str]:
        errors: list[str] = []
        for sel in (".p-toast-message-text", ".p-message-error", "[role='alert']"):
            loc = self.page.locator(sel).filter(has_text=SHOP_ID_ERROR_RE)
            for i in range(loc.count()):
                try:
                    if loc.nth(i).is_visible():
                        errors.append(loc.nth(i).inner_text().strip())
                except Exception:
                    continue
        body = self.page.locator("body").inner_text()
        for m in SHOP_ID_ERROR_RE.finditer(body):
            snippet = m.group(0)
            if snippet not in errors:
                errors.append(snippet)
        return errors

    def fill_and_verify_shop_id(self, shop_id: str | None = None) -> None:
        """选套餐后填写 Fortress Shop ID 并等待 SIT 校验通过。"""
        value = (shop_id or get_fortress_shop_id()).strip()
        self.expand_fortress_shop_section()
        inp = self._shop_id_input()
        try:
            expect(inp).to_be_visible(timeout=15_000)
        except AssertionError:
            self.expand_fortress_shop_section()
            inp = self._shop_id_input()
            try:
                expect(inp).to_be_visible(timeout=15_000)
            except AssertionError as exc:
                raise AssertionError(
                    "未找到 Fortress Shop ID 输入框（Fortress Payment Shop 手风琴）。"
                    "请确认 POS 为 CRM-AUTOTEST-FORTRESS 且已进入申请向导。"
                ) from exc
        current = ""
        try:
            current = (inp.input_value() or "").strip()
        except Exception:
            pass
        if current != value:
            inp.fill("")
            inp.fill(value)
        inp.press("Tab")
        self.page.wait_for_load_state("networkidle")
        for _ in range(40):
            errs = self._visible_shop_id_errors()
            if errs:
                raise AssertionError(
                    f"Fortress Shop ID 校验失败: {errs[0]!r}（shopId={value!r}）"
                )
            try:
                if (inp.input_value() or "").strip() == value:
                    return
            except Exception:
                pass
            self.page.wait_for_timeout(500)
        raise AssertionError(
            f"Fortress Shop ID 在超时内未完成校验（shopId={value!r}）。"
            "请检查 SALES_PORTAL_FORTRESS_SHOP_ID 或 SIT Fortress shop 列表。"
        )
