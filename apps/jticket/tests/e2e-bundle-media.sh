#!/usr/bin/env bash
# E2E for project bundle doc media (TICK-287): exporting a project bundles doc
# image-block media and note attachments; importing writes them back, and a doc
# key renamed on collision gets every media URL rewritten.
#
# Runs a real jTicket dev server against throwaway JSUITE_DATA_DIR stores —
# never touches the suite's .data/. Usage: apps/jticket/tests/e2e-bundle-media.sh
set -euo pipefail
set -m # background jobs get their own process group, so we can kill the whole server tree

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PORT=43990
BASE="http://localhost:$PORT"
TMP="$(mktemp -d)"
# 1x1 transparent PNG
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
SERVER_PID=''

stop_server() {
  if [[ -n $SERVER_PID ]]; then
    kill -- "-$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=''
  fi
}
trap 'stop_server; rm -rf "$TMP"' EXIT

start_server() { # $1 = data dir
  JSUITE_DATA_DIR="$1" pnpm --dir "$ROOT/apps/jticket" dev --port "$PORT" >"$TMP/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 120); do
    curl -sf --max-time 2 "$BASE/api/projects" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "FAIL: server did not come up on :$PORT"
  tail -50 "$TMP/server.log"
  exit 1
}

fail() { echo "FAIL: $1"; exit 1; }
ok() { echo "  ok: $1"; }

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "port $PORT already in use"
fi

# ── Seed store A: a doc with an image block + note attachments ────────────────
A="$TMP/a"
mkdir -p "$A/jexplain/media/e2e-doc/notes"
echo "$PNG_B64" | base64 -d >"$A/jexplain/media/e2e-doc/pic.png"
echo "$PNG_B64" | base64 -d >"$A/jexplain/media/e2e-doc/notes/shot.png"
echo "$PNG_B64" | base64 -d >"$A/jexplain/media/e2e-doc/notes/overview.png"
cat >"$A/jexplain/e2e-doc.json" <<'JSON'
{
  "format": "j-explain",
  "version": 1,
  "key": "e2e-doc",
  "title": "E2E Doc",
  "createdAt": "2026-08-24T00:00:00.000Z",
  "updatedAt": "2026-08-24T00:00:00.000Z",
  "blocks": [
    { "id": "b1", "type": "prose", "md": "## E2E\n\nA doc with media." },
    { "id": "img1", "type": "image", "src": "/api/media/e2e-doc/pic.png", "alt": "pic" }
  ]
}
JSON
# A second doc that borrows the first doc's media — its record is created first,
# so import processes it before e2e-doc's rename is decided.
cat >"$A/jexplain/e2e-ref.json" <<'JSON'
{
  "format": "j-explain",
  "version": 1,
  "key": "e2e-ref",
  "title": "E2E Ref",
  "createdAt": "2026-08-24T00:00:00.000Z",
  "updatedAt": "2026-08-24T00:00:00.000Z",
  "blocks": [
    { "id": "r1", "type": "image", "src": "/api/media/e2e-doc/pic.png", "alt": "borrowed" }
  ]
}
JSON
cat >"$A/jexplain/e2e-doc.notes.json" <<'JSON'
{
  "general": "overall",
  "notes": [
    {
      "id": "n1",
      "blockId": "img1",
      "label": "Image #1",
      "text": "see shot",
      "attachments": [{ "id": "a1", "src": "/api/media/e2e-doc/notes/shot.png", "kind": "shot" }]
    }
  ],
  "generalAttachments": [{ "id": "a2", "src": "/api/media/e2e-doc/notes/overview.png", "kind": "shot" }]
}
JSON

echo "== export from store A =="
start_server "$A"
PROJ=$(curl -sf -X POST "$BASE/api/projects" -H 'content-type: application/json' \
  -d '{ "title": "E2E Media" }' | jq -r '.key // .project.key')
[[ -n $PROJ && $PROJ != null ]] || fail "could not create project"
curl -sf -X POST "$BASE/api/docs" -H 'content-type: application/json' \
  -d "{ \"title\": \"E2E Ref\", \"documentKey\": \"e2e-ref\", \"project\": \"$PROJ\" }" >/dev/null \
  || fail "could not create ref doc record"
curl -sf -X POST "$BASE/api/docs" -H 'content-type: application/json' \
  -d "{ \"title\": \"E2E Doc\", \"documentKey\": \"e2e-doc\", \"project\": \"$PROJ\" }" >/dev/null \
  || fail "could not create doc record"
curl -sf "$BASE/api/projects/$PROJ/export" >"$TMP/bundle.json" || fail "export failed"
stop_server

MEDIA_COUNT=$(jq '.media | length' "$TMP/bundle.json")
[[ $MEDIA_COUNT == 3 ]] || fail "bundle.media should carry 3 files (pic, shot, overview), got: $MEDIA_COUNT"
ok "bundle.media carries 3 files"
EMPTY=$(jq '[.media[] | select((.base64 | length) == 0)] | length' "$TMP/bundle.json")
[[ $EMPTY == 0 ]] || fail "bundle.media has entries with empty base64"
ok "every media entry has bytes"

# ── Import into clean store B ─────────────────────────────────────────────────
echo "== import into clean store B =="
B="$TMP/b"
mkdir -p "$B"
start_server "$B"
curl -sf -X POST "$BASE/api/projects/import" -H 'content-type: application/json' \
  -d @"$TMP/bundle.json" >"$TMP/import1.json" || fail "import #1 failed"

cmp -s "$A/jexplain/media/e2e-doc/pic.png" "$B/jexplain/media/e2e-doc/pic.png" \
  || fail "block image bytes missing or wrong after clean import"
cmp -s "$A/jexplain/media/e2e-doc/notes/shot.png" "$B/jexplain/media/e2e-doc/notes/shot.png" \
  || fail "note attachment bytes missing or wrong after clean import"
cmp -s "$A/jexplain/media/e2e-doc/notes/overview.png" "$B/jexplain/media/e2e-doc/notes/overview.png" \
  || fail "general note attachment bytes missing or wrong after clean import"
ok "media bytes travelled to the clean store"
SRC=$(jq -r '.blocks[] | select(.type == "image") | .src' "$B/jexplain/e2e-doc.json")
[[ $SRC == /api/media/e2e-doc/pic.png ]] || fail "clean import should keep the original media url, got: $SRC"
curl -sf "$BASE/api/media/e2e-doc/pic.png" >/dev/null || fail "block image does not serve after clean import"
curl -sf "$BASE/api/media/e2e-doc/notes/shot.png" >/dev/null || fail "note attachment does not serve after clean import"
ok "doc image and note attachment serve on the clean store"

# ── Import again with colliding doc keys: renamed + urls rewritten ────────────
echo "== import with doc key collision =="
cat >"$B/jexplain/e2e-doc.json" <<'JSON'
{
  "format": "j-explain",
  "version": 1,
  "key": "e2e-doc",
  "title": "Occupied",
  "createdAt": "2026-08-24T00:00:00.000Z",
  "updatedAt": "2026-08-24T00:00:00.000Z",
  "blocks": [{ "id": "x", "type": "prose", "md": "a different local doc" }]
}
JSON
cat >"$B/jexplain/e2e-ref.json" <<'JSON'
{
  "format": "j-explain",
  "version": 1,
  "key": "e2e-ref",
  "title": "Occupied Ref",
  "createdAt": "2026-08-24T00:00:00.000Z",
  "updatedAt": "2026-08-24T00:00:00.000Z",
  "blocks": [{ "id": "y", "type": "prose", "md": "another different local doc" }]
}
JSON
# A stale media dir already sitting at the rename target (e.g. left behind by a
# deleted doc — deleteDoc never removes media/): the bundle's bytes must win.
mkdir -p "$B/jexplain/media/e2e-doc-2"
printf 'stale junk' >"$B/jexplain/media/e2e-doc-2/pic.png"
curl -sf -X POST "$BASE/api/projects/import" -H 'content-type: application/json' \
  -d @"$TMP/bundle.json" >"$TMP/import2.json" || fail "import #2 failed"

[[ -f "$B/jexplain/e2e-doc-2.json" ]] || fail "colliding doc key was not renamed to e2e-doc-2"
SRC=$(jq -r '.blocks[] | select(.type == "image") | .src' "$B/jexplain/e2e-doc-2.json")
[[ $SRC == /api/media/e2e-doc-2/pic.png ]] || fail "image src not rewritten for renamed key, got: $SRC"
NOTE_SRC=$(jq -r '.notes[0].attachments[0].src' "$B/jexplain/e2e-doc-2.notes.json")
[[ $NOTE_SRC == /api/media/e2e-doc-2/notes/shot.png ]] || fail "note attachment src not rewritten, got: $NOTE_SRC"
GEN_SRC=$(jq -r '.generalAttachments[0].src' "$B/jexplain/e2e-doc-2.notes.json")
[[ $GEN_SRC == /api/media/e2e-doc-2/notes/overview.png ]] || fail "generalAttachments src not rewritten, got: $GEN_SRC"
ok "renamed doc's media urls rewritten (block, note, general)"
[[ -f "$B/jexplain/e2e-ref-2.json" ]] || fail "colliding e2e-ref key was not renamed to e2e-ref-2"
REF_SRC=$(jq -r '.blocks[] | select(.type == "image") | .src' "$B/jexplain/e2e-ref-2.json")
[[ $REF_SRC == /api/media/e2e-doc-2/pic.png ]] \
  || fail "cross-doc media url not rewritten for a doc imported before the rename was known, got: $REF_SRC"
ok "cross-doc media url rewritten"
cmp -s "$A/jexplain/media/e2e-doc/pic.png" "$B/jexplain/media/e2e-doc-2/pic.png" \
  || fail "media bytes missing under the renamed key (stale bytes must be replaced by the bundle's)"
curl -sf "$BASE/api/media/e2e-doc-2/pic.png" >/dev/null || fail "block image does not serve under renamed key"
curl -sf "$BASE/api/media/e2e-doc-2/notes/shot.png" >/dev/null || fail "note attachment does not serve under renamed key"
ok "renamed doc's media serve"
stop_server

echo "PASS: bundle media e2e"
