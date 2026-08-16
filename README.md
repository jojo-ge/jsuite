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
| https://jrig.local       | jRig                      | 43006     |

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
│   ├── jdiff/          # diff / PR review shell — short routes over @jsuite/diff
│   ├── jchart/         # diagram workbench (specialised chart app)
│   ├── jexplain/       # blog-style explainers with live charts
│   ├── jgrilling/      # browser grilling sessions (claude interrogates your plan)
│   └── jrig/           # avatar studio — draw, rig and keyframe 2D characters
└── packages/
    ├── charting/       # @jsuite/charting — shared chart module + UI (Nuxt layer)
    ├── claude/         # @jsuite/claude — shared local-claude CLI runner
    ├── diff/           # @jsuite/diff — shared diff-review engine + UI (Nuxt layer)
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
| jgrilling | `.data/jgrilling/<key>.json` — grilling sessions; debriefs land in the shared document pool |
| jrig | `.data/jrig/` — character/clip JSON documents (schema-validated) |

## @jsuite/charting

The whole chart experience — Excalidraw canvas, Mermaid→scene conversion, scene
utilities, the store **and the UI** — lives in `packages/charting` as a Nuxt
layer, so an app can serve charts rather than merely embed them. A consumer
needs four things:

1. `"@jsuite/charting": "workspace:*"` in `dependencies`
2. `extends: ['@jsuite/charting']` in `nuxt.config.ts`
3. a postinstall step to copy the Excalidraw fonts into its `public/`:
   `node ../../packages/charting/scripts/copy-excalidraw-assets.mjs`
4. one line in its Tailwind entry css so the layer components' utility classes
   are generated: `@source "../../../../../packages/charting/app";`

That provides `<ExcalidrawCanvas>`, `mermaidToScene()`, the scene utils
(auto-imported), types via `'@jsuite/charting/scene'` / `'@jsuite/charting/store'`,
**the shared chart store** — `server/api/charts/**` over `.data/jchart/` — and
**the pages**: `/charts` (the library) and `/charts/<key>` (the full workbench:
canvas, notes, Mermaid source editor), rendered by `<ChartLibrary>` and
`<ChartWorkbench>`. Every consumer serves the same chart pool, so a chart
embedded in jExplain is the same object opened in jChart; edits and notes flow
both ways.

An app that wants that UI on different paths overrides `charting.indexPath` and
`charting.chartPath` in its `app.config.ts` and mounts the components itself —
which is all jChart is now: `/` and `/c/<key>` are aliases over the same
components the layer serves at `/charts`. An app that wants the layer's paths
but its own chrome mounts `<ChartLibrary>` under it: jTicket's `/charts` is the
library under the board's header, while `/charts/<key>` is left to the layer,
the workbench being a full-screen canvas that a nav bar only steals height from.

## @jsuite/diff

The diff-review engine born in jDiff — target resolution, the diff/graph/file/PR
routes, the claude analysis runs, and every review artifact store — lives in
`packages/diff` as a Nuxt layer. A consumer needs two things:

1. `"@jsuite/diff": "workspace:*"` in `dependencies`
2. `extends: ['@jsuite/diff']` in `nuxt.config.ts`

That serves the whole review API off the consumer's own port: `/api/diff`,
`/api/file`, `/api/graph`, `/api/prs`, `/api/pr`, `/api/branches`, `/api/repo`,
the artifact routes (`/api/comment(s)`, `/api/branch-comment(s)`, `/api/rating`,
`/api/risk`, `/api/tour`, `/api/ask(s)`, `/api/ask-yourself*`,
`/api/notifications`), and the claude runs (`/api/analyze-generate`,
`/api/ai-jobs`, `/api/ai-job-cancel`). The server utils come as Nitro
auto-imports (`resolveTarget`/`prepareTarget`, `run`/`resolveRepoPath`,
`buildDiff`, `highlight`, the stores), and the review vocabulary the UI shares
with the server — the rating shape, risk levels, tour shape, ask questions,
file categories, the comment entry — is auto-imported as app utils and also
importable explicitly from `'@jsuite/diff/rating'`, `'/risk'`, `'/tour'`,
`'/askQuestions'`, `'/askYourself'`, `'/fileCategories'`, `'/comments'`.

**And the whole review UI**, as pages namespaced under `/diffs`:

| route | screen |
| --- | --- |
| `/diffs` | the repo picker |
| `/diffs/prs` | open pull requests in `?repo=` |
| `/diffs/pr/<n>` | the PR diff — comments, tour, risk, per-line asks |
| `/diffs/pr/<n>/summary` | that PR's guidance artifacts |
| `/diffs/branches` | local branches in `?repo=` |
| `/diffs/branch` | a local branch diff (`?branch=&base=`) |
| `/diffs/branch-summary` | that branch's guidance artifacts |

Each of those pages is a two-line wrapper over a component the layer also
exports — `<DiffHome>`, `<DiffPrList>`, `<DiffPrReview>`, `<DiffPrSummary>`,
`<DiffBranchList>`, `<DiffBranchReview>`, `<DiffBranchSummary>` — so a consumer
can mount the same screen anywhere else instead. Links *between* screens go
through `useDiffRoutes()`, which reads `diff.basePath` and `diff.brand` from the
app's `app.config.ts`; that is how jDiff keeps serving the same components on
its own short URLs (`/prs`, `/pr/<n>`, `/branch`) with no duplicated code — and
why no screen in the layer may hardcode a review path. The table itself is a
pure function, `diffRoutes(basePath)` from `'@jsuite/diff/routes'`, so a
consumer's *server* code — which has no app config to read — can build the same
links: that is how jTicket resolves an attached diff to a URL on its own review
page rather than jDiff's.

Those seven are screens, and they behave like it — full height, teleported
panels, they take the page title and the body's scroll. `<DiffReviewCard>` is
the small one, for hosts that want a review *inside* a page: one target, what
the change is and what the analysis made of it, with the way through to the
real screen. jTicket renders it for a `diff` attachment on a ticket.

The palette is scoped to `.diff-surface` / `.diff-overlay` rather than `:root`,
so an app that only embeds a review screen keeps its own theme everywhere else;
`.diff-embed` is the same palette without the full-page assumption (it takes the
height of its content), which is what `<DiffReviewCard>` sits on, and
`--diff-bg` is the single token that does sit on `:root`, for a consumer
painting its own page to match. Each screen mounts its own
`<DiffScrollTopButton>`, so it follows the UI into whatever app hosts it.

**One review pool serves every consumer**: all state stays in `.data/jdiff/`
via `@jsuite/data`, so a rating, tour or draft comment created through one
consumer reads back identically in another — and, now that the UI is shared
too, identically through either route. A target is always addressed by query
params — `?repo=` plus `?number=` (a PR) or `?branch=&base=` (a local branch) —
so the layer holds no per-app repo config. jDiff stays a thin shell over it: its
short routes, the scratch prototypes, and the `jdiff` CLI. jTicket is the other
consumer: it serves the same screens at `/diffs`, opens its projects' PRs there
rather than at jdiff.local, and attaches reviews to tickets.

One thing to watch when extending the layer alongside server code of your own:
`run` and `resolveRepoDir` are Nitro auto-imports here, and a consumer that
already has helpers by those names will have the collision resolved for it,
silently. jTicket's are `runInRepo`/`projectRepoDir` for exactly that reason.

## @jsuite/documents

The block-based document system born in jExplain — the model (prose, callout,
code, diff, chart, steps, compare, timeline, takeaway + glossary), the
renderers (`Block*.vue`, `<NotesRail>`, `<DocumentArticle>` — the full reading
experience with margin notes), `useMarkdown()`/`useShiki()`, the whole-pool
library and reader (`<DocumentLibrary>`, `<DocumentReader>`, mounted at
`/documents` and `/documents/<key>`) along with the state behind their label
chip bar (`labelPool()` + `useLabelFilter()`, which jTicket's own grouped
`/documents` page drives too), and the `server/api/documents/**` routes
over `.data/jexplain/` — lives in `packages/documents` as a Nuxt layer. It
`extends` `@jsuite/charting` itself, so chart blocks, `/api/charts/**` **and the
`/charts` chart UI** ride in transitively. A consumer needs:

1. `"@jsuite/documents": "workspace:*"` in `dependencies`
2. `extends: ['@jsuite/documents']` in `nuxt.config.ts`
3. the charting postinstall step (chart blocks render Excalidraw):
   `node ../../packages/charting/scripts/copy-excalidraw-assets.mjs`
4. two lines in its Tailwind entry css so both layers' component utility
   classes are generated — charting rides in transitively, so it needs its
   own `@source` too:
   ```css
   @source "../../../../../packages/documents/app";
   @source "../../../../../packages/charting/app";
   ```

Types come from `'@jsuite/documents/types'` (client-safe) and
`'@jsuite/documents/store'` (server). **One document pool serves every
consumer**: a jTicket doc (tracker record + `documentKey`) is the same object
jExplain lists and renders; review notes and chart edits flow both ways.
Every consumer therefore gets a documents library at `/documents` for free —
the whole pool, explainers and specs and grilling debriefs alike. An app that
wants it under its own routes mounts the components instead of copying them:
jExplain's `/` and `/e/<key>` are `<DocumentLibrary>`/`<DocumentReader>` with
jExplain's framing, and jGrilling's `/e/<key>` is the same reader — as is its
`/documents`, which mounts `<DocumentLibrary>` over the layer's own page to
withhold delete and point the list at `/e/<key>`. jTicket
mounts `<DocumentReader>` at `/documents/<key>` with delete withheld and the
projects a document is attached to in its `#chrome` slot — and it is the one
consumer that *replaces* the library page rather than mounting it, because it
knows something about these documents the pool does not: which project attaches
each. Same pool, grouped. (Its old `/docs` paths redirect there; the DOC-n
wrapper records they listed are gone.)

### Who may delete out of the pool

The host app's call, not the layer's — one shared file backs every consumer, so
`<DocumentLibrary>` and `<DocumentReader>` both take a `deletable` prop (default
`true`) rather than deciding for everyone. jExplain owns the pool's lifecycle
and leaves both on.

**jTicket never destroys a pool document from its UI** (TICK-151). Deleting the
shared file would dangle every attachment ref pointing at it while jExplain goes
on reading the same object; the tracker's job is to link artifacts, not to end
them. In practice its reader passes `:deletable="false"` and its library is
jTicket's own page with no delete affordance at all. The prop exists so the
rule is expressible in the layer instead of resting on the accident that jTicket
shadows the layer's `/documents` page: unshadow it and the button returns, which
is exactly what happened between TICK-136 and TICK-139.

**jGrilling never destroys a pool document either** (TICK-154). It writes
debriefs into the pool and reads them back; ending one is jExplain's call, which
is the line its `/e/<key>` reader always held. Until TICK-154 it held that line
on the reader alone while serving the layer's `/documents` **inherited and
unconfigured** — a delete button on every document in the pool, on a page nobody
there chose to put up, and a second one on the inherited reader at
`/documents/<key>`.

TICK-154 asked whether to configure that library or route it away, and jGrilling
answers differently for each of the two routes. The **library stays,
configured**: `:deletable="false"` removes the harm, and a pool this app writes
into is worth being able to look through from here, where the session list only
reaches debriefs a session produced. The **reader goes**: `/documents/<key>`
redirects to `/e/<key>`, since a second reader is only a second thing to keep
honest. The list points at that surviving reader via `reader-base`, so the
library and the reader cannot drift apart — they are one reader. This is the
first call site of the prop TICK-151 added.

Both rules bind the **UI only**, deliberately. The layer's
`DELETE /api/documents/<key>` stays mounted in every consumer, jTicket and
jGrilling included, so agents keep `:43000` as one API surface (TICK-143).

Both were also closed app by app. The layer still *defaults* `deletable` to
`true` and still ships a bare `<DocumentLibrary />` at `/documents`, so the next
consumer inherits delete unless someone remembers to shadow the page — which is
how jGrilling got it. Flipping that default and having jExplain opt in is
TICK-178; the same hole, untouched, on the **chart** pool is TICK-179.

## @jsuite/claude

The local-claude runner born in jDiff — `runClaude()` drives the `claude` CLI
(`-p --output-format stream-json`, the user's own subscription, no API key)
with live progress callbacks (`log`, `onThinking`, `onText`), tool allowlists
for headless runs (`ANALYSIS_TOOLS` = read-only file tools + git), an
overridable timeout (`JSUITE_CLAUDE_TIMEOUT_MS` or `opts.timeoutMs`), and
abort-signal cancellation. `extractJson()` repairs the JSON claude was asked to
return. Like `@jsuite/data` it is plain ESM with no layer to extend — add
`"@jsuite/claude": "workspace:*"` to `dependencies` and import. Failures throw
`ClaudeError` with an HTTP-ish `statusCode`, so h3 handlers can rethrow them
directly. jDiff and jGrilling both run on it.

## jSkills

Apps own their Claude skills in `<app>/.claude/skills` (the jTicket pattern:
jticket owns `jimplement`, `jwayfinder`, `to-jticket`, `to-jspec`, `to-jdoc`;
jchart owns `j-chart`; jexplain owns `j-explain`; jgrilling owns `j-grilling`). Suite-level skills live in
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

### Typechecking

```sh
pnpm typecheck                    # every app, including .vue files
pnpm --filter jticket typecheck   # one app
pnpm typecheck:constraints        # just the guard below, no vue-tsc
```

`pnpm typecheck` is **the** typecheck entry point for the workspace. Each app's
`typecheck` script is `nuxt typecheck`, which regenerates `.nuxt` types and then
runs `vue-tsc` over the app's project references — so `.vue` files are checked
(script *and* template), not just the `.ts` ones. The root script fans out with
`--no-bail`, so one failing app doesn't hide the others; it exits non-zero if
any app fails.

Three constraints keep this working, all easy to undo by accident — and all
three fail *quietly*, which is why they are enforced by
`scripts/check-typecheck-constraints.mjs` rather than by this section. It runs
first inside `pnpm typecheck`, so a broken constraint stops the run and names
the fix. Treat the list below as the reasoning; the script is the rule.

- **TypeScript is pinned to 5.9 workspace-wide** (`overrides` in
  `pnpm-workspace.yaml`, plus an explicit `typescript` devDependency in each
  app). `vue-tsc` 3.x loads `typescript/lib/tsc`, which TypeScript 7 dropped
  from its exports; apps that take `typescript` only as an auto-installed peer
  silently resolve 7 and die with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **`vue-router` must be v5** — Nuxt 4.5's generated tsconfig loads
  `vue-router/volar/sfc-route-blocks`, which only v5 exports. On v4 the Vue
  language plugin fails to load and typing quietly degrades.
- **Every `packages/*` layer that ships `.vue` files must declare `vue` as a
  devDependency** (`@jsuite/charting`, `@jsuite/documents`, `@jsuite/diff`).
  `vue-tsc` compiles an SFC to virtual TS that reaches for `vue` from the SFC's
  *own* directory, and under pnpm's strict layout a layer with no `vue`
  dependency cannot resolve it — an `@ts-ignore` in the generated code swallows
  the resolution failure, so `defineProps` silently returns `any` and every prop
  goes unchecked, in script and template alike, while the rest of the file still
  type-checks normally. It must stay a *dev*Dependency: the host app owns the
  runtime copy, and promoting it to `dependencies` would ship a second Vue
  instance into the bundle.

The guard checks each layer both ways: that the manifest declares `vue` as a
devDependency, and — once installed — that `vue` genuinely resolves from a
component's own directory, which is the property `vue-tsc` depends on and the
one a manifest line only stands in for. It exits 0 with a `skipped` line for the
resolution probe before `pnpm install`, rather than reporting a pass it hasn't
earned. Adding a fourth constraint means adding a check there.

## Design

The apps run **natively on the host**; only Caddy is containerised. That is
deliberate — jDiff needs host `git`, `gh`, the `claude` CLI, the native folder
picker and open-in-VSCode, none of which survive containerisation. OrbStack
terminates TLS; Caddy just routes each name to `host.docker.internal:<port>`.

```
browser ──TLS──▶ [ OrbStack proxy :443 ] ──http──▶ [ Caddy :80 ] ──http──▶ host.docker.internal:{43000,43002,43003,43004,43005,43006}
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
