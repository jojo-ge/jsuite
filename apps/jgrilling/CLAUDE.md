# jGrilling

Browser grilling sessions, interviewed from OUTSIDE the app: an external
Claude session (usually herdr, working a HITL jTicket) posts jspec-format
questions over the HTTP API and monitors the session file for answers; this
app renders the state live (SSE over the file) and records answers in a
sticky-bottom composer. See README.md for the flow and API; the `j-grilling`
skill is the interviewer's playbook.

Rules that matter here:

- Session state is `.data/jgrilling/` via `@jsuite/data` — never hardcode paths.
- **The session file is the contract.** The interviewer's monitor watches
  `.data/jgrilling/<key>.json` for `turns[-1].answer`; the app must never
  buffer state elsewhere or delay the `writeGrill` after an answer. The app
  writes answers, the API writes questions/finish — no other writers.
- The app runs **no claude** — don't reintroduce `@jsuite/claude` here. If a
  feature seems to need the app to think, it belongs in the interviewer's
  skill instead.
- Question bodies are blocks: materialise them with the shared
  `materialiseBlocks` (per-turn pseudo doc key `<sessionKey>-<turnId>`) so
  mermaid/charts land in the jChart pool — don't store raw mermaid on turns.
- Store/util names (`readGrill`, `writeGrill`, …) must stay distinct from the
  charting/documents auto-imports (`readChart`, `readDoc`, …) — all three
  layers share one Nitro auto-import namespace.
- Debriefs are published by the interviewer through `POST /api/documents`
  (shared documents utils) and linked via `finish` — the app never writes
  document JSON by hand.
