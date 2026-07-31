# jDiff

A local GitHub client that's really good at diffs. Nuxt 4 app; `gh` lists PRs, local `git` computes and highlights diffs. See README.md for architecture.

## Design Context

Before any UI work, read:

- **PRODUCT.md** — register (product), platform (web), users, positioning ("AI-guided code review"), brand personality, anti-references, and the five design principles (the diff is the room; guidance, not verdicts; familiar idiom, own voice; gritty over glossy; local-fast).
- **DESIGN.md** — the visual system: Dimmed Graphite palette, mono-vs-sans voice rules, flat border-carved elevation, component specs. Tokens in the YAML frontmatter are normative; `.impeccable/design.json` carries extensions (ramps, shadows, component snippets).

Accessibility baseline is WCAG AA (4.5:1 body text, visible focus, reduced-motion alternatives).
