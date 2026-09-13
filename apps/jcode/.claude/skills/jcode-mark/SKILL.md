---
name: jcode-mark
description: Mark a jCode kata attempt — read the kata (reference answer included) off jCode's API, run the sandbox cases against the human's solution, judge it against the contract, and record a verdict that never gives the answer away. Invoked as `/jcode-mark <key> [attempt=n]`, normally by jCode's Mark-it button dispatching into herdr; also usable by hand.
---

# jcode-mark — mark the human's solution

A kata is the core piece of a feature Claude built, posed as a standalone
problem in a sandbox: `solution.<ext>` (the human's file), `cases.<ext>` (the
spec as data), the app's runner. The human has written it and pressed *Mark
it*. You are the marker: decide whether it passes, and if not tell them what
is wrong **without telling them the answer** — the page discloses hints one
rung at a time, and your verdict must respect that. Nothing here ships; the
repo already has Claude's version. This is practice, marked honestly.

Invocation: `/jcode-mark <key> [attempt=n]`. The herdr pane is already in
the sandbox directory; by hand, `cd` to `sandbox.dir` first.

## 1. Read the kata — the whole record

```sh
curl -sk https://jcode.local/api/katas/<key>/full > /tmp/kata.json
jq '{title, sandbox, target, revealed, hintsUnlocked, status,
     attempts: [.attempts[] | {id, n, status, submittedAt}]}' /tmp/kata.json
```

`/full` is the marker's read: `solution` (Claude's reference implementation
as blocks — the `code` block is the answer), every `hints` rung, and
`sandbox` (`dir`, `entry`, `fn`, `run`). The attempt to mark is the one
named by `attempt=n`, else the one with `status: "marking"`. If there is
none, say so and stop.

Study the reference and the contract (`brief`) before the human's code, so
you know what "correct" means here. Read `cases.*` too — it is the spec as
data.

## 2. Read the human's solution

Open `<sandbox.dir>/<sandbox.entry>`. `.attempts[n-1].code` is the file as
submitted; mark what is in the file *now* and say so if it differs.

If the stub is still there (the body still throws `jcode: …`), the verdict
is `failed`: "nothing to mark yet — the stub is still in place".

(Legacy repo katas — no `sandbox` — keep the old contract: the stub is in
the repo at `target.file`, run `tests.command` there, and a pass commits that
one file. Everything below applies the same way.)

## 3. Run the cases

```sh
cd <sandbox.dir> && <sandbox.run> 2>&1 | tail -n 80
```

The runner prints one line per case (✓/✗, and on a miss the expected vs
actual or the exception) and `N/M cases passed`. Keep the tail: it goes back
as `testOutput`. Don't edit the cases — if one looks wrong, say so in the
verdict and judge on the contract.

## 4. Decide

**Pass** when every case passes **and** the solution honours the contract in
`brief` — the invariants, purity, complexity it demanded. Judge behaviour,
not resemblance:

- A different shape from the reference is fine. A loop where the reference
  used arithmetic, a helper the reference inlined — fine.
- Style is not a criterion.
- All cases green with a real hole the cases didn't catch (mutates an input
  the brief said to leave alone, misses a behaviour the brief lists) —
  **fail**, and the hole is what your verdict names. You may write a
  one-off probe to demonstrate it (`tsx -e`, `php -r`, `python3 -c` in the
  sandbox) and quote its output.

**Fail** otherwise. Never half-pass.

## 5. Record the verdict

Post it and let the page do the rest — a failed mark unlocks the next hint
rung automatically:

```sh
curl -sk -X POST https://jcode.local/api/katas/<key>/attempts/<attemptId>/mark \
  -H 'content-type: application/json' -d @- <<'JSON'
{
  "result": "failed",
  "verdict": "Three of four cases pass. **A bucket that is already full still grows** — `never exceeds capacity` shows it: 8 tokens in a 10-capacity bucket, 5 s later it reads 58. Nothing in your function reads `capacity`. Look at the line where the earned tokens are added: what is the most `tokens` may legitimately be after it?",
  "feedback": [
    { "id": "f1", "type": "callout", "tone": "warning", "title": "Look at", "md": "The addition — the brief says a full bucket stays full, and nothing on or after that line enforces an upper bound." }
  ],
  "testOutput": "…tail of the run…"
}
JSON
```

`attemptId` is `.attempts[].id` (or just the number `n`). `feedback` is
optional jspec blocks; `verdict` is required markdown. A pass posts
`"result": "passed"` the same way — no commit (sandbox katas have nothing to
ship).

### Disclosure rules — the part that matters

- **`revealed: false`**: the verdict says *what is wrong and where to look*,
  not *what to write*. Name the failing case, the invariant broken, the
  line region. Quote the human's code freely. **Never quote the reference,
  never paraphrase it as steps, never write the fix.** One rung more
  specific than the hint about to unlock (`hints[hintsUnlocked]`) is the
  ceiling — read that rung and stay below it; the page shows it right after
  your verdict, so don't repeat it either.
- **`revealed: true`** (a code-along): compare directly. Cite the reference
  by line, say exactly where theirs diverges and why it matters.
- A pass gets a real verdict too: what they got right, one thing the
  reference did differently if it's instructive, and how the pure form maps
  back onto the method that shipped in the repo — that's the debrief.

Never edit the entry file. Never fix their code. The human hand-codes; you
mark.

Say in the terminal what you decided in one line — the page has the detail.
Then end your turn.
