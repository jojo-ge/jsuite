# jSuite

A pnpm-workspace monorepo of six local dev apps behind one HTTPS edge — one
command, stable names, so you can point LLMs (and bookmarks) at fixed URLs
instead of juggling dev servers. OrbStack provides DNS + HTTPS for the `.local`
names; a single Caddy container routes them to the native dev servers:

```sh
cd ~/code/anyway/jsuite
./jsuite setup      # once (re-runnable) — see Setup below
./jsuite start      # apps + edge
```

| URL                      | App                       | Host port |
| ------------------------ | ------------------------- | --------- |
| https://jsuite.local     | index (static links page) | —         |
| https://jticket.local    | jTicket                   | 43000     |
| https://jdiff.local      | jDiff                     | 43002     |
| https://jchart.local     | jChart                    | 43003     |
| https://jexplain.local   | jExplain                  | 43004     |
| https://jgrilling.local  | jGrilling                 | 43005     |
| https://jmap.local       | jMap                      | 43007     |

## Setup

Prerequisites:

- **[OrbStack](https://orbstack.dev)** (`brew install orbstack`) — it must be
  the active Docker context (`docker context use orbstack`). OrbStack resolves
  the `.local` names and terminates HTTPS, so there is nothing to configure:
  no certs, no `/etc/hosts`, no sudo.
- **Node + pnpm** (`corepack enable`, or `brew install pnpm`).

Then, from the repo root:

```sh
./jsuite setup
```

which does, in order:

1. verifies OrbStack is installed, running, and the active Docker context
2. `pnpm install` — one lockfile at the root installs every app and package
3. installs every repo-owned jskill into `~/.claude/skills` (manifest:
   `SKILLS_MANIFEST` in `./jsuite`), then — when run from a real terminal —
   the interactive `mattpocock/skills` installer
4. removes leftovers from the old mkcert-based edge (stale `/etc/hosts`
   pins, `./certs/`), which would otherwise shadow OrbStack's DNS

It is safe to re-run at any time — after adding an app, adding a skill, or
pulling dependency changes. Finish with `./jsuite start`; on the first HTTPS
visit OrbStack asks once to trust its local CA, and every app gets a green
lock from then on.

## Layout

```
jsuite/
├── jsuite              # the launcher (start/stop/status/logs/open/setup)
├── Caddyfile           # edge routing config (runs in Docker; OrbStack does TLS)
├── docker-compose.yml
├── www/                # static ecosystem index page (https://jsuite.local)
├── CLAUDE.md           # request-routing guide for agents working in this repo
├── .claude/skills/     # suite-level skills (jsuite — the ecosystem map)
├── .data/              # every app's state, gitignored (see @jsuite/data)
├── apps/
│   ├── jticket/        # projects + tickets + docs (owns most jskills, has its own j-setup)
│   ├── jdiff/          # diff / PR review workbench
│   ├── jchart/         # diagram workbench (specialised chart app)
│   ├── jexplain/       # blog-style explainers with live charts
│   ├── jgrilling/      # browser grilling sessions (claude interrogates your plan)
│   └── jmap/           # codebase cartographer — scoping, herdr mappers, interactive map
└── packages/
    ├── charting/       # @jsuite/charting — shared chart module (Nuxt layer)
    ├── documents/      # @jsuite/documents — shared block-document system (Nuxt layer)
    ├── herdr/          # @jsuite/herdr — shared herdr (terminal workspace) adapter
    ├── relay/          # @jsuite/relay — jTicket sync signaling relay (Cloudflare Worker + deploy wizard)
    └── data/           # @jsuite/data — shared .data resolver
```

The workspace is a single git repo and a pnpm monorepo — apps do not carry
their own `.git`. One lockfile at the root; `pnpm install` here installs
everything.

## @jsuite/data

Every app stores its state under `.data/<app>/` at the repo root, never inside
its own directory. One gitignored `.data` is the whole suite's state — simple to
back up, wipe, or point an LLM at — and it survives an app being reinstalled.

```ts
import { appDataDir, appDataFile } from '@jsuite/data'
const DATA_DIR = appDataDir('jchart')                 // <root>/.data/jchart
const FILE = appDataFile('jticket', 'jticket.json')   // parents created
```

Add `"@jsuite/data": "workspace:*"` to the app's `dependencies`; that's all —
it's plain ESM, so Nitro consumes it with no transpile step and there's no layer
to extend. The root is found by walking up to `pnpm-workspace.yaml`, so it works
however an app is launched; `./jsuite` also exports `JSUITE_DATA_DIR`, which
overrides the search when set.

| app | state |
| --- | --- |
| jticket | `.data/jticket/jticket.json` + `attachments/` |
| jchart | `.data/jchart/<key>.json` (+ `.notes.json`) — shared: jexplain reads/writes the same pool |
| jdiff | `.data/jdiff/` — ratings, tours, risks, asks, comments, caches |
| jexplain | `.data/jexplain/<key>.json` (+ `.notes.json`) — shared: jticket docs live in the same pool |
| jgrilling | `.data/jgrilling/<key>.json` — grilling sessions; debriefs land in the shared document pool |
| jmap | `.data/jmap/<key>.json` — map identity + synthesized graph; the work (tickets, docs) lives in jTicket and the shared document pool |

## @jsuite/charting

The Excalidraw canvas, Mermaid→scene conversion, and scene utilities live in
`packages/charting` as a Nuxt layer so any app can embed charts. A consumer
needs three things:

1. `"@jsuite/charting": "workspace:*"` in `dependencies`
2. `extends: ['@jsuite/charting']` in `nuxt.config.ts`
3. a postinstall step to copy the Excalidraw fonts into its `public/`:
   `node ../../packages/charting/scripts/copy-excalidraw-assets.mjs`

That provides `<ExcalidrawCanvas>`, `mermaidToScene()`, the scene utils
(auto-imported), types via `'@jsuite/charting/scene'` / `'@jsuite/charting/store'` —
**and the shared chart store**: the layer carries `server/api/charts/**` over
`.data/jchart/`, so every consumer serves the same chart pool. A chart embedded
in jExplain is the same object opened in jChart; edits and notes flow both ways.
jChart stays the specialised workbench UI on top.

## @jsuite/documents

The block-based document system born in jExplain — the model (prose, callout,
code, diff, chart, steps, compare, timeline, takeaway + glossary), the
renderers (`Block*.vue`, `<NotesRail>`, `<DocumentArticle>` — the full reading
experience with margin notes), `useMarkdown()`/`useShiki()`, and the
`server/api/documents/**` routes over `.data/jexplain/` — lives in
`packages/documents` as a Nuxt layer. It `extends` `@jsuite/charting` itself,
so chart blocks and `/api/charts/**` ride in transitively. A consumer needs:

1. `"@jsuite/documents": "workspace:*"` in `dependencies`
2. `extends: ['@jsuite/documents']` in `nuxt.config.ts`
3. the charting postinstall step (chart blocks render Excalidraw):
   `node ../../packages/charting/scripts/copy-excalidraw-assets.mjs`
4. one line in its Tailwind entry css so the layer components' utility
   classes are generated: `@source "../../../../../packages/documents/app";`

Types come from `'@jsuite/documents/types'` (client-safe) and
`'@jsuite/documents/store'` (server). **One document pool serves every
consumer**: a jTicket doc (tracker record + `documentKey`) is the same object
jExplain lists and renders; review notes and chart edits flow both ways.
jExplain stays the canonical reading shell; jTicket wraps documents in
project/status/label metadata.

## @jsuite/herdr

The Herdr adapter born in jTicket — drives the `herdr` terminal workspace
manager over its socket CLI: binary resolution (`HERDR_BIN` → PATH →
`~/.local/bin`), JSON command exec, a ~5s state cache (`herdrState()` reports
`{ available: false }` when herdr isn't running, so UIs degrade to hidden
buttons), workspace/tab topology (`ensureHerdrWorkspace`, `acquirePackedPane`
packs panes 2×2 per tab, `createJobTab`), macOS window focusing, and
`startClaudeIn` (start a claude agent in a pane and submit a prompt, with the
"not an available shell" and `agent_prompt_stalled` retry dances; extra CLI
args for the claude binary — e.g. `--model` — pass through `opts.args`). Plain
ESM, no layer; failures throw `HerdrError` with an HTTP-ish `statusCode`.
jTicket dispatches all ticket work through it (including jMap-mode mapping
tickets), and jDiff dispatches its review-guidance sessions (the
`jdiff-review` / `jdiff-ask` skills, pinned to Opus 5).

## @jsuite/relay — jTicket project sync

`packages/relay` is the signaling relay behind **jTicket sync**: two people,
each running jSuite on their own machine, collaborating on one jTicket
project. Sync is pull-only, human-approved, and snapshot-based:

- One user opens the project's **Share** panel, picks the shared 1–4 char key
  and names their coworker; the link they paste over their own chat channel
  opens the peer's import screen. **Links are valid 2 hours** — re-sharing
  re-arms the same share with a fresh room and window; stop-sharing kills the
  room instantly. Expiry gates new requests only: an in-flight pull completes.
- While both apps run, either side can click **Sync**; the serving side
  **approves each pull in their UI** (named: who's asking, for what) before
  any data moves. The link creator mints odd ticket numbers, the importer
  even, so the shared project needs no coordination — and is hard-locked to
  exactly two peers.
- Security model: project data travels **peer-to-peer over WebRTC data
  channels** (DTLS-encrypted); the relay is a Cloudflare Worker + Durable
  Object that only ferries opaque handshake blobs by room id + secret — it
  never sees project data and stores nothing but a secret hash and expiry.
  There is no write path between machines: peer-owned entities are read-only
  and never dispatchable (enforced at the API), peer-authored text entering a
  locally-built prompt is wrapped in untrusted-content framing, and
  machine-local fields (`repo`, integration branch) never leave the machine.
- The public worker bounds anonymous callers: frames over 64 KiB eject the
  sender (close code 4006), room creation and room traffic are rate-limited
  per IP (120 per minute each — close code 4007 for joins, HTTP 429
  otherwise; `RELAY_*` env vars override), and an expired room's metadata is
  deleted by a Durable Object alarm 30 minutes after expiry once its members
  are gone.

**Deploying**: `packages/relay/wizard.sh` walks the one-time Cloudflare
deploy (free plan; account → `wrangler login` → deploy → verify) and writes
the URL to `.data/jticket/sync.json`, which a running jTicket picks up
without a restart. **Both machines must wire the same relay URL** — the
coworker runs the wizard too and chooses option 2 (wire an existing URL).
`JTICKET_RELAY_URL` overrides the file (tests, one-off runs); with neither
set, sharing warns in the panel and pulls refuse with a 503 naming the
wizard. Local development and tests never touch Cloudflare — the same worker
runs on workerd via `startLocalRelay()` (Miniflare).

## jSkills

Apps own their Claude skills in `<app>/.claude/skills` (the jTicket pattern:
jticket owns `jimplement`, `jwayfinder`, `to-jticket`, `to-jspec`, `to-jdoc`;
jdiff owns `jdiff-review` and `jdiff-ask`;
jchart owns `j-chart`; jexplain owns `j-explain`; jgrilling owns `j-grilling`;
jmap owns `j-map`, `jmap-scope`, `jmap-domain` and `jmap-synthesize`).
Suite-level skills live in
`.claude/skills/` at the repo root: `jsuite` is the ecosystem map — what each
app does, how they relate, and which app/skill a request routes to.

`./jsuite setup` installs them all globally (plus the interactive
`mattpocock/skills` installer when run from a terminal). The `SKILLS_MANIFEST`
table in `./jsuite` says which app owns what; keep `apps/jticket/j-setup`
(jTicket's standalone app-local installer) in sync with its row.

## Why OrbStack does TLS

The edge container carries a `dev.orbstack.domains` label listing every
`.local` name. OrbStack resolves those names to the container's own IP,
terminates HTTPS with its local CA (auto-trusted on first visit), and forwards
plain HTTP to Caddy on `:80`. That removes the whole cert story — no mkcert,
no `/etc/hosts`, no sudo, no published ports — and because the names resolve
to the container's IP rather than `127.0.0.1`, there's no conflict with the
kraken/phoenix dev runtime's Caddy on the host's `:80`/`:443`.

Always include the scheme: `https://jticket.local`.

## Commands

```sh
./jsuite start            # start every dev server + the Caddy edge
./jsuite stop             # stop all of it (kills each app's whole process group)
./jsuite restart
./jsuite status           # pid + live HTTPS status code per app
./jsuite logs [app|edge]  # tail -F; no arg = every app
./jsuite open [app]       # open in the browser (default: the index)
./jsuite setup            # onboarding: OrbStack check, pnpm install, skill install,
                          # cleanup of the old mkcert/hosts edge — re-runnable
```

State lives beside the script: `logs/<app>.log`, `run/<app>.pid`.

## Design

The apps run **natively on the host**; only Caddy is containerised. That is
deliberate — jDiff needs host `git`, `gh`, the `claude` CLI, the native folder
picker and open-in-VSCode, none of which survive containerisation. OrbStack
terminates TLS; Caddy just routes each name to `host.docker.internal:<port>`.

```
browser ──TLS──▶ [ OrbStack proxy :443 ] ──http──▶ [ Caddy :80 ] ──http──▶ host.docker.internal:{43000,43002,43003,43004,43005,43007}
                        │
                        └─ OrbStack local CA, auto-trusted on first visit
```

`./jsuite start` refuses to start an app whose port is held by something it
didn't launch (a stale dev server), rather than letting Nuxt silently pick a
different port and break the proxy.

## Adding an app

1. Create it under `apps/<id>` (it joins the workspace automatically via
   `pnpm-workspace.yaml`), then `pnpm install` at the root.
2. Add a row to `APPS` in `./jsuite` (id | dir under apps/ | port | dev command).
3. Add a matching `https://<id>.local` block to the `Caddyfile`.
4. Add the name to `DOMAINS` in `./jsuite` AND to the `dev.orbstack.domains`
   label in `docker-compose.yml`, and allowlist it in the app's
   `nuxt.config.ts` → `vite.server.allowedHosts`.
5. `./jsuite restart` — the label and `Caddyfile` are only read when the
   container is recreated.
6. Give it an identity: `public/favicon.svg` (32×32, dark rounded square + the
   app's accent from `www/site.css`), plus `app.head` in `nuxt.config.ts` with
   the title, description and icon link, and a `titleTemplate` in `app.vue` so
   pages set only their own name and tabs read `Page · jApp`.

## Notes

- Each app allowlists its `.local` name via `vite.server.allowedHosts` — Vite's
  dev-server host check otherwise 403s through the proxy. The port in the `Host`
  header doesn't need listing; Vite compares hostnames.
- `.local` names are resolved by OrbStack (custom domains via the
  `dev.orbstack.domains` label). Nothing may pin them in `/etc/hosts` — a
  `127.0.0.1` entry there shadows OrbStack's DNS and breaks the edge;
  `./jsuite setup` removes any leftovers from the old mkcert-based setup.
- Requires "Allow access to container domains & IPs" in OrbStack's
  Settings → Network (on by default).
- Dev-log noise: `[Icon] failed to load icon lucide:*` warnings come from
  `@nuxt/icon`'s SSR-side fetch and are harmless — the browser loads icons via
  each app's `/api/_nuxt_icon/*` endpoint, which works.
- The old `control-center/` dashboard (localhost:7777) is gone — `./jsuite`
  replaced it. `www/index.html` is a static links page with no process behind it.
