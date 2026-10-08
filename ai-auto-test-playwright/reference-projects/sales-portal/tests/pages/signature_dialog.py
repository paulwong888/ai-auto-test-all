"""通用签名弹窗（多阶段复用：付款签名、条款同意、实名签署）。

所有 canvas 签名统一经本类，避免各 Page Object 重复脆弱定位器。
"""
import re

from playwright.sync_api import Locator, Page, expect

# 录制 sales-portal-5GBB-0929.py 弹窗 canvas 坐标，归一化至 bounding box
DIALOG_STROKE_RATIOS: list[tuple[float, float]] = [
    (0.643, 0.078),
    (0.540, 0.928),
    (0.685, 0.844),
    (0.703, 0.833),
    (0.864, 0.456),
    (0.925, 0.800),
]

# 录制 sales-portal-order.py L57 页内 canvas 点击（Customer Consent）
RECORDED_CONSENT_CANVAS_POS = {"x": 769, "y": 113}

# 录制页内条款 canvas 坐标（付款后、chevron 前）
INLINE_STROKE_RATIOS: list[tuple[float, float]] = [
    (0.509, 0.140),
    (0.412, 0.795),
    (0.615, 0.765),
    (0.659, 0.825),
    (0.940, 0.485),
    (0.999, 0.770),
]


def expand_consent_signature_section(page: Page) -> None:
    """展开 Customer Consent Signature 手风琴，确保页内 canvas 可见。"""
    for pattern in (r"Customer Consent Signature", r"Customer Consent"):
        consent = page.get_by_role("button", name=re.compile(pattern, re.I))
        if consent.count() > 0:
            try:
                if consent.first.get_attribute("aria-expanded") == "false":
                    consent.first.click()
                    page.wait_for_timeout(400)
            except Exception:
                consent.first.click(force=True)
                page.wait_for_timeout(400)
            break
    page.wait_for_timeout(200)


def canvas_has_ink(canvas: Locator) -> bool:
    try:
        return bool(
            canvas.evaluate(
                """(c) => {
                    const ctx = c.getContext('2d');
                    if (!ctx || !c.width || !c.height) return false;
                    const data = ctx.getImageData(0, 0, c.width, c.height).data;
                    for (let i = 3; i < data.length; i += 4) {
                        if (data[i] > 0) return true;
                    }
                    return false;
                }"""
            )
        )
    except Exception:
        return False


def _consent_region(page: Page) -> Locator:
    region = page.get_by_role("region", name=re.compile(r"Customer Consent Signature", re.I))
    if region.count() > 0:
        return region.first
    return _please_sign_here_root(page)


def _please_sign_here_root(page: Page) -> Locator:
    """仅 Customer Consent / Please sign here 区（不含信用卡 Signature 弹窗 pad）。"""
    for loc in (
        page.locator(".signature-section").filter(has_text=re.compile(r"Please sign here", re.I)),
        page.locator(".flex-body").filter(has_text=re.compile(r"Please sign here", re.I)),
        page.get_by_role("region", name=re.compile(r"Customer Consent Signature", re.I)),
    ):
        if loc.count() > 0:
            return loc.first
    return page.locator(".flex-body").filter(has_text=re.compile(r"Please sign here", re.I)).first


def _consent_canvas_locators(page: Page) -> list[Locator]:
    """Consent 区 canvas（限定 Please sign here 容器，避免误用信用卡 pad）。"""
    expand_consent_signature_section(page)
    root = _please_sign_here_root(page)
    if root.count() == 0:
        return []
    found: list[Locator] = []
    for sel in (
        "crm-common-signature-pad canvas.canvas-container:visible",
        "crm-common-signature-pad canvas:visible",
        "canvas:visible",
    ):
        loc = root.locator(sel)
        if loc.count() > 0:
            found.append(loc.first)
            break
    return found


def consent_signature_canvas(page: Page) -> Locator:
    """Customer Consent 区页内 canvas（非信用卡弹窗）。"""
    locators = _consent_canvas_locators(page)
    if locators:
        return locators[0]
    return inline_signature_canvas(page)


def _signature_model_value(page: Page) -> str:
    """crm-common-signature-pad：hidden input base64 或 ng-valid 标记（仅 Consent 区）。"""
    try:
        return page.evaluate(
            """() => {
              const pads = [];
              const pushPad = (root) => {
                if (!root) return;
                root.querySelectorAll('crm-common-signature-pad').forEach(p => {
                  if (!p.closest('[role="dialog"]')) pads.push(p);
                });
              };
              for (const r of document.querySelectorAll('[role="region"]')) {
                const label = r.getAttribute('aria-label') || '';
                if (/customer consent signature/i.test(label)) pushPad(r);
              }
              pushPad(document.querySelector('.signature-section'));
              for (const el of document.querySelectorAll('.flex-body, p-accordiontab')) {
                if (/please sign here/i.test(el.textContent || '')) pushPad(el);
              }
              for (const pad of pads) {
                for (const input of pad.querySelectorAll('input, textarea')) {
                  const v = input.value || '';
                  if (v.length > 40) return v;
                }
                if (pad.classList.contains('ng-valid') && !pad.classList.contains('ng-invalid')) {
                  const canvas = pad.querySelector('canvas');
                  if (canvas) {
                    const ctx = canvas.getContext('2d');
                    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                    for (let i = 3; i < d.length; i += 4) {
                      if (d[i] > 0) return 'ng-valid-ink';
                    }
                  }
                }
              }
              return '';
            }"""
        )
    except Exception:
        return ""


def _consent_pad_has_ink(page: Page) -> bool:
    try:
        return bool(
            page.evaluate(
                """() => {
                  const pads = [];
                  const pushPad = (root) => {
                    if (!root) return;
                    root.querySelectorAll('crm-common-signature-pad').forEach(p => {
                      if (!p.closest('[role="dialog"]')) pads.push(p);
                    });
                  };
                  for (const r of document.querySelectorAll('[role="region"]')) {
                    if (/customer consent signature/i.test(r.getAttribute('aria-label') || '')) pushPad(r);
                  }
                  pushPad(document.querySelector('.signature-section'));
                  for (const el of document.querySelectorAll('.flex-body, p-accordiontab')) {
                    if (/please sign here/i.test(el.textContent || '')) pushPad(el);
                  }
                  for (const pad of pads) {
                    const canvas = pad.querySelector('canvas');
                    if (!canvas) continue;
                    const ctx = canvas.getContext('2d');
                    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                    for (let i = 3; i < d.length; i += 4) {
                      if (d[i] > 0) return true;
                    }
                  }
                  return false;
                }"""
            )
        )
    except Exception:
        return False


def _please_sign_here_valid(page: Page) -> bool:
    """仅校验 Please sign here 区 signature-pad（不受信用卡 pad 干扰）。"""
    try:
        return bool(
            page.evaluate(
                """() => {
                  const roots = [];
                  for (const el of document.querySelectorAll(
                    '.signature-section, .flex-body, p-accordiontab, [role=\"region\"]'
                  )) {
                    if (!/please sign here/i.test(el.textContent || '')) continue;
                    roots.push(el);
                  }
                  for (const root of roots) {
                    for (const pad of root.querySelectorAll('crm-common-signature-pad')) {
                      if (pad.closest('[role=\"dialog\"]')) continue;
                      for (const input of pad.querySelectorAll('input, textarea')) {
                        if ((input.value || '').length > 40) return true;
                      }
                      const canvas = pad.querySelector('canvas');
                      if (!canvas) continue;
                      const ctx = canvas.getContext('2d');
                      if (!ctx) continue;
                      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                      for (let i = 3; i < d.length; i += 4) {
                        if (d[i] > 0) return true;
                      }
                    }
                  }
                  return false;
                }"""
            )
        )
    except Exception:
        return False


def consent_signature_valid(page: Page) -> bool:
    if _please_sign_here_valid(page):
        return True
    for canvas in _consent_canvas_locators(page):
        if canvas_has_ink(canvas):
            return True
    val = _signature_model_value(page)
    return len(val) > 10


def inline_signature_needs_stroke(page: Page) -> bool:
    hint = page.get_by_text(re.compile(r"Please sign here", re.I))
    if hint.count() == 0 or not hint.first.is_visible():
        return False
    return not consent_signature_valid(page)


def inline_signature_canvas(page: Page) -> Locator:
    """定位「Please sign here」条款区的页内 canvas（非弹窗）。"""
    expand_consent_signature_section(page)
    for selector in (
        ".signature-section crm-common-signature-pad canvas.canvas-container:visible",
        ".signature-section canvas:visible",
        "crm-common-signature-pad canvas.canvas-container:visible",
    ):
        scoped = page.locator(selector)
        if scoped.count() > 0:
            return scoped.first
    region = page.get_by_role("region", name=re.compile(r"Customer Consent Signature", re.I))
    if region.count() > 0:
        scoped = region.first.locator("canvas:visible")
        if scoped.count() > 0:
            return scoped.first
    sign_section = page.locator(".flex-body").filter(has_text=re.compile(r"Please sign here", re.I))
    if sign_section.count() > 0:
        scoped = sign_section.first.locator("canvas:visible")
        if scoped.count() > 0:
            return scoped.first
    return page.locator("crm-common-signature-pad canvas:visible").last


def _dispatch_signature_pad_stroke(canvas: Locator, ratios: list[tuple[float, float]]) -> None:
    """crm-common-signature-pad：pointerdown 在 canvas，pointerup 必须在 window 才 emit getSignBase64。"""
    canvas.evaluate(
        """(canvas, ratios) => {
            const rect = canvas.getBoundingClientRect();
            const pt = ([rx, ry]) => ({
                clientX: rect.left + rect.width * rx,
                clientY: rect.top + rect.height * ry,
                offsetX: rect.width * rx,
                offsetY: rect.height * ry,
            });
            const pts = ratios.map(pt);
            const pe = (type, p, target, pressure) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
                clientX: p.clientX, clientY: p.clientY,
                offsetX: p.offsetX, offsetY: p.offsetY, pressure,
            }));
            pe('pointerdown', pts[0], canvas, 0.5);
            try { canvas.setPointerCapture(1); } catch (_) {}
            for (let i = 1; i < pts.length; i++) {
                pe('pointermove', pts[i], canvas, 0.5);
            }
            pe('pointerup', pts[pts.length - 1], window, 0);
            const pad = canvas.closest('crm-common-signature-pad');
            if (pad) {
                pe('pointerup', pts[pts.length - 1], pad, 0);
                pad.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }""",
        ratios,
    )


def _try_angular_sign_complete(canvas: Locator) -> None:
    """写入 dataURL + 触发 Angular ControlValueAccessor / getSignBase64。"""
    canvas.evaluate(
        """(canvas) => {
            const pad = canvas.closest('crm-common-signature-pad');
            if (!pad) return;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(canvas.width * 0.1, canvas.height * 0.35);
                ctx.lineTo(canvas.width * 0.9, canvas.height * 0.65);
                ctx.stroke();
            }
            const dataUrl = canvas.toDataURL('image/png');
            const g = window.ng || {};
            const cmp = g.getComponent ? g.getComponent(pad) : null;
            if (cmp) {
                for (const fn of ['saveSign','confirmSign','signComplete','onSignEnd','handlePointerUp']) {
                    if (typeof cmp[fn] === 'function') try { cmp[fn](); } catch (_) {}
                }
                if (cmp.signaturePad && typeof cmp.signaturePad.toDataURL === 'function') {
                    const d = cmp.signaturePad.toDataURL();
                    if (typeof cmp.writeValue === 'function') cmp.writeValue(d);
                    if (typeof cmp.onChange === 'function') cmp.onChange(d);
                }
                if (typeof cmp.writeValue === 'function') cmp.writeValue(dataUrl);
                if (typeof cmp.onChange === 'function') cmp.onChange(dataUrl);
            }
            const ctxArr = pad.__ngContext__;
            if (ctxArr) {
                for (const x of ctxArr) {
                    if (!x || typeof x !== 'object') continue;
                    if (typeof x.writeValue === 'function') x.writeValue(dataUrl);
                    if (typeof x.onChange === 'function') x.onChange(dataUrl);
                    if (typeof x.getSignBase64 === 'function') try { x.getSignBase64(); } catch (_) {}
                }
            }
            for (const input of pad.querySelectorAll('input, textarea')) {
                input.value = dataUrl;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const rect = canvas.getBoundingClientRect();
            const cx = rect.left + rect.width * 0.5;
            const cy = rect.top + rect.height * 0.4;
            const pe = (type, target) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
                clientX: cx, clientY: cy, pressure: type === 'pointerup' ? 0 : 0.5,
            }));
            pe('pointerdown', canvas);
            pe('pointermove', canvas);
            pe('pointerup', window);
            pe('pointerup', pad);
        }"""
    )


def _commit_signature_stroke(canvas: Locator) -> None:
    """2D 画线 + pointer 事件，触发 getSignBase64 写入 hidden input。"""
    canvas.evaluate(
        """(canvas) => {
            const pad = canvas.closest('crm-common-signature-pad');
            const rect = canvas.getBoundingClientRect();
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(canvas.width * 0.12, canvas.height * 0.28);
                ctx.lineTo(canvas.width * 0.88, canvas.height * 0.72);
                ctx.stroke();
            }
            const cx = rect.left + rect.width * 0.55;
            const cy = rect.top + rect.height * 0.38;
            const pe = (type, target) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
                clientX: cx, clientY: cy, pressure: type === 'pointerup' ? 0 : 0.5,
            }));
            pe('pointerdown', canvas);
            try { canvas.setPointerCapture(1); } catch (_) {}
            pe('pointermove', canvas);
            pe('pointerup', window);
            if (pad) {
                pe('pointerup', pad);
                pad.dispatchEvent(new Event('input', { bubbles: true }));
                pad.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }"""
    )


def stroke_canvas(
    canvas: Locator,
    ratios: list[tuple[float, float]],
    *,
    force: bool = False,
    scroll: bool = True,
) -> None:
    """在 canvas 上按相对坐标画多笔签名（拖拽 + 分段笔划）。"""
    expect(canvas).to_be_visible(timeout=15_000)
    if scroll:
        canvas.scroll_into_view_if_needed()
    page = canvas.page
    box = None
    for _ in range(20):
        box = canvas.bounding_box()
        if box and box.get("width", 0) > 20 and box.get("height", 0) > 10:
            break
        page.wait_for_timeout(200)
    if box is None:
        canvas.click(force=force)
        return

    points = [
        (box["x"] + box["width"] * rx, box["y"] + box["height"] * ry)
        for rx, ry in ratios
    ]
    page.mouse.move(points[0][0], points[0][1])
    page.mouse.down()
    for x, y in points[1:]:
        page.mouse.move(x, y, steps=20)
    page.mouse.up()
    page.wait_for_timeout(400)
    if not canvas_has_ink(canvas):
        _dispatch_signature_pad_stroke(canvas, ratios)
        page.wait_for_timeout(400)


def _click_canvas_with_page_mouse(
    canvas: Locator, rx: float, ry: float, *, scroll: bool = False
) -> None:
    """录制 order.py L57 用 viewport 坐标；Playwright element position 易越界，改 page.mouse。"""
    expect(canvas).to_be_visible(timeout=15_000)
    if scroll:
        canvas.scroll_into_view_if_needed()
    page = canvas.page
    box = canvas.bounding_box()
    if not box or box.get("width", 0) < 10:
        canvas.click(force=True)
        return
    page.mouse.click(box["x"] + box["width"] * rx, box["y"] + box["height"] * ry)
    page.wait_for_timeout(300)


def _recording_consent_click(canvas: Locator) -> None:
    """录制 order.py L57：page.locator('canvas').click(position={769,113})。"""
    expect(canvas).to_be_visible(timeout=15_000)
    page = canvas.page
    box = canvas.bounding_box()
    if not box or box.get("width", 0) < 10:
        canvas.click(force=True)
        return
    pos_x = min(RECORDED_CONSENT_CANVAS_POS["x"], max(2, box["width"] - 2))
    pos_y = min(RECORDED_CONSENT_CANVAS_POS["y"], max(2, box["height"] - 2))
    canvas.click(position={"x": pos_x, "y": pos_y}, force=True)
    page.wait_for_timeout(400)
    if not canvas_has_ink(canvas):
        page.mouse.click(box["x"] + pos_x, box["y"] + pos_y)
        page.wait_for_timeout(300)


def _sign_one_consent_canvas(page: Page, canvas: Locator) -> bool:
    _recording_consent_click(canvas)
    if consent_signature_valid(page):
        return True
    stroke_canvas(canvas, INLINE_STROKE_RATIOS, force=True, scroll=False)
    page.wait_for_timeout(400)
    if consent_signature_valid(page):
        return True
    _dispatch_signature_pad_stroke(canvas, INLINE_STROKE_RATIOS)
    page.wait_for_timeout(400)
    if consent_signature_valid(page):
        return True
    _commit_signature_stroke(canvas)
    page.wait_for_timeout(400)
    return consent_signature_valid(page)


def sign_consent_signature(page: Page) -> None:
    """页内 Customer Consent / Please sign here 签名（ICCID 前；不上下滚动）。"""
    expand_consent_signature_section(page)
    if _please_sign_here_valid(page):
        return

    region = _consent_region(page)
    clean = region.get_by_role("button", name=re.compile(r"Clean", re.I))
    if clean.count() > 0 and clean.first.is_visible():
        clean.first.click(force=True)
        page.wait_for_timeout(300)

    canvases = _consent_canvas_locators(page)
    if not canvases:
        raise AssertionError(
            "Customer Consent 签名区 canvas 不可见（无法进入 SIM 步）"
        )

    for canvas in canvases:
        if _sign_one_consent_canvas(page, canvas):
            if _please_sign_here_valid(page):
                return

    if not _please_sign_here_valid(page):
        raise AssertionError(
            "Customer Consent 页内签名未完成（Please sign here 区无有效笔迹）"
        )


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
        ratios = DIALOG_STROKE_RATIOS if self.dialog is not None else INLINE_STROKE_RATIOS
        stroke_canvas(self.canvas, ratios)
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
