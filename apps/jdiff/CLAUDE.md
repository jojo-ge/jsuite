# jDiff

A local GitHub client that's really good at diffs. Nuxt 4 app; `gh` lists PRs, local `git` computes and highlights diffs. See README.md for architecture.

## Review guidance runs in herdr — jDiff runs NO claude

The AI tools (reviewability rating, risk heatmap, guided tour, ask-yourself,
findings, per-line asks) are produced by a claude session dispatched into
herdr via `@jsuite/herdr` (`server/utils/herdrReview.ts`), pinned to Opus 5.
The dispatched session runs the globally-installed `jdiff-review` /
`jdiff-ask` skills (owned here in `.claude/skills/`, installed by
`./jsuite setup`) and POSTs artifacts back to `/api/review-artifact`,
`/api/ask-result`, and `/api/review-complete`; the UI polls the
saved-artifact endpoints. Don't reintroduce an in-process claude runner — a
new guidance tool means a new artifact shape in the skill + a validator in
`server/utils/aiArtifacts.ts`, not an app-side claude run. The prompts live
in the skills, nowhere else; keep `jdiff-ask`'s question table in sync with
`app/utils/askQuestions.ts`.

Tours come in three variants: the analyze run's `overview` tour, an
on-demand `detail` tour (`/api/tour-dispatch mode=detail` → the `jdiff-tour`
skill), and the `chains` walkthrough — `mode=chains` dispatches a
`jdiff-chains stage=scope` session whose manifest POST makes the server
auto-dispatch one `jdiff-chains chain=<slug>` walker per chain
(`server/utils/chainFanout.ts`, unfocused, 4-up packed panes). Chain tours
may stop on unchanged code; the UI renders untouched files via
`ContextFile.vue`. Dispatches are tracked per (repo, target, job) in
`server/utils/herdrReview.ts` — jobs: `analyze`, `detail`, `chains-scope`,
`chain:<slug>`.

jTicket triggers reviews too: its Run-review buttons proxy to
`POST /api/analyze-dispatch` with `ticket=`/`project=` context and
`focus: false`. This server stays ticket-agnostic — it only relays the two
validated keys into the prompt; it is the dispatched `jdiff-review` session
that reports findings back to jTicket (fix tickets for an integration-branch
review, a ticket comment for a single ticket's branch).

## Design Context

Before any UI work, read:

- **PRODUCT.md** — register (product), platform (web), users, positioning ("AI-guided code review"), brand personality, anti-references, and the five design principles (the diff is the room; guidance, not verdicts; familiar idiom, own voice; gritty over glossy; local-fast).
- **DESIGN.md** — the visual system: Dimmed Graphite palette, mono-vs-sans voice rules, flat border-carved elevation, component specs. Tokens in the YAML frontmatter are normative; `.impeccable/design.json` carries extensions (ramps, shadows, component snippets).

Accessibility baseline is WCAG AA (4.5:1 body text, visible focus, reduced-motion alternatives).
