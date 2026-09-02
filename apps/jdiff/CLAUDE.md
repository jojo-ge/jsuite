# jDiff

A local GitHub client that's really good at diffs. Nuxt 4 app; `gh` lists PRs, local `git` computes and highlights diffs. See README.md for architecture.

## Review guidance runs in herdr — jDiff runs NO claude

The AI tools (reviewability rating, risk heatmap, guided tour, ask-yourself,
findings, per-line asks) are produced by a claude session dispatched into
herdr via `@jsuite/herdr` (`server/utils/herdrReview.ts`), pinned to Opus 5.
The dispatched session runs the globally-installed `jdiff-review` /
`jdiff-ask` / `jdiff-tour` / `jdiff-chains` / `jdiff-hunt` skills (owned here
in `.claude/skills/`, installed by
`./jsuite setup`) and POSTs artifacts back to `/api/review-artifact`,
`/api/ask-result`, and `/api/review-complete`; the UI polls the
saved-artifact endpoints. Don't reintroduce an in-process claude runner — a
new guidance tool means a new artifact shape in the skill + a validator in
`server/utils/aiArtifacts.ts`, not an app-side claude run. The prompts live
in the skills, nowhere else; keep `jdiff-ask`'s question table in sync with
`app/utils/askQuestions.ts`.

Tours come in four variants: the analyze run's `overview` tour, an on-demand
`detail` tour (`/api/tour-dispatch mode=detail` → the `jdiff-tour` skill), and
the two FAN-OUT modes — a scoping session posts a manifest, and the server
auto-dispatches one walker session per manifest entry
(`server/utils/walkerFanout.ts`, unfocused, 4-up packed panes):

| mode | scope session | manifest | walkers | tour variant |
| --- | --- | --- | --- | --- |
| `chains` | `jdiff-chains stage=scope` | `tool: chains` → `chainsStore` | one per chain | `chain:<slug>` |
| `hunt` | `jdiff-hunt stage=scope` | `tool: hunt` → `huntStore` | one per **HIGH** issue | `issue:<slug>` |

The hunt is the bug-and-vulnerability mode: its manifest lists every defect
found at every severity (an empty list is a valid, clean result), and only the
high-severity ones earn a walkthrough that explains the defect in depth —
`walkableIssues` is the single place that rule lives, on both the fan-out and
the variant-validation side. Chain and issue tours may stop on unchanged code;
the UI renders untouched files via `ContextFile.vue`, and the tour export reads
those stops straight off the file (`showFile`) since no hunk covers them. Any
variant exports as a standalone shareable page through `/api/tour-export` +
`server/utils/tourExport.ts` — the diff it quotes comes from the same
`diffFilesFor` cache `/api/diff` renders, so an exported hunk matches what was
on screen. Dispatches are tracked per (repo, target, job) in
`server/utils/herdrReview.ts` — jobs: `analyze`, `detail`, `chains-scope`,
`chain:<slug>`, `hunt-scope`, `issue:<slug>`.

Two same-named validators would collide in Nitro's auto-import, so they don't
share names: `aiArtifacts.parseTourVariant` checks a POSTed variant against the
target's saved manifests, `tourStore.parseVariantParam` only checks a `?variant=`
against the grammar.

jTicket triggers reviews too: its Run-review buttons proxy to
`POST /api/analyze-dispatch` with `ticket=`/`project=` context and
`focus: false`. This server stays ticket-agnostic — it only relays the two
validated keys into the prompt; it is the dispatched `jdiff-review` session
that reports findings back to jTicket (fix tickets for an integration-branch
review, a ticket comment for a single ticket's branch).

## Branch scopes — the review tools are committed-only

A branch target carries a `?scope=`: `committed` (default, `base...branch`),
`staged`, `unstaged`, or `everything` (merge-base → working tree).
`server/utils/target.ts` turns it into `diffArgs` + per-side `git show` specs;
`server/utils/scopedGit.ts` is the only place that runs `git diff`/`git show`
for a target, and it appends the untracked-file diffs a plain `git diff`
would skip. Scope is NOT part of `storeKey` — comments, ratings, tours and
asks belong to the branch, not to a slice of it.

The three worktree scopes need the target branch checked out (prepareTarget
400s otherwise) and are VIEW-ONLY: `requireCommittedScope` blocks the analyze/
tour/ask dispatches, and the UI hides the tool bar for them. Don't wire a
review tool onto a worktree scope — it has no stable head commit to key
artifacts by, and the skills read code through `range=`/`head=`.

## Design Context

Before any UI work, read:

- **PRODUCT.md** — register (product), platform (web), users, positioning ("AI-guided code review"), brand personality, anti-references, and the five design principles (the diff is the room; guidance, not verdicts; familiar idiom, own voice; gritty over glossy; local-fast).
- **DESIGN.md** — the visual system: Dimmed Graphite palette, mono-vs-sans voice rules, flat border-carved elevation, component specs. Tokens in the YAML frontmatter are normative; `.impeccable/design.json` carries extensions (ramps, shadows, component snippets).

Accessibility baseline is WCAG AA (4.5:1 body text, visible focus, reduced-motion alternatives).
