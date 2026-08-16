#!/usr/bin/env python3
"""Push a Mermaid diagram into the shared jSuite chart pool and open it for editing.

Usage:
    chart.py <diagram.mmd> [--title "My Diagram"] [--replace] [--key slug] [--no-open]
    chart.py --list

The diagram is stored as a chart in ~/code/anyway/jsuite/.data/jchart/<key>.json. jChart
lays it out as editable Excalidraw shapes on first open; the user can then
redraw it freely and pin notes to individual shapes.

Prints the chart URL, plus the data file paths to read the user's notes back
from without waiting for a paste.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

# Every domain API in the suite is served on jTicket's port, so an agent has one
# surface to talk to and one place a published chart opens (TICK-143). The jSuite
# edge (https) is the address the user sees; the bare dev port is the fallback
# for when Caddy/Docker is down but the Nuxt app itself is up.
EDGE_BASE = "https://jticket.local"
DIRECT_BASE = "http://localhost:43000"
DATA_DIR = os.path.expanduser("~/code/anyway/jsuite/.data/jchart")

# Preferred browser (macOS app name). Override with --browser or $JCHART_BROWSER.
DEFAULT_BROWSER = "Arc"


def api(base, path, method="GET", payload=None, timeout=6):
    url = base + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    # The edge uses OrbStack's local CA, which Python's bundled CA store doesn't know
    # about. This only ever talks to localhost, so skip verification there.
    import ssl
    ctx = ssl._create_unverified_context() if url.startswith("https") else None
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode() or "null")


def pick_base():
    """Return the first reachable base URL, preferring the edge."""
    for base in (EDGE_BASE, DIRECT_BASE):
        try:
            api(base, "/api/charts", timeout=4)
            return base
        except Exception:
            continue
    return None


def not_running():
    print(
        "error: the shared chart API isn't reachable (jTicket serves it).\n"
        "  Start the suite with:  jsuite start\n"
        f"  Then it serves at:     {EDGE_BASE}",
        file=sys.stderr,
    )
    return 2


def open_in_browser(url, browser=None):
    browser = browser or os.environ.get("JCHART_BROWSER") or DEFAULT_BROWSER
    if sys.platform == "darwin":
        subprocess.run(["open", "-a", browser, url] if browser else ["open", url], check=False)
    elif sys.platform.startswith("linux"):
        subprocess.run([browser, url] if browser else ["xdg-open", url], check=False)
    elif sys.platform.startswith("win"):
        subprocess.run(["cmd", "/c", "start", "", url], check=False)


def slugify(text):
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9_-]+", "-", text.lower()))[:80] or "chart"


def cmd_list(base):
    charts = api(base, "/api/charts") or []
    if not charts:
        print("no charts yet")
        return 0
    for c in charts:
        notes = f"  {c['noteCount']} note(s)" if c.get("noteCount") else ""
        print(f"{c['key']:<40} {c['title']:<36} {c['elementCount']} shapes{notes}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", nargs="?", help="path to a .mmd file containing the Mermaid source")
    ap.add_argument("--title", default=None, help="chart title shown in jChart")
    ap.add_argument("--key", default=None, help="explicit chart key (defaults to a slug of the title)")
    ap.add_argument("--replace", action="store_true",
                    help="overwrite the chart with this key instead of creating a new one — keeps its notes")
    ap.add_argument("--list", action="store_true", help="list existing charts and exit")
    ap.add_argument("--no-open", action="store_true", help="create the chart but do not open a browser")
    ap.add_argument("--browser", default=None,
                    help="browser app to open in (e.g. 'Google Chrome'); falls back to $JCHART_BROWSER")
    args = ap.parse_args()

    base = pick_base()
    if base is None:
        return not_running()

    if args.list:
        return cmd_list(base)

    if not args.source:
        ap.error("a .mmd source file is required (or pass --list)")
    if not os.path.isfile(args.source):
        print(f"error: no such file: {args.source}", file=sys.stderr)
        return 1

    with open(args.source, encoding="utf-8") as f:
        mermaid = f.read().strip()
    if not mermaid:
        print("error: source file is empty", file=sys.stderr)
        return 1

    title = args.title or os.path.splitext(os.path.basename(args.source))[0].replace("-", " ").replace("_", " ")
    key = args.key or slugify(title)

    try:
        res = api(base, "/api/charts", "POST",
                  {"title": title, "mermaid": mermaid, "key": key, "replace": args.replace})
    except urllib.error.URLError:
        return not_running()

    # The layer's own namespaced workbench route, which is what jTicket — and
    # every consumer but jChart, whose short `/c/<key>` alias this used to
    # target — serves the chart at.
    url = f"{base}/charts/{res['key']}"
    if not args.no_open:
        open_in_browser(url, args.browser)

    print(url)
    print(f"chart: {os.path.join(DATA_DIR, res['key'] + '.json')}")
    print(f"notes: {os.path.join(DATA_DIR, res['key'] + '.notes.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
