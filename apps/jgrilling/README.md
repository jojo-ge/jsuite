# jGrilling

Get grilled about a plan before you build it — in the browser.

jGrilling is a **passive question room** for Matt Pocock's *grilling* interview
(relentless one-question-at-a-time interrogation of a plan, each question with
a recommended answer). The interviewer is an **external Claude session** —
usually a herdr session working a HITL jTicket, or any Claude Code session the
user asked for a browser grilling — driving the API via the `j-grilling`
skill. The app renders whatever session state exists and records the user's
answers; it runs no claude of its own.

## Up next — grilling tickets from jTicket

The index page lists every **HITL grilling ticket** on jTicket's frontier
(`type: HITL` + label `wayfinder:grilling`, open/unblocked/unclaimed), grouped
by project in the same format as jTicket's own /next page. **Start** dispatches
the ticket into herdr through jTicket's dispatch endpoint (own tab, no focus
steal) with a prompt that routes the interview back through this app; the
session appears in the list below once the interviewer posts its first
question.

## Flow

1. **The interviewer opens a session** — `POST /api/sessions` with the plan /
   context under interrogation, then hands the user the room URL.
2. **It posts one question at a time** — `POST /api/sessions/:key/questions`
   with the question body as **jspec-format blocks** (the shared block-document
   vocabulary: prose, callouts, compare tables, code, mermaid charts — charts
   materialise into the shared jChart pool). The UI picks it up live over the
   `/watch` SSE: scrollable transcript, the answer box **sticky at the
   bottom**. Accept the recommendation in one click or write your own answer.
3. **It monitors for the answer** — the answer lands in
   `.data/jgrilling/<key>.json`; the interviewer's file monitor fires and it
   moves on to the next question.
4. **The debrief** — when shared understanding is reached, the interviewer
   publishes a debrief as a **shared block document** (decision table, risk
   callouts, a jChart decision-tree chart) and closes the session with a
   verdict. It renders in-app at `/e/<key>`, in jExplain, and the chart opens
   in jChart — same pools.

## State

Sessions live in `<jSuite root>/.data/jgrilling/<key>.json` (`format:
"j-grilling"`), one file per session, readable straight off disk — that file
is the single source of truth, written by the app (answers) and read by the
interviewer's monitor. Debrief documents land in the shared documents pool
(`.data/jexplain/`), their charts in the shared chart pool (`.data/jchart/`).

## API

- `GET  /api/sessions` — session list (meta)
- `POST /api/sessions` — `{ title?, plan?, repoPath?, key? }` → `{ key, path }`
- `GET  /api/sessions/:key` — full session
- `GET  /api/sessions/:key/watch` — SSE: the full session, pushed on every
  file change (how the UI sees new questions instantly)
- `DELETE /api/sessions/:key` — delete the session (debrief doc stays)
- `POST /api/sessions/:key/questions` — `{ topic?, blocks, recommendation,
  why? }` → the new turn; 409 while a question is open
- `POST /api/sessions/:key/answer` — `{ answer }` → updated session (the UI's
  side)
- `POST /api/sessions/:key/finish` — `{ verdict?, documentKey? }` → session
  closed
- `GET  /api/upnext` — jTicket's HITL grilling frontier, grouped by project
  (`available: false` when jTicket is down)
- `POST /api/upnext/:id/start` — dispatch that ticket into herdr via jTicket
  (`/jwayfinder` or `/jimplement` per project mode, grilling routed through
  `/j-grilling`, own tab)

Plus `/api/documents/**` and `/api/charts/**` from the `@jsuite/documents` /
`@jsuite/charting` layers this app extends.

The `j-grilling` skill (in `.claude/skills/`) is the interviewer's playbook:
the interview algorithm, the question format, and the monitor loop.
