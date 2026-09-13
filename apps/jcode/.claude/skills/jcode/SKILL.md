---
name: jcode
description: Build a feature the jCode way — build and ship it test-first as usual, then pose its core piece as a standalone coding problem in jCode (a sandbox with a stub, cases and a runner; brief → hints → answer, disclosed one rung at a time) for the human to hand-code. Use when the user says "with jcode", "/jcode", "jcode this", "pose the core as a problem", or wants coding problems drawn from the features Claude builds.
---

# jcode — ship the feature, pose the heart of it as a problem

jCode (`https://jcode.local`, API on `:43006`) is where the human hand-codes
the part of a feature that is worth learning — **as a standalone problem, not
in the repo**. You build and commit the feature exactly as you normally
would. Then you take its core piece, express it as a pure function, and
publish a **kata**: a sandbox under `.data/jcode/sandbox/<key>/` holding the
stub, the cases and the app's runner, plus the brief (what to build, never
how), a ladder of hints, and your own answer. The page shows the human only
the rung they have reached; a marking session (`jcode-mark`) checks their
sandbox solution and posts a verdict. Nothing they write ships — the repo
already has your implementation. The kata is practice drawn from real work.

Two rules above all:

- **The answer never appears in the terminal.** It goes in the kata's
  `solution` field and nowhere else. Not in your summary, not in a comment
  in the stub. The human builds it before seeing it.
- **Exactly one piece per feature, and it is the core**: the function where
  the feature's central decision lives. Tests, glue, types, validation,
  wiring — those are yours, and they ship.

## 1. Build and ship the feature, all of it

Run the `tdd` skill's loop: agree the seams with the user, red → green in
vertical slices, until the feature is done, every test green, and
**committed** (or on its ticket branch, whatever the session's normal flow
is — `/jimplement`'s if you are working a jTicket). The repo is untouched by
the kata from here on.

## 2. Pick the piece

One function or method. Choose the one where a colleague who understood
*only that code* would understand the feature:

| Pick | Don't pick |
| --- | --- |
| the algorithm, the reducer, the state transition, the matcher, the scheduling / pricing / merging rule | tests, fixtures, types, validation, DTO mapping |
| a real signature with real decisions inside — 10 to 60 lines | wiring, handlers that just delegate, config |
| expressible as **data in, data out** — a pure function of its inputs | anything that must await I/O, touch a database, or read a clock it can't be handed |

If the piece is a method on stateful object, **express it as a pure
function** for the problem: `refill(bucket: BucketState, now: number):
BucketState` instead of `TokenBucket.refill(now)`. Inline the types it needs.
This is the problem's form only — the repo keeps the method.

If the feature has no such piece (it's all plumbing) say so and skip the
kata. A problem that isn't worth hand-coding is worse than none.

## 3. Author the sandbox

Three small files, in the kata's language (`ts`, `js`, `php` or `py`). The
app adds the runner (`run.ts` / `run.php` / `run.py`) itself — don't write one.

**`solution.<ext>`** — the stub the human fills in. Signature, types,
doc comment; the body throws:

```ts
import type { BucketState } from './types.ts'

/** Top the bucket up for the time elapsed since its last refill. */
export function refill(bucket: BucketState, now: number): BucketState {
  throw new Error('jcode: refill — build it: https://jcode.local/k/rate-limiter-refill')
}
```

**`types.<ext>`** (optional) — the types the piece needs, copied from the
repo and trimmed to what the problem uses.

**`cases.<ext>`** — the spec as data. Concrete, named, one per behaviour the
brief lists. The runner calls `fn(...args)` and deep-compares `expected`:

```ts
import type { BucketState } from './types.ts'

export const fn = 'refill'
const at = (tokens: number, lastRefill: number, capacity = 10, ratePerSec = 10): BucketState =>
  ({ tokens, lastRefill, capacity, ratePerSec })

export const cases = [
  { name: 'earns tokens at ratePerSec', args: [at(0, 1000, 100), 2500], expected: at(15, 2500, 100) },
  { name: 'never exceeds capacity',     args: [at(8, 0), 5000],          expected: at(10, 5000) },
  { name: 'a clock going backwards is a no-op', args: [at(3, 5000), 4000], expected: at(3, 5000) },
  { name: 'does not mutate its input', call: (fn) => { const b = at(0, 0); fn(b, 1000); return b.tokens }, expected: 0 },
]
```

Per case: `name`; `args` (positional) **or** `call(fn)` when you need to set
something up or observe a side effect; `expected` (deep-equal) **or**
`check(actual)` returning `true` / a failure string. PHP: `cases.php`
returns `['fn' => 'refill', 'cases' => [['name' => …, 'args' => […],
'expected' => …], …]]`. Python: `cases.py` defines `FN = 'refill'` and
`CASES = [dict(name=…, args=[…], expected=…), …]`.

The cases ARE the test suite for this problem — cover every line of the
brief, and include the case that catches the tempting wrong answer.

## 4. Author the brief, the hints, the answer

Blocks use the jspec/block vocabulary from the `j-explain` skill (`prose`,
`callout`, `code`, `diff`, `steps`, `compare`, `takeaway`, `chart` with
`mermaid`). Three parts, each a rung:

**`brief`** — what to build, never how. In order:
- `prose`: what this function is responsible for, in the feature's terms —
  and one line on where it lives in the shipped feature (`target.file`).
- `code`: the contract — the stub's signature with its doc comment.
- `steps` or `compare`: the behaviours it must have. Concrete: "a bucket at
  capacity stays at capacity", not "handle the edge cases". These mirror the
  cases.
- `callout` (`aside`): the vocabulary — the types, what each field means.
- A `chart` (`mermaid`) when a picture explains the contract better.

Do NOT include the approach, the data structure, the loop shape, any line of
the answer. If a sentence would save the human a decision, it is a hint.

**`hints`** — 2–3 block arrays, each rung more specific than the last. A
failed attempt unlocks the next one, and the human can ask for one:
1. the approach — the invariant to maintain, the order of operations;
2. the steps — pseudocode-level, still no real code;
3. (optional) the tricky edge, with a fragment for *that edge only*.

**`solution`** — your implementation **of the sandbox stub** (the pure
form), verbatim, as a `code` block with `annotations` on the lines that
carry a decision, then a short `prose` walkthrough: why it is shaped like
this, what the alternatives cost, and how it maps onto the method that
shipped.

Plus: `feature` (markdown — what the feature is, what you built and where;
folded above the brief), `target` (`file`, `symbol` in the repo — the
shipped version, for reference; `signature` is the sandbox stub's),
`repoPath`.

## 5. Publish and hand over

```sh
curl -sk -X POST https://jcode.local/api/katas \
  -H 'content-type: application/json' -d @- <<'JSON'
{
  "key": "rate-limiter-refill",
  "title": "Rate limiter — the refill rule",
  "repoPath": "/absolute/path/to/repo",
  "branch": "feat/rate-limiter",
  "ticket": "PROJ-12",
  "feature": "A token-bucket rate limiter for the API layer …\n\nShipped: `TokenBucket` (src/rate/bucket.ts) with `take()` and `refill()`, the `rateLimit()` middleware, 9 tests in src/rate/bucket.test.ts. This problem is `refill()` as a pure function over `BucketState`.",
  "target": { "file": "src/rate/bucket.ts", "symbol": "TokenBucket.refill", "signature": "refill(bucket: BucketState, now: number): BucketState", "lang": "ts" },
  "sandbox": {
    "lang": "ts",
    "fn": "refill",
    "files": {
      "types.ts": "export interface BucketState { tokens: number; capacity: number; ratePerSec: number; lastRefill: number }\n",
      "solution.ts": "import type { BucketState } from './types.ts'\n\n/** Top the bucket up for the time elapsed since its last refill. */\nexport function refill(bucket: BucketState, now: number): BucketState {\n  throw new Error('jcode: refill — build it: https://jcode.local/k/rate-limiter-refill')\n}\n",
      "cases.ts": "…as above…"
    }
  },
  "brief": [ … ],
  "hints": [ [ … ], [ … ] ],
  "solution": [
    { "id": "code", "type": "code", "lang": "ts", "file": "solution.ts",
      "code": "export function refill(bucket: BucketState, now: number): BucketState {\n  if (now <= bucket.lastRefill) return bucket\n  const earned = ((now - bucket.lastRefill) / 1000) * bucket.ratePerSec\n  return { ...bucket, tokens: Math.min(bucket.capacity, bucket.tokens + earned), lastRefill: now }\n}",
      "annotations": [ { "line": 2, "md": "A clock going backwards must not drain or grow the bucket." }, { "line": 4, "md": "Clamp after adding — a nearly full bucket can't overshoot. In the shipped class this is `this.tokens = Math.min(…)`." } ] },
    { "id": "why", "type": "prose", "md": "Elapsed-time refill costs nothing while idle …" }
  ]
}
JSON
# -> { "key": "rate-limiter-refill", "url": "https://jcode.local/k/rate-limiter-refill",
#      "sandbox": { "dir": "…/.data/jcode/sandbox/rate-limiter-refill", "entry": "solution.ts", "run": "… run.ts" } }
```

Sanity-check the sandbox before handing over — run the cases once against
the stub and once against your answer:

```sh
cd <sandbox.dir> && <sandbox.run>            # every case ✗ "not implemented yet"
# temporarily paste your answer into solution.ts, run again: every case ✓, then put the stub back
```

If the POST fails the app is probably down: `cd ~/code/anyway/jsuite &&
./jsuite status`, then `./jsuite start`. `key` is optional (a slug of the
title otherwise) — pass it so the stub's URL matches.

Then tell the user, in the terminal, only this: what shipped, which piece is
their problem (function, language, how many cases), and the kata URL.
**Then stop and end your turn.** They solve it in the sandbox (Open in VS
Code on the page), run the cases from the page, and press *Mark it*. Do not
wait, do not poll the kata file, do not mark it yourself unless asked (then
`/jcode-mark <key>`).

Working a jTicket: post the kata URL as a comment on the ticket; the ticket's
own resolution is unaffected — the feature shipped in step 1.

## Reading a kata back

`GET https://jcode.local/api/katas/<key>/full` returns everything you posted,
attempts and verdicts included — the answer never leaves the file, so it is
always retrievable. `GET …/api/katas/<key>` is the redacted view the page
uses. Katas are on disk at `~/code/anyway/jsuite/.data/jcode/<key>.json`,
sandboxes at `~/code/anyway/jsuite/.data/jcode/sandbox/<key>/`.
