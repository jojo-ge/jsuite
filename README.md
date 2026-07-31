# jSuite

A pnpm-workspace monorepo of four local dev apps behind one HTTPS edge — one
command, one port, stable names, so you can point LLMs (and bookmarks) at fixed
URLs instead of juggling dev servers:

```sh
cd ~/code/anyway/jsuite
pnpm install        # once (and after dependency changes)
./jsuite start      # apps + edge
```

| URL                          | App     | Host port |
| ---------------------------- | ------- | --------- |
| https://jsuite.local:7443    | index (static links page) | — |
| https://jticket.local:7443   | jTicket | 3000      |
| https://jdiff.local:7443     | jDiff   | 3002      |
| https://jchart.local:7443    | jChart  | 3003      |
| https://jexplain.local:7443  | jExplain | 3004     |

## Layout

```
jsuite/
├── jsuite              # the launcher (start/stop/status/logs/open/setup)
├── j-setup             # installs every repo-owned jskill into ~/.claude/skills
├── Caddyfile           # HTTPS edge config (runs in Docker)
├── docker-compose.yml
├── www/                # static ecosystem index page (https://jsuite.local:7443)
├── CLAUDE.md           # request-routing guide for agents working in this repo
├── .claude/skills/     # suite-level skills (jsuite — the ecosystem map)
├── .data/              # every app's state, gitignored (see @jsuite/data)
├── apps/
│   ├── jticket/        # epics + tickets + docs (owns most jskills, has its own j-setup)
│   ├── jdiff/          # diff / PR review workbench
│   ├── jchart/         # diagram workbench (specialised chart app)
│   └── jexplain/       # blog-style explainers with live charts
└── packages/
    ├── charting/       # @jsuite/charting — shared chart module (Nuxt layer)
    ├── documents/      # @jsuite/documents — shared block-document system (Nuxt layer)
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

## jSkills

Apps own their Claude skills in `<app>/.claude/skills` (the jTicket pattern:
jticket owns `jimplement`, `jwayfinder`, `to-jticket`, `to-jspec`, `to-jdoc`;
jchart owns `j-chart`; jexplain owns `j-explain`). Suite-level skills live in
`.claude/skills/` at the repo root: `jsuite` is the ecosystem map — what each
app does, how they relate, and which app/skill a request routes to. Install
them all globally with:

```sh
./j-setup             # jskills + mattpocock/skills
./j-setup --skills    # just the jskills
```

The manifest at the top of `./j-setup` says which app owns what; keep
`apps/jticket/j-setup` (the app-local installer) in sync with its row.

## Why 7443

Not `:443`. The kraken/phoenix dev runtime (`kraken/.fleet/edge`) runs its own
Caddy on `:80`/`:443`, and whichever binds first wins — so the two edges used to
fight. `7443` is unclaimed, needs no root, and is the **only** published port:
everything else is reached by name through it.

Always include the scheme: `https://jticket.local:7443`. Caddy answers plaintext
on that port with a 400, not a redirect.

## Commands

```sh
./jsuite start            # start every dev server + the Caddy edge
./jsuite stop             # stop all of it (kills each app's whole process group)
./jsuite restart
./jsuite status           # pid + live HTTPS status code per app
./jsuite logs [app|edge]  # tail -F; no arg = every app
./jsuite open [app]       # open in the browser (default: the index)
./jsuite setup            # one-time: mkcert CA, cert, /etc/hosts (asks for sudo)
```

State lives beside the script: `logs/<app>.log`, `run/<app>.pid`.

## Design

The apps run **natively on the host**; only Caddy is containerised. That is
deliberate — jDiff needs host `git`, `gh`, the `claude` CLI, the native folder
picker and open-in-VSCode, none of which survive containerisation. Caddy just
terminates TLS and reverse-proxies each name to `host.docker.internal:<port>`.

```
browser ──TLS──▶ [ Docker: Caddy :7443 ] ──http──▶ host.docker.internal:{3000,3001,3002,3003,3004}
                        │
                        └─ mkcert cert (./certs), trusted by the login keychain
```

`./jsuite start` refuses to start an app whose port is held by something it
didn't launch (a stale dev server), rather than letting Nuxt silently pick a
different port and break the proxy.

## Adding an app

1. Create it under `apps/<id>` (it joins the workspace automatically via
   `pnpm-workspace.yaml`), then `pnpm install` at the root.
2. Add a row to `APPS` in `./jsuite` (id | dir under apps/ | port | dev command).
3. Add a matching `https://<id>.local:7443` block to the `Caddyfile`.
4. Add the name to `DOMAINS` in `./jsuite`, re-run `./jsuite setup` (reissues the
   cert and appends any missing `/etc/hosts` names — it is safe to re-run), and
   allowlist the name in the app's `nuxt.config.ts` → `vite.server.allowedHosts`.
5. `./jsuite restart` — Caddy only reads the new cert and `Caddyfile` on restart.
6. Give it an identity: `public/favicon.svg` (32×32, dark rounded square + the
   app's accent from `www/site.css`), plus `app.head` in `nuxt.config.ts` with
   the title, description and icon link, and a `titleTemplate` in `app.vue` so
   pages set only their own name and tabs read `Page · jApp`.

## Notes

- **Caddy is pinned to `2.11.2-alpine`.** 2.11.4 sends a TLS `internal_error` on
  the SNI-matched, tag-restricted cert-selection policy that `tls <file>` per
  site generates; 2.11.2 serves it cleanly. Revisit when a fixed 2.11.x ships.
  macOS's system curl/python are LibreSSL and mask this — diagnose with
  `/opt/homebrew/opt/openssl@3/bin/openssl s_client -servername <host>`.
- Each app allowlists its `.local` name via `vite.server.allowedHosts` — Vite's
  dev-server host check otherwise 403s through the proxy. The port in the `Host`
  header doesn't need listing; Vite compares hostnames.
- `.local` names resolve via `/etc/hosts`; macOS's mDNSResponder honours them.
- `./jsuite setup` is re-runnable: it reissues the cert for the full `DOMAINS`
  list and appends only the `/etc/hosts` names that are missing.
- Dev-log noise: `[Icon] failed to load icon lucide:*` warnings come from
  `@nuxt/icon`'s SSR-side fetch and are harmless — the browser loads icons via
  each app's `/api/_nuxt_icon/*` endpoint, which works.
- The old `control-center/` dashboard (localhost:7777) is gone — `./jsuite`
  replaced it. `www/index.html` is a static links page with no process behind it.
