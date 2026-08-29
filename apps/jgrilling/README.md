# jGrilling

One grilling question, taken out of the terminal and into the browser.

jGrilling is a **passive question room** for Matt Pocock's *grilling* interview.
The interviewer is an **external Claude session** driving the API via the
`j-grilling` skill; the app renders whatever session state exists and records
the user's answers, and runs no claude of its own.

**It is not where a grilling lives.** Every grilling runs in the terminal under
the plain `grilling` skill — cheap, fast, typed answers. A jGrilling question
costs three markdown phases plus a block-document case per option, so it's worth
paying only for a **single decision the operator wants to go deep on**.

One thing opens a room, and nothing else: **the operator asks**. Mid-grilling
they say *"take that one to jgrilling"*; the interviewer posts **that one
question**, monitors the session file for the answer, and goes back to grilling
in the terminal. Later escalations reuse the same room, so it always shows
exactly one open question.

That holds for herdr-dispatched HITL jTickets too — `wayfinder:grilling`
tickets, todo grillings, `/jarchitect-grill`. They grill in the herdr pane and
the human goes there to answer; the room is still one question at a time, on
request.

## Up next — grilling tickets from jTicket

The index page lists every **HITL grilling ticket** on jTicket's frontier
(`type: HITL` + label `wayfinder:grilling`, open/unblocked/unclaimed), grouped
by project in the same format as jTicket's own /next page. **Start** dispatches
the ticket into herdr through jTicket's dispatch endpoint (own tab, no focus
steal) — a launcher, not a redirect: the interview runs in that herdr pane and
you answer there. A session only appears in the list below if you ask that
session to escalate a question here.

## Flow

1. **The interviewer opens a session** — `POST /api/sessions` with the plan /
   context under interrogation (including what the terminal grilling already
   settled), then hands the user the room URL. Once per grilling, lazily, on the
   first escalation the operator asks for.
2. **It posts the question** — `POST /api/sessions/:key/questions`,
   laid out in **three phases**:

   1. **the question** (`question`, markdown),
   2. **why it needs answering** (`why`, markdown) — what hangs off it,
   3. **the options** (`options[]`) — the candidate answers as **tabs**, each
      tab arguing its own case in **jspec-format blocks** (the shared
      block-document vocabulary: prose, callouts, compare tables, code, mermaid
      charts — charts materialise into the shared jChart pool). One option is
      `recommended`; `blocks` on the turn itself is shared context under the
      question.

   The UI picks it up live over the `/watch` SSE: a wide reading column so
   tables, diffs and charts render at full size, answered turns collapsed to
   question + answer, and the answer box **sticky at the bottom**. Take an
   option in one click (the room records *which* one as `answeredOptionId`) or
   write your own answer.
3. **It monitors for the answer** — the answer lands in
   `.data/jgrilling/<key>.json` and the interviewer's file monitor fires. It
   reads the answer back in the terminal and keeps grilling there, until the
   operator escalates another question. The room never takes over the interview.
4. **The debrief** — when the grilling ends, the interviewer closes the session
   with a verdict, optionally publishing a debrief as a **shared block
   document** (decision table, risk callouts, a jChart decision-tree chart). It
   renders in-app at `/e/<key>`, in jExplain, and the chart opens in jChart —
   same pools.

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
- `POST /api/sessions/:key/questions` — `{ topic?, question, why?, blocks?,
  options?, recommendation? }` → the new turn; 409 while a question is open.
  Each option is `{ label, summary?, recommended?, answer?, blocks | md }`;
  `recommendation` defaults to the recommended option's `answer`
- `POST /api/sessions/:key/answer` — `{ answer, optionId? }` → updated session
  (the UI's side)
- `POST /api/sessions/:key/finish` — `{ verdict?, documentKey? }` → session
  closed
- `GET  /api/upnext` — jTicket's HITL grilling frontier, grouped by project
  (`available: false` when jTicket is down)
- `POST /api/upnext/:id/start` — dispatch that ticket into herdr via jTicket
  (`/jwayfinder` or `/jimplement` per project mode, the interview run with
  `/grilling` in that pane, own tab)

Plus `/api/documents/**` and `/api/charts/**` from the `@jsuite/documents` /
`@jsuite/charting` layers this app extends.

The `j-grilling` skill (in `.claude/skills/`) is the interviewer's playbook:
the interview algorithm, the question format, and the monitor loop.
