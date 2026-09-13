# jCode

Claude builds the feature. You hand-code the part that matters — as a problem.

A Claude session builds and ships a feature exactly as it normally would —
red → green tests, implementation, commit. Then it takes the feature's core
piece, the function where the central decision lives, expresses it as a pure
function (data in, data out), and poses it here as a **kata**: a standalone
coding problem with its own **sandbox** under `.data/jcode/sandbox/<key>/`
— the stub you fill in, the cases as data, the app's runner. You solve it in
the sandbox; nothing you write has to ship. The repo already has Claude's
version. The kata is practice, drawn from real work, marked honestly.

The kata is progressively disclosed, one rung at a time:

1. **Brief** — what to build (the contract, the cases it must handle, what is
   already there for it to use) and how to test it. Nothing about how.
2. **Hints** — a ladder of 2–3 nudges, each more specific. A failed attempt
   unlocks the next one; you can also ask for one.
3. **The answer** — Claude's own implementation with a walkthrough, when you
   choose to reveal it and code along.

Marking is a separate Claude session. *Mark it* on the page dispatches
`/jcode-mark <key>` into herdr, in the sandbox; it runs the cases against
your solution, judges it against the contract and the hidden reference, and
posts a verdict. Right: the kata closes. Wrong: it tells you what is wrong
and where to look — never the answer — and the next hint opens.

jCode runs no Claude of its own. Two sessions touch a kata, both interactive
in a terminal:

| Session | Skill | Does |
| --- | --- | --- |
| build | `jcode` | builds and ships the feature as usual, then authors the sandbox (stub, cases, types) and POSTs the kata (answer included), hands over |
| marker | `jcode-mark` | dispatched by *Mark it* (or run by hand) into the sandbox; reads `/full`, runs the cases, judges, POSTs the verdict |

## Where the answer lives

In the kata file, always: `.data/jcode/<key>.json` carries `solution` and
every hint rung from the moment the kata is published. What the **page** gets
is decided on the server (`kataView`): hints up to `hintsUnlocked`, `solution`
only once `revealed`. The marker reads `GET /api/katas/:key/full`, which the
page never calls. So Claude can always retrieve what it hid, and the page
cannot leak it.

## The sandbox

```
.data/jcode/sandbox/<key>/
  solution.ts    the stub — the one file you edit
  types.ts       the types the piece needs (optional)
  cases.ts       named inputs + expected outputs — the spec as data
  run.ts         the app's runner (copied fresh on every publish and run)
```

Languages: `ts`/`js` (run with the app's own `tsx`, so the sandbox needs no
`node_modules`), `php` (`php run.php`), `py` (`python3 run.py`). The runner
calls the exported function per case, deep-compares, prints ✓/✗ lines and a
protocol record per case + a summary that the page renders as a cases table
with each case's own console output attached.

The page: *Run cases* (the console, with My logs / Test output views and an
editable command for one-off probes), *Open in VS Code* (the sandbox on the
stub), *Mark it*. The attempt records the entry file as submitted.

Legacy **repo katas** (no `sandbox`) still work: the stub sits in the repo,
`tests.command` runs there, and a pass commits the one file.

## API

- `GET  /api/katas` — kata list (meta: status, stage, attempts)
- `POST /api/katas` — publish: `{ title, repoPath, feature, target: { file,
  symbol, signature?, lang? }, sandbox: { lang, files: { name → content }, fn? },
  tests?: { command, files? }, brief: Block[], hints?: Block[][],
  solution: Block[], branch?, ticket?, key? }` → `{ key, path, url, sandbox }`
  (no `sandbox` ⇒ legacy repo kata; then `tests.command` is required)
- `GET  /api/katas/:key/files` — the sandbox's authored files, live off disk
- `GET  /api/katas/:key` — the redacted view (what the page sees)
- `GET  /api/katas/:key/full` — the whole record, answer included (the marker's read)
- `GET  /api/katas/:key/watch` — SSE: the redacted view on every file change
- `DELETE /api/katas/:key`
- `POST /api/katas/:key/attempts` — Mark it: `{ dispatch?: boolean }` →
  `{ attempt, dispatched, error?, prompt? }` (409 while an attempt is being marked)
- `POST /api/katas/:key/attempts/:id/dispatch` — re-dispatch the marker for an
  attempt still waiting (the retry after herdr was unreachable)
- `POST /api/katas/:key/attempts/:id/mark` — the marker's verdict:
  `{ result: 'passed' | 'failed', verdict, feedback?: Block[], testOutput?, commit? }`
  (a fail unlocks the next hint; a pass closes the kata)
- `GET  /api/katas/:key/run?command=` — SSE: run `tests.command` (or the override) in the repo
  and stream it line by line, each classified `mine` (the human's `console.*`, tagged by the
  `preload/jcode-console.mjs` shim injected via `NODE_OPTIONS=--import`; vitest/jest passthrough
  blocks recognised by format) or `runner`; then an exit event. Closing the stream kills the run.
  The page's console panel filters My logs / Test output / Both
- `POST /api/katas/:key/open` — open the target file in VS Code (`code <repo> -g <file>:<line>`), cursor on the symbol
- `POST /api/katas/:key/hint` — unlock the next hint (409 when none left)
- `POST /api/katas/:key/reveal` — reveal the answer (opens every hint too)

Plus `/api/documents/**` and `/api/charts/**` from the `@jsuite/documents` /
`@jsuite/charting` layers this app extends — the brief/hints/answer are jspec
blocks, so a mermaid chart in a brief is a real jChart chart.

`JCODE_MARK_MODEL` pins the marking session's model (e.g. `claude-opus-5`);
unset, the claude default is used.
