#!/usr/bin/env python3
"""Publish a j-explain document into the jExplain app and open it for reading.

Usage:
    explain.py <doc.json> [--replace] [--no-open] [--browser "Google Chrome"]
    explain.py --list

The doc is a j-explain JSON authoring payload (title, blocks, glossary — see the
skill's SKILL.md for the block vocabulary). It's stored as an explainer in the
shared document pool, <data>/jexplain/<key>.json; chart blocks with inline mermaid
are materialised into the shared jChart store (<data>/jchart/), where the user
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

# The jSuite edge (https) is the address the user sees; the bare dev port is the
# fallback for when Caddy/Docker is down but the Nuxt app itself is up.
EDGE_BASE = "https://jexplain.local"
DIRECT_BASE = "http://localhost:43004"

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
        "error: jExplain isn't reachable.\n"
        "  Start the suite with:  jsuite start\n"
        f"  Then it serves at:     {EDGE_BASE}",
        file=sys.stderr,
    )
    return 2


def data_dirs(res):
    """The (document, chart) pools on disk, never guessed.

    This script is installed under ~/.claude/skills, so it can't find the repo
    relative to itself — and it can be a different vintage from the server it's
    talking to. The server that just answered the publish call resolved its own
    `.data` and hands both pools back, so that's the truth for whatever checkout
    is actually running. `$JSUITE_DATA_DIR` covers a server too old to send them,
    but only helps if the caller exported it (`./jsuite` exports it to the app
    processes it starts, not to this shell).

    Returns None for a pool rather than a guess, and only returns directories
    that exist — a path the caller can't open is worse than no path at all. The
    chart pool sits beside the document pool, so a server that named one but not
    the other still gets both.
    """
    res = res or {}
    env = os.environ.get("JSUITE_DATA_DIR")
    root = os.path.expanduser(env) if env else None

    docs = _first_dir(res.get("dataDir"), os.path.join(root, "jexplain") if root else None)
    charts = _first_dir(
        res.get("chartDataDir"),
        os.path.join(os.path.dirname(docs), "jchart") if docs else None,
        os.path.join(root, "jchart") if root else None,
    )
    return docs, charts


def _first_dir(*candidates):
    for c in candidates:
        if c and os.path.isdir(c):
            return c
    return None


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

    url = f"{EDGE_BASE}{res['path']}" if base == EDGE_BASE else f"{base}{res['path']}"
    if not args.no_open:
        open_in_browser(url, args.browser)

    print(url)
    doc_pool, chart_pool = data_dirs(res)
    if doc_pool:
        print(f"explainer: {os.path.join(doc_pool, res['key'] + '.json')}")
        print(f"notes:     {os.path.join(doc_pool, res['key'] + '.notes.json')}")
    else:
        # No pool we can vouch for: name the files, not a path that won't open.
        print(f"explainer: {res['key']}.json (+ .notes.json) in the document pool "
              "(.data/jexplain/ at the jSuite root) — export $JSUITE_DATA_DIR, or "
              "update the running app, to have absolute paths printed here")
    if chart_pool:
        print(f"charts:    {os.path.join(chart_pool, '<chartKey>.json')} "
              "(keys in the explainer's chart blocks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
