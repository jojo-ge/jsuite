# jRig

Avatar studio: characters are vector documents drawn over ONE fixed skeleton, so
every clip plays on every character. The rig core under `rig/` was ported from
kraken (`avatar-rig` branch) — `docs/rig-notes.md` is its design rationale,
`docs/PLAN.md` is the build plan and decision record. Studio: M4+.

Rules that matter here:

- Character/clip JSON lives in `.data/jrig/documents/` via `@jsuite/data` —
  never inside the app. From M3 on, prefer the `/api/rig/documents` endpoints;
  direct file edits are legitimate (that's the AI authoring loop) but must keep
  2-space indent + trailing newline so studio saves diff cleanly against yours.
- `rig/core.ts`, `clips.ts`, `arm.ts`, `styles.ts` are framework-free TS —
  keep them importable under plain vitest (no Nuxt auto-imports, no `#imports`).
- The two `.vue` files import `ref`/`computed`/etc. from `vue` explicitly —
  keep it that way; `rig/` sits outside `app/` and gets no auto-imports.
- A 409 from a document PUT means *your* edit raced the studio — re-GET, merge
  on top, retry. Never blind-force.
- Run `pnpm --filter jrig test` (54+ specs) before calling rig-core work done.
