#!/usr/bin/env python3
"""Publish a j-explain document into the shared jSuite pool and open it for reading.

Usage:
    explain.py <doc.json> [--replace] [--no-open] [--browser "Google Chrome"]
    explain.py --list

The doc is a j-explain JSON authoring payload (title, blocks, glossary — see the
skill's SKILL.md for the block vocabulary). It's stored as an explainer at
~/code/anyway/jsuite/.data/jexplain/<key>.json; chart blocks with inline mermaid
are materialised into the shared jChart store (.data/jchart/), where the user
can also open them in the full jChart workbench.

Prints the explainer URL plus the data file paths to read the user's notes back
from without waiting for a paste.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

# Every domain API in the suite is served on jTicket's port, so an agent has one
# surface to talk to and one place a published document opens (TICK-143). The
# jSuite edge (https) is the address the user sees; the bare dev port is the
# fallback for when Caddy/Docker is down but the Nuxt app itself is up.
EDGE_BASE = "https://jticket.local"
DIRECT_BASE = "http://localhost:43000"
DATA_DIR = os.path.expanduser("~/code/anyway/jsuite/.data/jexplain")
CHART_DATA_DIR = os.path.expanduser("~/code/anyway/jsuite/.data/jchart")

# Preferred browser (macOS app name). Override with --browser or $JEXPLAIN_BROWSER.
DEFAULT_BROWSER = "Arc"


def api(base, path, method="GET", payload=None, timeout=10):
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
            api(base, "/api/documents", timeout=4)
            return base
        except Exception:
            continue
    return None


def not_running():
    print(
        "error: the shared document API isn't reachable (jTicket serves it).\n"
        "  Start the suite with:  jsuite start\n"
        f"  Then it serves at:     {EDGE_BASE}",
        file=sys.stderr,
    )
    return 2


def open_in_browser(url, browser=None):
    browser = browser or os.environ.get("JEXPLAIN_BROWSER") or DEFAULT_BROWSER
    if sys.platform == "darwin":
        subprocess.run(["open", "-a", browser, url] if browser else ["open", url], check=False)
    elif sys.platform.startswith("linux"):
        subprocess.run([browser, url] if browser else ["xdg-open", url], check=False)
    elif sys.platform.startswith("win"):
        subprocess.run(["cmd", "/c", "start", "", url], check=False)


def cmd_list(base):
    docs = api(base, "/api/documents") or []
    if not docs:
        print("no explainers yet")
        return 0
    for d in docs:
        extras = []
        if d.get("chartCount"):
            extras.append(f"{d['chartCount']} chart(s)")
        if d.get("noteCount"):
            extras.append(f"{d['noteCount']} note(s)")
        suffix = ("  " + ", ".join(extras)) if extras else ""
        print(f"{d['key']:<40} {d['title']:<44} {d['blockCount']} blocks{suffix}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", nargs="?", help="path to the j-explain JSON payload")
    ap.add_argument("--replace", action="store_true",
                    help="overwrite the explainer with this key in place — keeps its notes, "
                         "and unchanged charts keep the user's hand edits")
    ap.add_argument("--list", action="store_true", help="list existing explainers and exit")
    ap.add_argument("--no-open", action="store_true", help="publish but do not open a browser")
    ap.add_argument("--browser", default=None,
                    help="browser app to open in (e.g. 'Google Chrome'); falls back to $JEXPLAIN_BROWSER")
    args = ap.parse_args()

    base = pick_base()
    if base is None:
        return not_running()

    if args.list:
        return cmd_list(base)

    if not args.source:
        ap.error("a JSON payload file is required (or pass --list)")
    if not os.path.isfile(args.source):
        print(f"error: no such file: {args.source}", file=sys.stderr)
        return 1

    with open(args.source, encoding="utf-8") as f:
        try:
            payload = json.load(f)
        except json.JSONDecodeError as e:
            print(f"error: payload is not valid JSON: {e}", file=sys.stderr)
            return 1

    if not isinstance(payload, dict) or not isinstance(payload.get("blocks"), list):
        print("error: payload must be an object with a `blocks` array", file=sys.stderr)
        return 1
    if args.replace:
        payload["replace"] = True

    try:
        res = api(base, "/api/documents", "POST", payload)
    except urllib.error.URLError:
        return not_running()

    # Not the `path` the shared store returns: that is jExplain's own `/e/<key>`
    # reader route, and this publishes through jTicket, whose reader is
    # `/documents/<key>`. Same document either way — the pool is one pool.
    url = f"{base}/documents/{res['key']}"
    if not args.no_open:
        open_in_browser(url, args.browser)

    print(url)
    print(f"explainer: {os.path.join(DATA_DIR, res['key'] + '.json')}")
    print(f"notes:     {os.path.join(DATA_DIR, res['key'] + '.notes.json')}")
    print(f"charts:    {CHART_DATA_DIR}/<chartKey>.json (keys in the explainer's chart blocks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
