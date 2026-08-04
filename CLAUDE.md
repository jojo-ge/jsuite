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
| tickets, epics, breakdowns, boards, specs, draft docs | `apps/jticket` | HTTP API on :43000 — skills `to-jticket`, `to-jspec`, `to-jdoc`, `jwayfinder`, `jimplement` |
| PR review, branch diff, review comments | `apps/jdiff` | `jdiff` CLI (`jdiff pr N`, `jdiff branch B`, `--print`) |
| diagrams the human edits/annotates | `apps/jchart` | skill `j-chart`; API on :43003; state in `.data/jchart/` |
| explainers, walkthroughs, post-mortems, articles | `apps/jexplain` | skill `j-explain` (`explain.py` publish script) |
| grill/stress-test a plan with the human answering in a UI | `apps/jgrilling` | skill `j-grilling`; API on :43005; state in `.data/jgrilling/` |
| avatar characters — draw, rig, keyframe 2D avatars | `apps/jrig` | studio at https://jrig.local; character/clip JSON in `.data/jrig/` (documents API on :43006); see `apps/jrig/docs/PLAN.md` |
| charts embedded in articles | shared pool | `packages/charting` serves `/api/charts` over `.data/jchart/` in every consumer — jExplain charts ARE jChart charts |
| block documents (docs, specs, explainers) | shared pool | `packages/documents` serves `/api/documents` over `.data/jexplain/` in jTicket, jExplain AND jGrilling — a jTicket doc IS a jExplain document |
| running the local `claude` CLI from an app server | shared pool | `packages/claude` (`runClaude`, `extractJson`, `ANALYSIS_TOOLS`) — jDiff and jGrilling both drive claude through it |

When a request spans apps (e.g. "spec this, then diagram it"), do each part with
that app's own skill rather than improvising one app's job in another.

## Rules of the suite

- **State lives in `.data/<app>/` at this root, never inside an app.** Use
  `@jsuite/data` (`appDataDir`/`appDataFile`) to resolve paths. Every app stores
  one JSON file per entity, so reading state straight off disk is fine and cheap
  — jTicket is `.data/jticket/{projects,epics,tickets,docs}/<KEY>.json` plus
  `counters.json`. **Write through the API** (:43000) anyway: it allocates keys,
  maintains counters, and resolves cross-entity refs.
- **File names are addresses; `id` is identity.** A file is named for its
  display key (`tickets/TICK-5.json`, `.data/jexplain/<slug>.json`) because that
  makes the tree browsable, but keys are derived from titles and unique only
  within one machine's pool. Anything that has to survive a rename or reconcile
  two pools — publish, sync, import — must match on the `id` inside the file.
  Documents carry `doc_…`, charts `cht_…`, and jTicket doc records carry
  `documentId` alongside `documentKey`. Ids are minted randomly and **never
  derived from the key or title** — deriving them would give two independently
  authored "Q3 Planning" documents the same id and silently merge them.
- **Never write into `.data` with a plain `writeFile`.** Use
  `writeJsonAtomic`/`writeTextAtomic` from `@jsuite/data` (or jTicket's own
  `writeFileAtomic`), which write to a sibling `.tmp` and rename over the
  target. Two charts here were found holding a complete document followed by
  344 bytes of tail from a longer previous version — that is what an in-place
  write does when it loses a race.
- **`.data` is its own git repo**, committed on every write by
  `@jsuite/data/history` (`snapshotData`). That's what gives local state undo, a
  publish diff, and the *base version* a three-way merge needs. It's separate
  from the workspace repo, which gitignores `.data`. Use `./jsuite history`
  (`log`, `diff`, `show`, `restore <rev> <path>`); apps re-read from disk each
  request, so a restore needs no restart. Best-effort by design — a failed
  commit never fails the write. `JSUITE_HISTORY=0` disables it.
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
packages/         # @jsuite/charting + @jsuite/documents (Nuxt layers), @jsuite/data (.data resolver), @jsuite/claude (claude CLI runner)
.data/<app>/      # ALL app state, gitignored
```
