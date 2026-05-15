#!/usr/bin/env python3
"""
visual_check_edit_turns.py — render each turn's mermaid in the live frontend
and screenshot the resulting canvas. Used to manually verify that the
edit_existing_diagram skill's mermaid output renders correctly via ELK
layout, not just that the text is structurally valid.

Reads /tmp/turn{1..4}_canvas.mmd, opens the running dev server, calls
window.generateDiagram(mmd), waits for ReactFlow to settle, takes a PNG
of the canvas region.

Outputs to backend/tests/visual/edit_turns/turn{N}.png.

Pre-reqs: frontend running at --url, playwright + chromium installed.
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from pathlib import Path

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("Playwright not installed. pip install playwright && playwright install chromium")
    sys.exit(1)


async def render_one(page, mmd: str, out_png: Path, label: str) -> bool:
    print(f"[{label}] rendering {len(mmd)} chars of mermaid...")
    # Reset any prior state on the canvas
    ok = await page.evaluate(
        """async (mmd) => {
            try {
                if (typeof window.generateDiagram !== 'function') {
                    return { ok: false, error: 'window.generateDiagram missing' };
                }
                const result = await window.generateDiagram(mmd);
                return { ok: !!result, error: null };
            } catch (e) {
                return { ok: false, error: String(e?.message || e) };
            }
        }""",
        mmd,
    )
    if not ok.get("ok"):
        print(f"[{label}] generateDiagram failed: {ok.get('error')}")
        return False

    # Let layout + paint settle
    await page.wait_for_timeout(2500)

    # Fit the canvas to the viewport so the screenshot includes every node.
    # ReactFlow exposes fitView via the instance; the App stores it on
    # window during the render. If unavailable, fall back to the toolbar
    # control selector.
    fit_ok = await page.evaluate(
        """() => {
            try {
                // The app exposes the instance on a hidden global hook.
                const inst = window.__reactFlowInstance__ || window.reactFlowInstance;
                if (inst && typeof inst.fitView === 'function') {
                    inst.fitView({ padding: 0.08, duration: 0, minZoom: 0.1, maxZoom: 1 });
                    return 'instance';
                }
                // Fallback: synthesize via the controls button if present.
                const btn = document.querySelector('.react-flow__controls-fitview') ||
                            document.querySelector('button[aria-label*="fit" i]');
                if (btn) {
                    btn.click();
                    // After clicking, also zoom out to fit large canvases.
                    const transform = document.querySelector('.react-flow__viewport');
                    if (transform) {
                        const wheel = new WheelEvent('wheel', { deltaY: 600, bubbles: true });
                        for (let i = 0; i < 10; i++) {
                            document.querySelector('.react-flow').dispatchEvent(wheel);
                        }
                    }
                    return 'button';
                }
                return 'none';
            } catch (e) { return 'error: ' + e.message; }
        }"""
    )
    print(f"[{label}] fitView: {fit_ok}")
    await page.wait_for_timeout(800)

    # Try to grab the ReactFlow canvas; fall back to full page
    try:
        canvas = await page.query_selector(".react-flow")
        if canvas:
            await canvas.screenshot(path=str(out_png))
        else:
            await page.screenshot(path=str(out_png), full_page=False)
    except Exception as e:
        print(f"[{label}] screenshot error: {e}")
        await page.screenshot(path=str(out_png), full_page=False)

    print(f"[{label}] wrote {out_png}")
    return True


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:47823")
    parser.add_argument("--out", default="backend/tests/visual/edit_turns")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    turns = []
    for n in range(1, 5):
        p = Path(f"/tmp/turn{n}_canvas.mmd")
        if not p.exists():
            print(f"missing {p}; abort")
            return 1
        turns.append((n, p.read_text()))

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 2200, "height": 1100})
        page = await context.new_page()
        page.on("console", lambda msg: print(f"[browser:{msg.type}] {msg.text}") if msg.type == "error" else None)

        print(f"loading {args.url}...")
        await page.goto(args.url, wait_until="networkidle", timeout=30000)
        await page.wait_for_function(
            "() => typeof window.generateDiagram === 'function'",
            timeout=15000,
        )

        all_ok = True
        for n, mmd in turns:
            ok = await render_one(page, mmd, out_dir / f"turn{n}.png", f"turn{n}")
            all_ok = all_ok and ok
            await page.wait_for_timeout(500)

        await browser.close()
        return 0 if all_ok else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
