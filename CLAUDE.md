# jSuite

Four local Nuxt apps (jticket, jdiff, jchart, jexplain) + shared packages behind
one Caddy HTTPS edge on :7443.
`README.md` covers architecture; this file is for routing requests to the right
app, and the rules that keep the suite consistent. The `jsuite` skill (installed
globally by `./j-setup`) carries the same map for sessions outside this repo.

## Routing — which app does a request belong to?

| Request smells like… | App | How to drive it |
| --- | --- | --- |
| tickets, epics, breakdowns, boards, specs, draft docs | `apps/jticket` | HTTP API on :3000 — skills `to-jticket`, `to-jspec`, `to-jdoc`, `jwayfinder`, `jimplement` |
| PR review, branch diff, review comments | `apps/jdiff` | `jdiff` CLI (`jdiff pr N`, `jdiff branch B`, `--print`) |
| diagrams the human edits/annotates | `apps/jchart` | skill `j-chart`; API on :3003; state in `.data/jchart/` |
| explainers, walkthroughs, post-mortems, articles | `apps/jexplain` | skill `j-explain` (`explain.py` publish script) |
| charts embedded in articles | shared pool | `packages/charting` serves `/api/charts` over `.data/jchart/` in every consumer — jExplain charts ARE jChart charts |
| block documents (docs, specs, explainers) | shared pool | `packages/documents` serves `/api/documents` over `.data/jexplain/` in jTicket AND jExplain — a jTicket doc IS a jExplain document |

When a request spans apps (e.g. "spec this, then diagram it"), do each part with
that app's own skill rather than improvising one app's job in another.

## Rules of the suite

- **State lives in `.data/<app>/` at this root, never inside an app.** Use
  `@jsuite/data` (`appDataDir`/`appDataFile`) to resolve paths. jTicket's state
  is API-only — go through :3000, don't hand-edit `.data/jticket/jticket.json`.
- **URLs always carry scheme + port**: `https://<app>.local:7443`. Bare ports
  (3000–3004) work too but the `.local` names are what tooling hardcodes.
- **Ports are fixed.** The `APPS` table in `./jsuite`, the `Caddyfile`, and
  skills that hardcode ports (to-jticket → :3000) must stay in sync.
- **Adding an app**: follow "Adding an app" in `README.md` — `apps/<id>`, `APPS`
  row, `Caddyfile` block, `DOMAINS` entry, `./jsuite setup`, allowlist the
  `.local` name in `vite.server.allowedHosts`, then `./jsuite restart`. Also add
  a card to `www/index.html` and update the `jsuite` skill's app table.
- **Skills are app-owned** in `<app>/.claude/skills`; the suite-level `jsuite`
  skill lives in `.claude/skills/` here at the root. `./j-setup` installs all of
  them globally from the `MANIFEST` at its top — new skill ⇒ new manifest entry
  (and keep `apps/jticket/j-setup` in sync for jticket-owned ones).
- **One git repo covers the whole workspace.** Apps no longer carry their own
  `.git`; commit everything (apps, packages, skills) from this root.
- **Don't restart apps blindly.** `./jsuite status` first; `./jsuite start` is
  idempotent for already-running apps but refuses ports held by processes it
  didn't start. Logs are at `logs/<app>.log` (`./jsuite logs <app>`).

## Layout

```
jsuite            # launcher: start/stop/status/logs/open/setup
j-setup           # installs every jskill globally (MANIFEST at top)
Caddyfile         # edge config — one block per .local name
www/index.html    # static ecosystem index at https://jsuite.local:7443
.claude/skills/   # suite-level skills (jsuite)
apps/             # jticket jdiff jchart jexplain
packages/         # @jsuite/charting (Nuxt layer), @jsuite/data (.data resolver)
.data/<app>/      # ALL app state, gitignored
```
