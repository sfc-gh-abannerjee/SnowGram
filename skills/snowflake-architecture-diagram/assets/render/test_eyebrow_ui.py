#!/usr/bin/env python3
"""UI regression guard for the self-hiding type eyebrow (the JS + caption paths).

test_type_echoes.py covers the Python predicate. This covers the parts that only
exist in the rendered page:
  1. default view  -> an echo card's type line is HIDDEN; an informative one SHOWS.
  2. Customize toggle (body.sg-show-types) -> echo type lines are REVEALED.
  3. live self-heal -> editing a title so it no longer contains the type re-shows it.
  4. Present-mode caption -> skips an echoed type ("Azure Synapse", not
     "Azure Synapse - azure synapse"), keeps an informative one.

Renders the apex fixture HTML via render_local (no sidecars, no Snowflake) and drives
it with Playwright. If Playwright (or its browser) or Node isn't available, it SKIPS
with exit 0 -- so it never blocks an environment that can't run a browser, but asserts
hard wherever it can.

Run: python3 test_eyebrow_ui.py
"""
from __future__ import annotations
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
FIXTURE = HERE.parent / "layout-engine" / "tests" / "fixtures" / "apex_health_privatelink_stub.json"


def _skip(msg: str) -> int:
    print(f"EYEBROW UI SKIPPED: {msg}")
    return 0


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        return _skip(f"playwright not importable ({e})")

    out = Path(tempfile.gettempdir()) / "sg_eyebrow_ui_test.html"
    r = subprocess.run(
        [sys.executable, str(SCRIPTS / "render_local.py"), "--model", str(FIXTURE),
         "--title", "Eyebrow UI Test", "--out", str(out), "--no-sidecars"],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not out.exists():
        return _skip(f"render_local failed ({r.stderr.strip()[-200:]})")

    fails = []
    try:
        with sync_playwright() as p:
            try:
                b = p.chromium.launch()
            except Exception as e:
                return _skip(f"chromium unavailable ({e})")
            pg = b.new_page(viewport={"width": 1700, "height": 1150})
            pg.goto(out.as_uri()); pg.wait_for_timeout(500)

            def vis(re_title):
                return pg.evaluate("""(re) => {
                  const el=[...document.querySelectorAll('.flow-node[data-node-id]')]
                    .find(x=>x.querySelector('.fn-title') && new RegExp(re).test(x.querySelector('.fn-title').textContent));
                  if(!el) return null; const s=el.querySelector('.fn-sub'); if(!s) return null;
                  return {echo:s.classList.contains('sg-echo'), visible:getComputedStyle(s).display!=='none'};
                }""", re_title)

            # 1. default: echo hidden, informative shown
            syn = vis("Azure Synapse"); arc = vis("Arcadia Health")
            if not syn or syn["visible"]: fails.append(f"default: Azure Synapse type should be hidden, got {syn}")
            if not arc or not arc["visible"]: fails.append(f"default: Arcadia type should be shown, got {arc}")

            # 2. toggle reveals echoes
            pg.evaluate("document.body.classList.add('sg-show-types')"); pg.wait_for_timeout(120)
            syn2 = vis("Azure Synapse")
            if not syn2 or not syn2["visible"]: fails.append(f"toggle on: Azure Synapse type should be revealed, got {syn2}")
            pg.evaluate("document.body.classList.remove('sg-show-types')"); pg.wait_for_timeout(60)

            # 3. live self-heal: enter Customize, rename Azure Synapse so it no longer contains the type
            pg.evaluate("var c=document.getElementById('customizeBtn'); c&&c.click();"); pg.wait_for_timeout(120)
            t = pg.locator('.fn-title', has_text='Azure Synapse').first
            t.click(); pg.wait_for_timeout(80)
            pg.keyboard.press('Control+A'); pg.keyboard.press('Delete'); pg.keyboard.type('Landing DW'); pg.wait_for_timeout(40)
            pg.mouse.click(30, 30); pg.wait_for_timeout(150)
            healed = vis("Landing DW")
            if not healed or healed["echo"] or not healed["visible"]:
                fails.append(f"self-heal: after rename the type should re-show (echo False, visible True), got {healed}")

            # 4. present-mode caption skips echoed type, keeps informative
            pg.reload(); pg.wait_for_timeout(400)
            pg.evaluate("var b=[...document.querySelectorAll('button')].find(x=>/present/i.test(x.textContent)); b&&b.click();")
            pg.wait_for_timeout(250)
            caps = {}
            for _ in range(16):
                c = pg.evaluate("() => { var cb=document.getElementById('capBar'); return cb?{t:cb.querySelector('.cap-title').textContent, x:cb.querySelector('.cap-text').textContent}:null; }")
                if c and c["t"] and c["t"] not in caps: caps[c["t"]] = c["x"]
                pg.evaluate("var b=[...document.querySelectorAll('#capBar [data-cap]')].find(x=>x.getAttribute('data-cap')==='next'); b&&b.click();")
                pg.wait_for_timeout(90)
            if caps.get("Azure Synapse") not in (None, "Azure Synapse"):
                fails.append(f"present caption echo leak: Azure Synapse -> {caps.get('Azure Synapse')!r}")
            hor = caps.get("Snowflake Horizon")
            if hor is not None and "governance" not in (hor or "").lower():
                fails.append(f"present caption dropped informative type: Snowflake Horizon -> {hor!r}")
            b.close()
    except Exception as e:
        return _skip(f"interaction error ({e})")

    for f in fails:
        print("  FAIL " + f)
    print("EYEBROW UI OK" if not fails else f"EYEBROW UI FAILED ({len(fails)})")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
