# Product

## Register

product

## Platform

web

## Users

Any developer, publicly. jDiff is an open-source tool meant to be installed and used by developers reviewing pull requests on their own machines. They live in git and `gh`, have local clones of the repos they review, and open jDiff when a PR needs real attention — deep-focus reading sessions, not casual browsing. Design decisions must be legible to someone who didn't build the tool and has used GitHub's review UI for years.

## Product Purpose

jDiff is a local GitHub client that's really good at diffs. GitHub is consulted only for the list of open PRs; fetching, diffing, and syntax highlighting all happen against the local clone with the user's own git tooling. On top of the diff sits a guided review layer — AI-generated tours, risk heatmaps, ask-yourself prompts, ratings — that helps the reviewer actually understand the change. Success is faster, deeper review: getting through a PR quicker while comprehending more of it than a raw diff scroll would allow.

## Positioning

AI-guided code review — the guidance layer (tours, risk scoring, review prompts) makes you a better reviewer, not just a faster diff reader.

## Brand Personality

Friendly, guiding, approachable — like a patient senior engineer walking you through a change, not a machine emitting verdicts. But the friendliness sits on a gritty, developer-native foundation: monospace, dark, close to the metal. Warmth comes through in the copy and the guidance, never through softness in the chrome.

## Anti-references

- **AI-tool gimmickry** — no sparkle icons, purple gradients, or chat bubbles; the AI layer should feel like review expertise, not a costume.
- **Enterprise dashboard** — no Jira/DevOps density-without-purpose: KPI tiles, card walls, chrome that outweighs content.
- **A GitHub clone** — the diff idiom can stay familiar, but the app must not read as a reskin of github.com.
- **Consumer-cute** — no rounded, bouncy, illustration-heavy friendliness that undercuts a professional tool.
- **SaaS polish** — it should not feel like a hosted product with onboarding funnels and marketing sheen; keep the gritty local-tool feel.

## Design Principles

1. **The diff is the room** — every other element (nav, guidance, notifications) is furniture; nothing may compete with the code for attention.
2. **Guidance, not verdicts** — AI features phrase themselves as a colleague's walkthrough or question, and are easy to consult and easy to ignore.
3. **Familiar idiom, own voice** — reuse the diff-reading conventions reviewers already know (side-by-side, add/del coloring) but execute them with more care than GitHub does, and diverge everywhere else.
4. **Gritty over glossy** — prefer the texture of a developer tool (monospace, dense, dark) to the sheen of a SaaS product; warmth lives in words, not gradients.
5. **Local-fast** — the UI should feel as immediate as the local git operations behind it; no artificial loading theater.

## Accessibility & Inclusion

WCAG AA: text contrast ≥ 4.5:1 (≥ 3:1 for large text), visible focus states, full keyboard operability, and `prefers-reduced-motion` alternatives for all animation.
