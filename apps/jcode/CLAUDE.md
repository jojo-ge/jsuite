# jCode

Hand-code the part that matters — as a standalone problem. A Claude BUILD
session (skill `jcode`) builds and ships a feature as usual, then poses its
core piece as a pure-function kata: a sandbox under `.data/jcode/sandbox/<key>/`
(stub, cases, types + the app's runner from `runners/`) plus the brief, a
hint ladder and its own answer. The human solves it in the sandbox; the
page's Mark-it button dispatches a MARKING session (skill `jcode-mark`) into
herdr, which runs the cases, judges against the reference, and posts a
verdict. Nothing ships from a kata. Legacy repo katas (no `sandbox`) still
work.
See README.md for the flow and API; the two skills are the playbooks.

Rules that matter here:

- **Disclosure is enforced on the server, not the page.** `kataView()` in
  `server/utils/kataStore.ts` is the only thing the browser and the `/watch`
  SSE ever receive: hints sliced to `hintsUnlocked`, `solution` null until
  `revealed`. Never add a route or a push that hands the page the raw record;
  `/api/katas/:key/full` is the marker's read and the page must never call it.
- **The kata file is the contract.** `.data/jcode/<key>.json` (via
  `@jsuite/data`) is the single source of truth: the build session writes it
  (POST), the marker writes verdicts (POST mark), the app writes attempts and
  rung unlocks. The `/watch` SSE mirrors the file — no state anywhere else.
- **The app owns the runner, the build session owns the files.** `runners/run.{ts,php,py}`
  are copied into every sandbox on publish and refreshed on every run — fix a runner
  here, never in a sandbox. Runner protocol lines are 0x1e-prefixed JSON with
  `jcode: true` (`case`, `summary`); the human's console output is tagged the same
  way without it (see the run console rule below).
- **The app runs no claude.** Marking is a dispatched herdr session; if herdr
  is down the attempt is still recorded with `marker.error` and the human runs
  `/jcode-mark <key>` by hand. Don't add a headless runner here.
- **A failed mark unlocks the next hint** (in `mark.post.ts`), and the human
  can unlock one on request (`hint.post.ts`) or reveal (`reveal.post.ts`,
  which opens every remaining hint). Reveal does not close the kata — Mark it
  still runs the tests and commits.
- Blocks are jspec blocks: materialise them with the shared
  `materialiseBlocks` (pseudo doc keys `<key>-brief`, `<key>-hint-<n>`,
  `<key>-answer`, `<key>-attempt-<n>`) so mermaid charts land in the jChart
  pool — don't store raw mermaid.
- Store/util names (`readKata`, `writeKata`, `kataView`, …) must stay
  distinct from the charting/documents auto-imports (`readChart`, `readDoc`,
  …) — all three layers share one Nitro auto-import namespace.
- The run console classifies output server-side (`run.get.ts`): the preload in
  `preload/jcode-console.mjs` tags `console.*` lines with a 0x1e sentinel; vitest and
  jest swap `console` in their workers, so their passthrough blocks are parsed by
  format instead. Add a runner there, not in the client.
- The room is a **wide** column (`max-w-5xl`): briefs and answers carry code
  and diffs at readable size.
