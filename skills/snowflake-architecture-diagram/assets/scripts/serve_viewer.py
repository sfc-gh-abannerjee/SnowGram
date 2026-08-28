#!/usr/bin/env python3
"""
serve_viewer.py - live viewer at FULL feature parity with the SnowGram agent.

Instead of serving the hand-authored static viewer (which fetches state.json and
renders with its own DOM/hover/theme), this server renders the current state via
the SHARED renderer (render_local -> render_diagram.run) and serves the exact
full-featured HTML the agent produces: Customize panel, Cover + Present mode,
hover-focus, inline edit + Save-as-HTML, and the canonical styling.

It re-renders on every page load, so editing state.json + refreshing shows the
update (live-reload by refresh). This is how the local "viewer" reaches parity
without maintaining a second HTML implementation.

Usage:
  python3 serve_viewer.py --state /path/to/state.json [--port 4380] [--no-open]
"""
from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import socket
import sys
import threading
import webbrowser
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RENDER_LOCAL = SCRIPT_DIR / "render_local.py"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _render_html(state_path: Path, online_icons: bool = False, connection: str = "snowhouse") -> str:
    render_local = _load_module("render_local", RENDER_LOCAL)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    model = render_local.state_to_model(state)
    title = state.get("title") or "Architecture"
    result = render_local.build(model, title, None, online_icons=online_icons, connection=connection)
    return result.get("html") or "<!doctype html><p>render produced no html</p>"


def _free_port(start: int) -> int:
    for p in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    raise SystemExit(f"no free port in {start}-{start + 19}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Serve a full-parity live viewer of a diagram state.")
    ap.add_argument("--state", required=True, help="path to state.json")
    ap.add_argument("--port", type=int, default=4380, help="starting port (default 4380)")
    ap.add_argument("--no-open", action="store_true", help="do not open a browser")
    ap.add_argument("--online-icons", action="store_true",
                    help="allow live ICON_SEARCH (cached) for icons not in the vendored map/vocab")
    args = ap.parse_args()

    state_path = Path(args.state).resolve()
    if not state_path.exists():
        print(f"ERROR: state not found: {state_path}", file=sys.stderr)
        return 2

    port = _free_port(args.port)

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            try:
                html = _render_html(state_path, online_icons=args.online_icons).encode("utf-8")
            except Exception as exc:  # render error -> show it in the page
                html = f"<!doctype html><pre>render error: {exc}</pre>".encode("utf-8")
                self.send_response(500)
            else:
                self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(html)

        def log_message(self, *a):  # quiet
            pass

    httpd = http.server.HTTPServer(("127.0.0.1", port), Handler)
    url = f"http://localhost:{port}/"
    print(f"Parity viewer running at: {url}")
    print("Refresh after editing state.json to re-render. Ctrl+C to stop.")
    if not args.no_open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
