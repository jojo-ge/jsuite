# jSuite

Six local Nuxt apps (jticket, jdiff, jchart, jexplain, jgrilling, jmap)
+ shared packages behind one Caddy edge; OrbStack resolves the `.local` names
and terminates HTTPS.
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
| grill/stress-test a plan | terminal | skill `grilling` — the default; one question escalates to `apps/jgrilling` only when the operator asks (skill `j-grilling`; API on :43005; state in `.data/jgrilling/`) |
| map a codebase — domains, dependency map, walkthrough docs | `apps/jmap` | skill `j-map` (front door); the work runs as a jMap-mode jTicket project (herdr-dispatched `/jmap-scope`, `/jmap-domain`, `/jmap-synthesize` tickets); jMap API on :43007 renders the posted graph; state in `.data/jmap/` |
| improve/deepen a codebase's architecture | `apps/jticket` | the Improve-architecture button on the projects page (or `POST /api/projects/architect`) makes an architect-mode project whose scan (`/jarchitect-scan`) fills the board with graded HITL candidates + an assessment spec; a candidate's herdr button dispatches its go/no-go grilling (`/jarchitect-grill`, answered in that herdr pane) and finishes the ticket |
| reproduce suspected bugs before a deploy | `apps/jticket` | a predeploy-mode project — one suspected bug per ticket; the herdr button dispatches `/jreproduce`, which reproduces it in a throwaway worktree as a failing test, records the test + verdict (reproduced / flaky / not-reproduced / already-fixed / invalid) on the ticket, and never fixes it |
| charts embedded in articles | shared pool | `packages/charting` serves `/api/charts` over `.data/jchart/` in every consumer — jExplain charts ARE jChart charts |
| block documents (docs, specs, explainers) | shared pool | `packages/documents` serves `/api/documents` over `.data/jexplain/` in jTicket, jExplain AND jGrilling — a jTicket doc IS a jExplain document |
| dispatching terminal claude sessions into herdr | shared pool | `packages/herdr` (`ensureHerdrWorkspace`, `acquirePackedPane`, `startClaudeIn`) — jTicket, jMap and jDiff all dispatch through it (jDiff's review sessions run the `jdiff-review`/`jdiff-ask` skills on Opus 5); jTicket's Run-review buttons proxy to jDiff's dispatch with ticket/project context, and the review session reports findings back into jTicket (fix tickets / ticket comments) |
| sync/share a jTicket project with a coworker's machine | `apps/jticket` | the project page's Share panel — pull-only snapshot sync over Supabase Realtime Broadcast (frames sealed end-to-end with the share's room secret), 2-hour capability links, every pull approved in the serving side's UI; peer-owned entities are read-only and never dispatchable. One-time setup: `packages/relay/wizard.sh` (creates/wires a free Supabase project); both machines wire the same project into `.data/jticket/sync.json` (`JTICKET_SUPABASE_URL`/`_KEY` override). See README "@jsuite/relay" |

When a request spans apps (e.g. "spec this, then diagram it"), do each part with
that app's own skill rather than improvising one app's job in another.

## Rules of the suite

- **State lives in `.data/<app>/` at this root, never inside an app.** Use
  `@jsuite/data` (`appDataDir`/`appDataFile`) to resolve paths. jTicket's state
  is API-only — go through :43000, don't hand-edit `.data/jticket/jticket.json`.
- **URLs always carry the scheme**: `https://<app>.local`. Bare host ports
  (43000–43007) work too but the `.local` names are what tooling hardcodes.
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
apps/             # jticket jdiff jchart jexplain jgrilling jmap
packages/         # @jsuite/charting + @jsuite/documents (Nuxt layers), @jsuite/data (.data resolver), @jsuite/herdr (herdr dispatch adapter), @jsuite/relay (sync setup wizard + local broadcast relay)
.data/<app>/      # ALL app state, gitignored
```
