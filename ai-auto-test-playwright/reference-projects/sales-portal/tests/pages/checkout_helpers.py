"""从申请长表单进入 SIM / 结账步。"""
import re

from playwright.sync_api import Page, expect


def _sim_visible(page: Page) -> bool:
    body = page.locator("body").inner_text()
    if re.search(r"Primary Sim", body, re.I):
        return True
    if page.get_by_role("checkbox", name=re.compile(r"agree|read", re.I)).count() > 0:
        return True
    return page.get_by_role("checkbox", name="I have read and agree to the").count() > 0


def proceed_to_sim_step(page: Page) -> None:
    """录制：付款后一次 chevron；若仍无 SIM 文案则尝试打开底部购物车侧栏内的继续/结账。"""
    if _sim_visible(page):
        return
    canvas = page.locator(".flex-body canvas:visible").last
    if canvas.count() > 0:
        box = canvas.bounding_box()
        if box:
            canvas.click(
                position={"x": box["width"] * 0.6, "y": box["height"] * 0.35},
                force=True,
            )
        else:
            canvas.click(force=True)
    chev = page.locator(".flex-body .pi.pi-chevron-right:visible").first
    if chev.count() > 0:
        chev.scroll_into_view_if_needed()
        chev.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)
    if _sim_visible(page):
        return
    alt = page.locator(".pi.pi-chevron-right:visible").filter(
        has_not=page.locator(".p-sidebar, .h-shop-cart")
    ).first
    if alt.count() > 0:
        alt.scroll_into_view_if_needed()
        alt.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)
    if _sim_visible(page):
        return
    # 底部金额条打开购物车（SIT 部分版本 SIM 在侧栏/checkout）
    footer = page.locator(".flex-body").get_by_text(re.compile(r"\$\s*\d")).last
    if footer.count() > 0:
        footer.click()
        page.wait_for_timeout(600)
    drawer = page.locator(".h-shop-cart.p-sidebar-active, .p-sidebar-active")
    if drawer.count() > 0 and drawer.first.is_visible():
        for label in ("Checkout", "Continue", "Next", "Proceed", "Confirm"):
            btn = drawer.first.get_by_role("button", name=re.compile(label, re.I))
            if btn.count() > 0:
                btn.first.click()
                page.wait_for_load_state("networkidle")
                break
    sim_marker = page.get_by_text(re.compile(r"Primary Sim", re.I))
    if sim_marker.count() > 0:
        expect(sim_marker.first).to_be_visible(timeout=30_000)
        return
    expect(page.get_by_role("textbox").first).to_be_visible(timeout=30_000)
