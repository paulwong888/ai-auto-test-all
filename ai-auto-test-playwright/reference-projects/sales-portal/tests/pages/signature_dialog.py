"""通用签名弹窗（多阶段复用：付款签名、条款同意、实名签署）。

所有 canvas 签名统一经本类，避免各 Page Object 重复脆弱定位器。
"""
from playwright.sync_api import Page, expect


class SignatureDialog:
    def __init__(self, page: Page, dialog_name: str | None = None) -> None:
        self.page = page
        if dialog_name:
            self.dialog = page.get_by_role("dialog", name=dialog_name)
            self.canvas = self.dialog.locator("canvas").first
        else:
            self.dialog = None
            self.canvas = page.locator("canvas:visible").first

    def sign(self, *, confirm: bool | None = None) -> None:
        """在 canvas 上画一笔签名；仅弹窗签名需要点 Confirm（录制：付款弹窗 Confirm，页内 canvas 无 Confirm）。"""
        if confirm is None:
            confirm = self.dialog is not None
        if self.dialog is not None:
            expect(self.dialog).to_be_visible(timeout=15_000)
        expect(self.canvas).to_be_visible(timeout=15_000)
        box = self.canvas.bounding_box()
        if box is not None:
            self.canvas.click(position={"x": box["width"] * 0.4, "y": box["height"] * 0.5})
            self.canvas.click(position={"x": box["width"] * 0.6, "y": box["height"] * 0.5})
        else:
            self.canvas.click()
        if not confirm:
            return
        confirm_btn = (
            self.dialog.get_by_role("button", name="Confirm").first
            if self.dialog is not None
            else self.page.get_by_role("button", name="Confirm").first
        )
        expect(confirm_btn).to_be_visible(timeout=15_000)
        confirm_btn.click()
        if self.dialog is not None:
            expect(self.dialog).to_be_hidden(timeout=15_000)

    def expect_closed(self) -> None:
        if self.dialog is not None:
            expect(self.dialog).to_be_hidden(timeout=15_000)
