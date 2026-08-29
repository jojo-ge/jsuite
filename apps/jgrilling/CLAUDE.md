# jGrilling

Browser grilling sessions, interviewed from OUTSIDE the app: an external
Claude session posts three-phase questions (the question, why it needs
answering, the options as tabbed cases — all jspec blocks) over the HTTP API
and monitors the session file for answers; this app renders the state live
(SSE over the file) and records answers in a sticky-bottom composer. See
README.md for the flow and API; the `j-grilling` skill is the interviewer's
playbook.

Rules that matter here:

- **This app never hosts a whole interview.** Grillings run in the terminal
  under the plain `grilling` skill — herdr-dispatched HITL tickets included; the
  human goes to the herdr pane to answer. A room is opened only when the
  operator escalates one question into the browser. Features here should serve
  *one deeply-argued question*, not a cheaper way to run a whole interview — if
  a change would make it tempting to route a grilling through the room, it's the
  wrong change.

- Session state is `.data/jgrilling/` via `@jsuite/data` — never hardcode paths.
- **The session file is the contract.** The interviewer's monitor watches
  `.data/jgrilling/<key>.json` for `turns[-1].answer`; the app must never
  buffer state elsewhere or delay the `writeGrill` after an answer. The app
  writes answers, the API writes questions/finish — no other writers.
- The app runs **no claude** — don't add a claude runner here. If a feature
  seems to need the app to think, it belongs in the interviewer's skill
  instead.
- Question bodies are blocks: materialise them with the shared
  `materialiseBlocks` (per-turn pseudo doc key `<sessionKey>-<turnId>`, and
  `<sessionKey>-<turnId>-<optionId>` for an option's case) so mermaid/charts
  land in the jChart pool — don't store raw mermaid on turns.
- **The three phases are the question format**, not a rendering choice:
  `question` / `why` / `options[]` on the turn, rendered by `GrillTurnCard`.
  Turns from before it (whole body in `blocks`, no options) still render —
  keep that fallback alive.
- The room is a **wide** column (`max-w-5xl`): questions carry tables, code
  and charts, and they must render at readable size. Prose inside it is capped
  at a `ch` measure instead — don't narrow the column to fix line length.
- Store/util names (`readGrill`, `writeGrill`, …) must stay distinct from the
  charting/documents auto-imports (`readChart`, `readDoc`, …) — all three
  layers share one Nitro auto-import namespace.
- Debriefs are published by the interviewer through `POST /api/documents`
  (shared documents utils) and linked via `finish` — the app never writes
  document JSON by hand.
