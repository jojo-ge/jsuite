# jGrilling

Browser grilling sessions: the server runs the user's local `claude` CLI (via
`@jsuite/claude`) to interrogate them about a plan one question at a time;
answers are given in the UI; the wrap-up is a shared block document + chart.
See README.md for the flow and API.

Rules that matter here:

- Session state is `.data/jgrilling/` via `@jsuite/data` — never hardcode paths.
- The interview is **stateless per turn**: every `/next` run rebuilds the full
  prompt from the session file (plan + transcript). Don't introduce hidden
  claude-side session state.
- Store/util names (`readGrill`, `writeGrill`, …) must stay distinct from the
  charting/documents auto-imports (`readChart`, `readDoc`, …) — all three
  layers share one Nitro auto-import namespace.
- Debriefs go through the shared documents utils (`writeDoc`,
  `materialiseBlocks`) so charts land in the jChart pool — don't write document
  JSON by hand.
