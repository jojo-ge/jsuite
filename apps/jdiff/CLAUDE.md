# jDiff

A local GitHub client that's really good at diffs. Nuxt 4 app; `gh` lists PRs, local `git` computes and highlights diffs. See README.md for architecture.

**The UI is not in this app.** Every review screen — the PR page, the branch
review, the diff itself, comments, the guidance summaries — lives in the
`@jsuite/diff` layer at `packages/diff/app/`, which this app extends. What's
here is `app/pages/*.vue`, two-line aliases mounting those screens on jDiff's
short routes, plus the scratch prototypes under `app/components/scratch/`. Do UI
work in `packages/diff/app/`; touch this app only for the aliases, the shell, or
a prototype. Links between review screens go through `useDiffRoutes()`, never a
hardcoded path — that is what keeps `/prs` and `/diffs/prs` the same screen.

## Design Context

Before any UI work, read:

- **PRODUCT.md** — register (product), platform (web), users, positioning ("AI-guided code review"), brand personality, anti-references, and the five design principles (the diff is the room; guidance, not verdicts; familiar idiom, own voice; gritty over glossy; local-fast).
- **DESIGN.md** — the visual system: Dimmed Graphite palette, mono-vs-sans voice rules, flat border-carved elevation, component specs. Tokens in the YAML frontmatter are normative; `.impeccable/design.json` carries extensions (ramps, shadows, component snippets).

Accessibility baseline is WCAG AA (4.5:1 body text, visible focus, reduced-motion alternatives).
