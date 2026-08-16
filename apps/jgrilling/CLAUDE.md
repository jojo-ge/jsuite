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
- **jGrilling never destroys anything out of a shared pool** — not a document
  (TICK-154), not a chart (TICK-179). Deleting a *session* is fine
  (`DELETE /api/sessions/:key`, the debrief stays); ending the debrief is
  jExplain's call, and ending a chart is jChart's. Every pool surface here holds
  that line: `/e/<key>` and `/documents` pass `:deletable="false"`,
  `/documents/<key>` redirects to `/e/<key>` so there is only one reader to keep
  honest, and `/charts` + `/charts/<key>` pass `:deletable="false"` too. A new
  page mounting `<DocumentLibrary>`/`<DocumentReader>`/`<ChartLibrary>`/
  `<ChartWorkbench>` must pass it as well: both layers still default to `true`.
