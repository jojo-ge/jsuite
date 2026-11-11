# jSuite

A pnpm-workspace monorepo of one local dev app, **jTicket**, behind one HTTPS
edge — one command, a stable name, so you can point LLMs (and bookmarks) at a
fixed URL instead of juggling dev servers. jTicket plans work, runs it in
terminal claude sessions, and holds what comes back: boards and local PRs,
block documents, editable charts, multi-reviewer code review, and a diff viewer
with guided tours. Documents, charts, reviews and diffs were once separate apps
(jExplain, jChart, jReview, jDiff); they are jTicket features now. OrbStack
provides DNS + HTTPS for the `.local` names; a single Caddy container routes
them to the native dev server:

```sh
git clone git@github.com:jojo-ge/jsuite.git && cd jsuite
./jsuite setup      # once (re-runnable) — see Setup below
./jsuite start      # jTicket + edge
```

| URL                      | What                                   | Host port |
| ------------------------ | -------------------------------------- | --------- |
| https://jsuite.local     | index (static page in `www/`)          | —         |
| https://jticket.local    | jTicket                                | 43000     |
| https://jexplain.local   | redirect-only: `/e/K` → jTicket `/e/K`             | — |
| https://jreview.local    | redirect-only: `/r/K` → jTicket `/reviews/K`       | — |
| https://jchart.local     | redirect-only: `/c/K` → jTicket `/charts/K`        | — |

The three redirect-only hosts exist because stored tickets, docs and review
reports still link to them. They answer 302s (the query string is kept), and
any other path lands on that feature's index (`/e`, `/reviews`, `/charts`).
Nothing new should link through them.

jTicket's features, by where they live:

| Feature | Where | Drive it with |
| --- | --- | --- |
| Board, local PRs, Today, Graphs, Analytics | `/`, `/projects/KEY`, `/today`, `/graphs`, `/analytics` | `jt`, `to-jticket`, `jimplement`, `jwayfinder` |
| Auto mode (the jButton) and run plans | a project's board and **Run setup** tab | `jorchestrate`, `jrunplan`, `jslice-report` |
| Documents | `/e` (library), `/e/<key>` (reader); a project's **Docs** tab | `j-explain`, `to-jspec`, `to-jdoc` |
| Charts | `/charts`, `/charts/<key>` (editor; `/c/<key>` is an alias) | `j-chart` |
| Reviews of a project's branch | a project's **Review** tab; the room `/reviews/<key>` (`/r/<key>` alias) | `jreview-report`, `jreview-triage`, `jreview-consensus`, `jarch-review` |
| PR review projects | the **Reviews** board (`/reviews`), with the codebase's open PRs | `make-jreview-project`, `jreview-assess`, `jpr-check` |
| Diff and tours | a project's **Diff** tab | `jdiff-tour` |

`apps/jticket/README.md` covers each feature in depth; the root `CLAUDE.md`
routes requests to them.

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
2. `pnpm install` — one lockfile at the root installs jTicket and every package
3. installs every repo-owned jskill into `~/.claude/skills` (manifest:
   `SKILLS_MANIFEST` in `./jsuite`) and prunes links there that point nowhere
   (a retired app's skills), shims `jsuite` and `jt` into `~/.local/bin`, then
   — when run from a real terminal — the interactive `mattpocock/skills`
   installer
4. runs the data migrations — each rewrites an older `.data` shape in place
   and is a no-op once applied (today: jTicket's ticket types —
   `AFK`/`HITL` types and `wayfinder:<sub-type>` labels become a main `type`
   plus `afk`/`hitl`/`prototype` tags; `apps/jticket/scripts/migrate-ticket-types.ts`)
5. removes leftovers from the old mkcert-based edge (stale `/etc/hosts`
   pins, `./certs/`), which would otherwise shadow OrbStack's DNS

It is safe to re-run at any time — after adding a skill, or pulling dependency
or data-shape changes. Finish with `./jsuite start`; on the first HTTPS visit
OrbStack asks once to trust its local CA, and jTicket gets a green lock from
then on.

## Layout

```
jsuite/
├── jsuite              # the launcher (start/stop/status/logs/open/setup/sandbox)
├── Caddyfile           # edge routing config (runs in Docker; OrbStack does TLS)
├── docker-compose.yml
├── www/                # static index page (https://jsuite.local)
├── CLAUDE.md           # request-routing guide for agents working in this repo
├── .claude/skills/     # suite-level skills (jsuite — the map of jTicket)
├── .data/              # all state, gitignored (see @jsuite/data)
├── bin/jt              # the jTicket CLI
├── apps/
│   └── jticket/        # the app: board, documents, charts, reviews, diff (owns every jskill but jsuite, has its own j-setup)
└── packages/
    ├── charting/       # @jsuite/charting — shared chart module (Nuxt layer)
    ├── documents/      # @jsuite/documents — shared block-document system (Nuxt layer)
    ├── herdr/          # @jsuite/herdr — shared herdr (terminal workspace) adapter
    ├── relay/          # @jsuite/relay — jTicket sync relay (Supabase setup wizard + local broadcast server)
    └── data/           # @jsuite/data — shared .data resolver
```

The workspace is a single git repo and a pnpm monorepo. One lockfile at the
root; `pnpm install` here installs everything. jTicket is the only app:
`apps/jticket/tests/suiteWiring.test.ts` fails if another appears in `apps/`,
the `APPS` table or the lockfile.

## @jsuite/data

All state lives under `.data/<area>/` at the repo root, never inside the app's
directory. One gitignored `.data` is the whole suite's state — simple to back
up, wipe, or point an LLM at — and it survives the app being reinstalled.

```ts
import { appDataDir, appDataFile } from '@jsuite/data'
const DATA_DIR = appDataDir('jchart')                 // <root>/.data/jchart
const FILE = appDataFile('jticket', 'jticket.json')   // parents created
```

Add `"@jsuite/data": "workspace:*"` to a package's `dependencies`; that's all —
it's plain ESM, so Nitro consumes it with no transpile step and there's no layer
to extend. The root is found by walking up to `pnpm-workspace.yaml`, so it works
however the app is launched; `./jsuite` also exports `JSUITE_DATA_DIR`, which
overrides the search when set.

The directories keep the names of the apps that once owned them:

| directory | state |
| --- | --- |
| `.data/jticket/` | `jticket.json` (the store — API-only, never hand-edited) + `attachments/`, `sessions.json` (the analytics ledger), `sync.json` |
| `.data/jexplain/` | the document pool: `<key>.json` (+ `.notes.json`) — every jTicket doc, review report and explainer |
| `.data/jchart/` | the chart pool: `<key>.json` (+ `.notes.json`) — the chart editor and every document's chart blocks |
| `.data/jreview/` | `<key>.json` per review: reviewer/triage dispatch state and the findings (the reports themselves are documents in the pool) |
| `.data/jdiff/` | `tours.json` and `failures.json` — the Diff tab's tours |

## @jsuite/charting

The Excalidraw canvas, Mermaid→scene conversion, and scene utilities live in
`packages/charting` as a Nuxt layer. jTicket extends it (through
`@jsuite/documents`); a consumer needs three things:

1. `"@jsuite/charting": "workspace:*"` in `dependencies`
2. `extends: ['@jsuite/charting']` in `nuxt.config.ts`
3. a postinstall step to copy the Excalidraw fonts into its `public/`:
   `node ../../packages/charting/scripts/copy-excalidraw-assets.mjs`

That provides `<ExcalidrawCanvas>`, `mermaidToScene()`, the scene utils
(auto-imported), types via `'@jsuite/charting/scene'` / `'@jsuite/charting/store'` —
**and the shared chart store**: the layer carries `server/api/charts/**` over
`.data/jchart/`. A chart embedded in a document is the same object jTicket's
chart editor (`/charts/<key>`) opens; edits and notes flow both ways.

## @jsuite/documents

The block-based document system — the model (prose, callout,
code, diff, chart, image, steps, compare, timeline, takeaway + glossary), the
renderers (`Block*.vue`, `<NotesRail>`, `<DocumentArticle>` — the full reading
experience with margin notes), `useMarkdown()`/`useShiki()`, and the
`server/api/documents/**` routes over `.data/jexplain/` — lives in
`packages/documents` as a Nuxt layer, extended by jTicket. It `extends`
`@jsuite/charting` itself, so chart blocks and `/api/charts/**` ride in
transitively. A consumer needs:

1. `"@jsuite/documents": "workspace:*"` in `dependencies`
2. `extends: ['@jsuite/documents']` in `nuxt.config.ts`
3. the charting postinstall step (chart blocks render Excalidraw):
   `node ../../packages/charting/scripts/copy-excalidraw-assets.mjs`
4. one line in its Tailwind entry css so the layer components' utility
   classes are generated: `@source "../../../../../packages/documents/app";`

Types come from `'@jsuite/documents/types'` (client-safe) and
`'@jsuite/documents/store'` (server). **One document pool**: a jTicket doc
(tracker record + `documentKey`) is the same object the reader at `/e/<key>`
renders and the library at `/e` lists; review notes and chart edits flow both
ways. jTicket wraps documents in project/status/label metadata.

## @jsuite/herdr

The Herdr adapter born in jTicket — drives the `herdr` terminal workspace
manager over its socket CLI: binary resolution (`HERDR_BIN` → PATH →
`~/.local/bin`), JSON command exec, a ~5s state cache (`herdrState()` reports
`{ available: false }` when herdr isn't running, so UIs degrade to hidden
buttons), workspace/tab topology (`ensureHerdrWorkspace`, `acquirePackedPane`
packs panes 2×2 per tab, `createJobTab`), macOS window focusing, and
`startClaudeIn` (start a claude agent in a pane, submit the prompt, and
confirm claude actually started on it; extra CLI args for the claude binary —
e.g. `--model` — pass through `opts.args`). `startClaudeIn` retries a shell
that isn't at its prompt yet, accepts claude's folder-trust dialog (any other
startup screen fails with the screen in the error), and submits with
`agent prompt --wait` — on a stall it presses Enter on text left in claude's
input, resubmits only when the prompt is nowhere on screen, and otherwise
fails loudly (`submitPrompt` does the same for prompts to a live agent, e.g.
the auto loop's nudges). Every dispatch queues on one lock
(`withHerdrLock`, lock file `.data/herdr/dispatch.lock`, re-entrant) so
list-then-create steps never interleave; wrap a whole workspace → pane →
claude sequence in it to make the sequence atomic. Every CLI call has a
timeout (30s default). Plain ESM, no layer; failures throw `HerdrError` with
an HTTP-ish `statusCode` and herdr's error `code`.
jTicket dispatches every session through it — ticket work, loops, merges,
reports, reviewers and their triage/consensus sessions, PR-review assessors
and checks, and Diff-tab tours — via `apps/jticket/server/utils/herdr.ts`,
which adds the sandbox guards.

## @jsuite/relay — jTicket project sync

`packages/relay` is the setup half of **jTicket sync**: two people, each
running jSuite on their own machine, collaborating on one jTicket project.
Sync is pull-only, human-approved, and snapshot-based:

- One user opens the project's **Share** panel, picks the shared 1–4 char key
  and names their coworker; the link they paste over their own chat channel
  opens the peer's import screen. **Links are valid 2 hours** — re-sharing
  re-arms the same share with a fresh room and window; stop-sharing revokes it
  instantly and tells the peer why. Expiry gates new requests only: an
  in-flight pull completes.
- While both apps run, either side can click **Sync**; the serving side
  **approves each pull in their UI** (named: who's asking, for what) before
  any data moves. The link creator mints odd ticket numbers, the importer
  even, so the shared project needs no coordination — and is hard-locked to
  exactly two peers.
- Transport: **Supabase Realtime Broadcast**. Each machine opens one outbound
  WSS connection to `<project>.supabase.co` and joins a broadcast topic named
  by the share's room id. Nothing is deployed into Supabase — no functions, no
  tables, no SQL. Because it is one ordinary outbound HTTPS connection, sync
  works on networks where nothing peer-to-peer can be established: symmetric
  NAT, blocked UDP, corporate proxies.
- Security model: frames are **sealed end-to-end** before they leave the
  machine — AES-256-GCM under a key derived (HKDF) from the share's room
  secret, which only ever travels in the link's URL *fragment*. Supabase
  relays ciphertext it cannot read, and a forged frame fails the auth tag, so
  the relay is data-blind exactly as the old signaling worker was. The room
  id is 96 random bits, so the topic is unguessable — but nothing rests on
  that. There is no write path between machines: peer-owned entities are
  read-only and never dispatchable (enforced at the API), peer-authored text
  entering a locally-built prompt is wrapped in untrusted-content framing, and
  machine-local fields (`repo`, integration branch) never leave the machine.
- Quotas, on Supabase's free plan: 256 KB per broadcast payload and 100
  messages/second. Snapshots are chunked to 96k characters and sent one
  server-acknowledged frame at a time, which doubles as flow control — a
  megabyte board crosses in about a dozen frames.

**Setting up**: `packages/relay/wizard.sh` walks the one-time Supabase setup
(create a free project → copy its URL and publishable key → verify → wire) and
writes them to `.data/jticket/sync.json`, which a running jTicket picks up
without a restart. **Both machines must point at the same Supabase project** —
the coworker runs the wizard too and chooses option 2 (wire an existing
project). Wire the **publishable (anon)** key, never a secret/service_role key;
jTicket has no use for one. `JTICKET_SUPABASE_URL` / `JTICKET_SUPABASE_KEY`
override the file; with nothing set, sharing warns in the panel and pulls
refuse with a 503 naming the wizard.

Local development and tests never touch Supabase: `startLocalRelay()` runs a
small WebSocket broadcast server with the same topic fan-out semantics, and
`JTICKET_SYNC_RELAY_URL` points an instance at it.

## jSkills

jTicket owns its Claude skills in `apps/jticket/.claude/skills`: the board's
(`to-jticket`, `to-jspec`, `to-jdoc`, `jwayfinder`, `jimplement`,
`jorchestrate`, `jrunplan`, `jslice-report`, `jarchitect-scan`,
`jarchitect-grill`, `jreproduce`), documents' and charts' (`j-explain`,
`j-chart`), reviews' (`jreview-report`, `jreview-triage`, `jreview-consensus`,
`jarch-review`, `make-jreview-project`, `jreview-assess`, `jpr-check`) and the
Diff tab's (`jdiff-tour`). Suite-level skills live in `.claude/skills/` at the
repo root: `jsuite` is the map — what each jTicket feature does and which
feature/skill a request routes to.

`./jsuite setup` installs them all globally (plus the interactive
`mattpocock/skills` installer when run from a terminal). The `SKILLS_MANIFEST`
table in `./jsuite` lists them, and `./jsuite skills [--dry-run] [--only <app dir>]`
makes just the links. `apps/jticket/j-setup` (jTicket's standalone installer)
delegates to `./jsuite skills --only apps/jticket`, so there is one list and one
link/prune implementation — `suiteWiring.test.ts` runs both entry points.

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
./jsuite start            # start jTicket's dev server + the Caddy edge
./jsuite stop             # stop all of it (kills jTicket's whole process group)
./jsuite restart
./jsuite status           # pid + live HTTPS status code
./jsuite logs [jticket|edge]  # tail -F; no arg = every log in logs/
./jsuite open [jticket]   # open in the browser (default: the index)
./jsuite root             # print this checkout's path (skills use it to find .data/)
./jsuite setup            # onboarding: OrbStack check, pnpm install, skill links,
                          # .data migrations, cleanup of the old mkcert/hosts edge — re-runnable
./jsuite sandbox [--port N] [--fresh] [--repos /abs/a:/abs/b] [--engines]
                          # run THIS checkout's jTicket on a port from 43100, over a
                          # copy of the live .data, engines off, git/gh writes and
                          # herdr sessions refused outside --repos (for worktrees)
```

State lives beside the script: `logs/<app>.log`, `run/<app>.pid`.

## Design

jTicket runs **natively on the host**; only Caddy is containerised. That is
deliberate — jTicket needs host `git`, `gh`, `herdr`, the `claude` CLI, the
native folder picker and open-in-VSCode, none of which survive
containerisation. OrbStack terminates TLS; Caddy routes `jticket.local` to
`host.docker.internal:43000`, serves `jsuite.local` from `www/`, and answers
the redirect-only hosts itself.

```
browser ──TLS──▶ [ OrbStack proxy :443 ] ──http──▶ [ Caddy :80 ] ──http──▶ host.docker.internal:43000 (jticket.local)
                                                          ├─ /srv/www (jsuite.local)
                                                          └─ 302 → jticket.local (jexplain/jreview/jchart.local)
                        │
                        └─ OrbStack local CA, auto-trusted on first visit
```

`./jsuite start` refuses to start jTicket when its port is held by something it
didn't launch (a stale dev server), rather than letting Nuxt silently pick a
different port and break the proxy.

## Adding a hostname

New product surface goes into jTicket, not a new app. If a name ever has to
change on the edge:

1. Add or change its block in the `Caddyfile`.
2. Keep `DOMAINS` in `./jsuite` AND the `dev.orbstack.domains` label in
   `docker-compose.yml` the same set (`suiteWiring.test.ts` checks the three
   agree). A name jTicket itself answers also needs allowlisting in
   `apps/jticket/nuxt.config.ts` → `vite.server.allowedHosts`.
3. `./jsuite restart` from the main checkout — the label and `Caddyfile` are
   only read when the container is recreated.

## Notes

- jTicket allowlists `jticket.local` via `vite.server.allowedHosts` — Vite's
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
  jTicket's `/api/_nuxt_icon/*` endpoint, which works.
- The old `control-center/` dashboard (localhost:7777) is gone — `./jsuite`
  replaced it. `www/index.html` is a static links page with no process behind it.
