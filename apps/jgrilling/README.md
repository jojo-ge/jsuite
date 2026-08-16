# jGrilling

Get grilled about a plan before you build it — in the browser.

jGrilling runs Matt Pocock's *grilling* interview (relentless one-question-at-a-
time interrogation of a plan, each question with a recommended answer) with the
question side played by **your local Claude subscription**: the server drives
the `claude` CLI headlessly via `@jsuite/claude`, exactly the way jDiff runs its
review tools. You answer each question in a proper UI instead of a terminal.

## Flow

1. **Start a session** — paste a plan (markdown), optionally point at the repo
   it concerns. With a repo attached, claude gets read-only file tools + git
   (`ANALYSIS_TOOLS`) and looks *facts* up itself; only *decisions* come to you.
2. **Get grilled** — claude asks the single most important unresolved question,
   with its recommendation. Accept the recommendation in one click or write
   your own answer. Progress streams live (thinking + tool log) over SSE.
3. **The debrief** — when claude declares shared understanding (or you hit
   *Wrap up*), it writes a debrief as a **shared block document** (the
   jExplain format): decision table, callouts for risks, takeaways, and a
   mermaid-seeded **jChart chart** of the decision tree. It renders in-app at
   `/e/<key>`, in jExplain, and the chart opens in jChart — same pools.

## State

Sessions live in `<jSuite root>/.data/jgrilling/<key>.json` (`format:
"j-grilling"`), one file per session, readable straight off disk. Debrief
documents land in the shared documents pool (`.data/jexplain/`), their charts in
the shared chart pool (`.data/jchart/`).

## API

- `GET  /api/sessions` — session list (meta)
- `POST /api/sessions` — `{ plan, title?, repoPath?, key? }` → `{ key, path }`
- `GET  /api/sessions/:key` — full session
- `DELETE /api/sessions/:key` — delete the session (debrief doc stays)
- `POST /api/sessions/:key/answer` — `{ answer }` → updated session
- `GET  /api/sessions/:key/next` — SSE: next question (`question` event) or the
  debrief (`done` event); `?wrapup=1` forces the debrief. Closing the
  EventSource kills the claude run.

Plus `/api/documents/**` and `/api/charts/**` from the `@jsuite/documents` /
`@jsuite/charting` layers this app extends.

Those layers also put the whole shared pool on screen here, at `/documents`.
jGrilling mounts that library itself to give it this app's framing and point it
at its own `/e/<key>` reader (which `/documents/<key>` redirects to), so there
is one reader here rather than two. Deleting out of the pool it does not offer
anywhere: a debrief is deleted from jExplain, not from here. Since TICK-178 the
layer withholds delete by default, so that line now holds even on a surface
nobody here configured; the explicit `:deletable="false"` stays as a statement
of it. Deleting a *session* is jGrilling's to offer — the debrief it wrote
outlives it.

The `j-grilling` skill (in `.claude/skills/`) lets a Claude Code session push
the plan it's discussing into a session and hand you the URL.
