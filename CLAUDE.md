# jSuite

Six local Nuxt apps (jticket, jdiff, jchart, jexplain, jgrilling, jrig) + shared
packages behind one Caddy edge; OrbStack resolves the `.local` names and
terminates HTTPS.
`README.md` covers architecture; this file is for routing requests to the right
app, and the rules that keep the suite consistent. The `jsuite` skill (installed
globally by `./jsuite setup`) carries the same map for sessions outside this repo.

## Routing — which app does a request belong to?

| Request smells like… | App | How to drive it |
| --- | --- | --- |
| tickets, epics, breakdowns, boards, specs, draft docs | `apps/jticket` | HTTP API on :43000 — skills `to-jticket`, `to-jspec`, `to-jdoc`, `jwayfinder`, `jimplement`. Also the **shell**: it serves the whole-pool Docs (`/documents`), Charts (`/charts`) and Diffs (`/diffs`) libraries, and renders a ticket's or project's attached documents, charts and diff reviews in place |
| PR review, branch diff, review comments | `apps/jdiff` | `jdiff` CLI (`jdiff pr N`, `jdiff branch B`, `--print`); the UI itself is `packages/diff` |
| diagrams the human edits/annotates | `apps/jchart` | skill `j-chart`; API on :43003; state in `.data/jchart/` |
| explainers, walkthroughs, post-mortems, articles | `apps/jexplain` | skill `j-explain` (`explain.py` publish script) |
| grill/stress-test a plan with the human answering in a UI | `apps/jgrilling` | skill `j-grilling`; API on :43005; state in `.data/jgrilling/` |
| avatar characters — draw, rig, keyframe 2D avatars | `apps/jrig` | studio at https://jrig.local; character/clip JSON in `.data/jrig/` (documents API on :43006); see `apps/jrig/docs/PLAN.md` |
| charts embedded in articles | shared pool | `packages/charting` serves `/api/charts` over `.data/jchart/` **and the chart UI** — library at `/charts`, workbench at `/charts/<key>` — in every consumer; jExplain charts ARE jChart charts |
| block documents (docs, specs, explainers) | shared pool | `packages/documents` serves `/api/documents` **and a whole-pool library at `/documents`** (reader at `/documents/<key>`) over `.data/jexplain/` in jTicket, jExplain AND jGrilling — a jTicket doc IS a jExplain document |
| diff review computed from a local checkout | shared pool | `packages/diff` serves the whole review API (`/api/diff`, `/api/prs`, `/api/analyze-generate`, the artifact stores) over `.data/jdiff/` **and the whole review UI** at `/diffs/…` in every consumer — jDiff just aliases it onto short routes |
| running the local `claude` CLI from an app server | shared pool | `packages/claude` (`runClaude`, `extractJson`, `ANALYSIS_TOOLS`) — jDiff and jGrilling both drive claude through it |

When a request spans apps (e.g. "spec this, then diagram it"), do each part with
that app's own skill rather than improvising one app's job in another.

## Rules of the suite

- **State lives in `.data/<app>/` at this root, never inside an app.** Use
  `@jsuite/data` (`appDataDir`/`appDataFile`) to resolve paths. jTicket's state
  is API-only — go through :43000, don't hand-edit `.data/jticket/jticket.json`.
- **URLs always carry the scheme**: `https://<app>.local`. Bare host ports
  (43000–43006) work too but the `.local` names are what tooling hardcodes.
- **Ports are fixed.** The `APPS` table in `./jsuite`, the `Caddyfile`, and
  skills that hardcode ports (to-jticket → :43000) must stay in sync.
- **Adding an app**: follow "Adding an app" in `README.md` — `apps/<id>`, `APPS`
  row, `Caddyfile` block, `DOMAINS` entry + the `dev.orbstack.domains` label in
  `docker-compose.yml`, allowlist the `.local` name in
  `vite.server.allowedHosts`, then `./jsuite restart`. Also add a card to
  `www/index.html` and update the `jsuite` skill's app table.
- **Skills are app-owned** in `<app>/.claude/skills`; the suite-level `jsuite`
  skill lives in `.claude/skills/` here at the root. `./jsuite setup` installs
  all of them globally from `SKILLS_MANIFEST` in `./jsuite` — new skill ⇒ new
  manifest entry (and keep `apps/jticket/j-setup` in sync for jticket-owned
  ones).
- **One git repo covers the whole workspace.** Apps no longer carry their own
  `.git`; commit everything (apps, packages, skills) from this root.
- **Don't restart apps blindly.** `./jsuite status` first; `./jsuite start` is
  idempotent for already-running apps but refuses ports held by processes it
  didn't start. Logs are at `logs/<app>.log` (`./jsuite logs <app>`).

## Layout

```
jsuite            # launcher: start/stop/status/logs/open/setup
                  # (setup also installs every jskill globally — SKILLS_MANIFEST)
Caddyfile         # edge config — one block per .local name
www/index.html    # static ecosystem index at https://jsuite.local
.claude/skills/   # suite-level skills (jsuite)
apps/             # jticket jdiff jchart jexplain jgrilling jrig
packages/         # @jsuite/charting + @jsuite/documents + @jsuite/diff (Nuxt layers: pages, components, server routes), @jsuite/data (.data resolver), @jsuite/claude (claude CLI runner)
.data/<app>/      # ALL app state, gitignored
```
