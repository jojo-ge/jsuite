# jRig — the avatar studio (illustration + keyframing for rigged avatars)

> Adapted from the standalone `avatar-studio-plan.md` design document (written for a
> repo of its own, and not carried into this workspace) to a **jSuite app** at
> `apps/jrig`. The source rig was ported from the kraken monorepo:
> `kraken/packages/kui/components/KUI/Avatar/` on branch `avatar-rig` (uncommitted working
> tree at port time, 2026-08-02). The original plan document remains the design deep-dive
> for everything not changed by the pivot below; this file is the executable version.

## Context

The avatar rig (~7,400 lines, built in kraken) has a solid animation core — a fixed
skeleton, a layered clip engine (`rest → base → emote×weight → ambient`), a parametric
face, procedural limb tubes — but art is authored by hand-writing `ArtStyle` path data in
TypeScript. The goal is a **studio app** where illustrators — and Claude as an AI
collaborator — draw characters as live vector documents over the shared skeleton, rig them
by tagging shapes to slots, and keyframe clips. Producing a north-star-quality character
(the hoodie reference) becomes a drawing task, not a coding task.

## Decision record (user-confirmed)

1. **In-app vector editor** — art is live path data the AI can also edit.
2. **One fixed skeleton**, unchanged — every clip plays on every character, forever.
3. **Face stays parametric** — illustrator places `FaceGeometry`; the engine draws expressions.
4. **Rigid parts on bones + procedural limb tubes** — limbs edited as parameters, not drawn.
5. **AI scope v1**: AI illustrates + AI style-checks. AI-animates and image→vector are v2.
6. **AI plumbing**: Claude editing JSON documents on disk; the app picks them up. No AI infra — the investment is an AI-legible schema, a validator, and docs.
7. **Character JSON document is the canonical format**; the renderer consumes compiled documents. `house`/`hoodie` migrate first to prove round-tripping.
8. **Toolset**: select, pen (bézier), node editing, ellipse/rect/capsule, palette-role paint, z-ordering, mirror-once symmetry, snapping, undo/redo. No booleans/gradients/text.
9. **One studio**, Illustrate + Animate modes sharing canvas/selection/document store; clips become JSON documents; the ported keyframe editor's logic is absorbed.
10. **Colour**: every paint binds to a named role (13 skin-contract roles + per-character extras with defaults); line locked near-black with an explicit palette-owning escape hatch.
11. **Validation**: mechanical rules live in-editor and in the vitest suite; AI review is advisory, never blocking.
12. **V1 finish line**: the north-star hoodie character exists as a validated document — drawn in the studio, passing the validator, playing the entire existing 10-clip library. Flat fills only.
13. **jSuite app** (supersedes the original "new repo" decision): `apps/jrig` in the jsuite pnpm workspace, port **43006**, `https://jrig.local`, registered in `./jsuite`, `Caddyfile`, root `CLAUDE.md`, `www/index.html`, and the `jsuite` skill.
14. **Name: jrig** — single lowercase j-word per suite convention.
15. **Documents live in gitignored `.data/jrig/`** via `@jsuite/data` (suite convention), NOT committed in the app. Consequences absorbed below: server API replaces `import.meta.glob`, a first-run seeder replaces committed migration output, in-memory round-trip specs replace committed-file pins, and the 2s mtime poll replaces Vite HMR as the live-reload channel.
16. **Nuxt UI 4** for studio chrome (panels, toolbars, tabs, toasts, banners); the canvas/overlay is custom SVG. Accent: violet.
17. **CLAUDE.md + companion skill**: app CLAUDE.md carries the authoring rules; a thin `j-rig` skill (M9) registers in root `j-setup` MANIFEST + the `jsuite` skill map.

## App layout

```
apps/jrig/
  nuxt.config.ts                  # Nuxt 4 + @nuxt/ui; jrig.local allowlisted
  vitest.config.ts                # plain vitest over rig/ + studio/ specs
  CLAUDE.md                       # entry point for AI collaborators (grows in M9)
  docs/
    PLAN.md                       # this document
    document-format.md            # full schema spec (written in M2)
    rig-notes.md                  # ported README from the kraken Avatar folder
  app/
    app.vue, app.config.ts, assets/css/main.css
    pages/index.vue               # the studio (M4+; placeholder until then)
    pages/gallery.vue             # all styles/skins side-by-side + playAll   [M0 ✓]
    pages/editor.vue              # temp host for the ported RigEditor (deleted in M7)
  rig/                            # ported core (framework-free TS + renderer)  [M0 ✓]
    core.ts clips.ts arm.ts styles.ts          # ← avatarRig*.ts, imports fixed
    AvatarRig.vue RigEditor.vue                # ← KUIAvatarRig*.vue, explicit vue imports
    *.spec.ts                                  # ported specs (54 green)
    evaluate.ts                   # NEW (M1): shared pose evaluator
    document.ts geometry.ts compiler.ts validator.ts migrate.ts   # NEW (M2)
    registry.ts                   # NEW (M2): client-side doc registry (replaces the
                                  #   original plan's import.meta.glob documents.ts)
  studio/                         # M4+: Studio.vue, canvas, panels, pathModel,
                                  #   composables — per the original plan §Studio
  server/
    plugins/seed.ts               # NEW (M2): first-run seeder → .data/jrig/documents/
    api/rig/documents/            # NEW (M3): list/get/put with mtime fence
    utils/rigStore.ts             # appDataDir('jrig') path helpers (@jsuite/data)
```

State root: `.data/jrig/documents/` — FLAT: `<id>.character.json`,
`<id>.clip.json` (the suffix carries the kind; no subfolders). Nothing
app-owned is written anywhere else.

## The document format (M2) — unchanged in substance

A character document is a serialisable `ArtStyle` mirror, field-for-field, with exactly
three deltas: (1) every SVG path becomes a structured segment list
(`[["M",200,64],["C",…]]`, lossless for M/L/C/Q/A, `closed` replaces `Z`), (2) every paint
becomes a bare role name (compiler emits `var(--rig-*)`), (3) a `schema`/`id`/`notes`
envelope (`"avatar-character/1"` / `"avatar-clip/1"`) with required unique layer ids.
`compileCharacterDocument(doc): ArtStyle` is pure; **zero renderer changes**. Left-side-only
authoring (bbox `maxX ≤ 200` on mirrored slots) is validator-enforced. `arm.rig` embeds full
ArmRig params, mutually exclusive with legacy width fields. Schema v1 is flat fills only.
Clips: one JSON per clip, existing `Clip` shape + envelope; `rig/clips.ts` becomes a loader
that still exports `BUILT_IN_CLIPS` so every consumer and spec is untouched.
Full field-by-field spec + validator rule list: original plan §"The document format",
§"The validator" — carried over verbatim into `docs/document-format.md` when M2 lands.

### What the `.data` decision changes (vs the original plan)

- **Loading**: no `import.meta.glob`. `rig/registry.ts` fetches `/api/rig/documents` and
  compiles client-side; every page consumes that and nothing else.
  (**Superseded 2026-08-03 — M3.6.** The plan originally kept an `ART_STYLES` merge,
  "doc wins by id, net-new appends". There is no merge any more: documents are the only
  render source, `mergeStyles`/`mergeClips` are deleted, and `AvatarRig.art`/`.clips` are
  required props so nothing can draw TS art by accident. `rig/styles.ts` and `clips.ts`
  are now purely the seeder's input.)
- **Seeding**: a Nitro plugin seeds `.data/jrig/documents/` on boot when empty, writing
  `migrate(HOUSE)`, `migrate(HOODIE)` and the 10 clip docs (2-space + trailing newline).
  `rig/migrate.ts` is a committed module, not a throwaway — the seeder and touch-migration
  both depend on it.
- **Round-trip proof**: function identity only — `normalise(compile(migrate(style)))`
  deep-equals `normalise(style)` for every flat `ART_STYLES` entry and every clip, in
  memory, in vitest. The original committed-file pin is replaced by a seeder spec that
  runs migrate→serialise→parse→compile and pins equality on the serialised form.
- **Live reload**: the studio's 2s mtime poll (M3) is the one sync channel for external
  (Claude) edits; there is no HMR of documents. The rendered rig follows the registry,
  which follows the poll.
- **Durability risk** (accepted): drawn characters exist only in `.data/` like all suite
  app state. house/hoodie/clips regenerate from TS via the seeder; the hand-drawn
  north-star character does not — back up `.data/jrig/` like any other suite state.
- **"CI"**: jsuite has no CI. The gate is `pnpm --filter jrig test` (validator spec over
  everything in `.data/jrig/` when present, plus the in-memory suites) — run it before
  calling document work done.

## Dev save endpoint + concurrent sync (M3)

`server/api/rig/documents/`: `index.get.ts` lists `{name, kind, mtimeMs}`;
`[name].get.ts` returns `{name, content, mtimeMs}`; `[name].put.ts` takes
`{content, baseMtimeMs, force?}` → validates JSON + schema before writing, stats first and
**409s with current content** on stale mtime. Name whitelist
`^[a-z0-9-]+\.(character|clip)\.json$`, resolved strictly inside `.data/jrig/documents/`.
Writes are 2-space pretty-printed + trailing newline (Claude-authored and studio-saved
files diff identically — mandated in CLAUDE.md too).

Concurrency (two-party dev loop): editor stores `mtimeMs` from GET; `useDocumentSync`
polls every 2s. External change + clean → silent auto-reload with toast, pushing an
"External edit" history entry so cmd+z recovers. External change + dirty → banner
**[Reload — discard mine] / [Keep mine]**; keep-mine leaves the stale mtime so the next
save 409s and upgrades to **[Overwrite anyway]** (`force: true`). cmd+s saves. No
three-way merge — history snapshots are the merge tool.

## Studio architecture (M4–M8) — unchanged

As the original plan §"Studio architecture": three provided stores
(`useStudioDocument` shallowRef + rAF-batched version bump, `useClipLibrary`,
`useStudioSelection`); stacked SVG overlay above the untouched `AvatarRig` (shared
`viewBox` prop, screen↔doc via `getScreenCTM().inverse()`); mirror ghost at x=200 with
input clamping; snap targets from `computeJointFrames`/`withArmsAt`, never DOM; six tools
(`select/pen/node/ellipse/rect/capsule`, editor emits cubics only) on the
`usePointerDrag` primitive (pointer capture, 3px threshold, Esc-cancel); snapshot ring
buffer undo (`structuredClone`, limit 100, one commit per gesture, one stack across both
modes, scratch outside history); `rig/evaluate.ts` (M1) collapsing the renderer's and
editor's hand-kept copies of the layer stack; live preview (ambient idle under the pen,
Still toggle, play-any-clip with locked input); parametric FaceGeometry + ArmRig panels
(M8). Studio chrome uses Nuxt UI components; the canvas layer stays bespoke SVG.

## AI collaboration (M9)

- **CLAUDE.md**: what the app is; documents live in `.data/jrig/documents/`; run
  `pnpm --filter jrig dev` / `test`; JSON formatting mandate; the 409 story; pointer to
  `docs/document-format.md`.
- **docs/document-format.md** (written in M2): every field with type + meaning; segment
  encoding; the 13 skin roles + extras convention; the skeleton pivot table (head 200,230 ·
  shoulders 122,312/278,312 · elbows 100,396/300,396 · wrists 90,484/310,484); sign
  conventions (y down, elbows fold past 180°); left-side-only; full validator rule list;
  a worked example.
- **`j-rig` skill**: thin trigger-rich skill in `apps/jrig/.claude/skills/j-rig/` —
  routes "draw/edit/animate a character" sessions here, points at CLAUDE.md +
  document-format.md, documents the API endpoints. Register in root `j-setup` MANIFEST
  and the `jsuite` skill's tables.
- **Style-check (advisory)**: documented checklist in `docs/` — ink on-grade, silhouette
  reads at thumbnail size, coherence vs the reference image — run on demand via
  screenshot of the studio/gallery; never blocking.

## Milestones

| # | Milestone | Size | Verification |
|---|---|---|---|
| **M0 ✓** | Port + app bootstrap (2026-08-02) | M | DONE: 12 files ported (explicit vue imports added — kraken relied on auto-imports), 54 specs green under vitest 4, gallery/editor/index pages render, suite registration complete. Outstanding: user runs `./jsuite setup` (adds jrig.local + recuts cert) then `./jsuite restart` |
| **M1 ✓** | Shared evaluator + composable extraction (2026-08-02) | M | DONE: `rig/evaluate.ts` (`composePose`/`createEmoteFader`/`createAmbient`, injectable random for specs); `studio/composables/` gained `usePointerDrag` (capture, threshold, Esc-cancel) + `useRigDrag`/`useTransport`/`useClipKeying`/`useClipLibrary`; renderer + editor refactored in place (editor is now wiring + markup only; also made `useId` import explicit). 64 specs green (10 new: layer order / emote weight / stepped snap / fader lifecycle / ambient blink); `nuxt typecheck` clean (vue-tsc added; TS pinned ~5.9 — TS 7 breaks vue-tsc). Behavioral deltas (accepted): drags gained Esc-cancel (joint drag restores pre-drag scratch); import/reset now also rewind the playhead. Outstanding: manual smoke of editor drag/key/play feel |
| **M2 ✓** | Document pipeline (2026-08-02) | L | DONE: `rig/{document,geometry,compiler,validator,migrate,registry}.ts` + `server/{utils/rigStore,plugins/seed,api/rig/documents/*}` + `docs/document-format.md`. 98 specs green: round-trip identity over every migratable flat style (house+hoodie pinned; riso's refusal pinned — raw spot colours are outside schema v1), all 10 clips, seed pool validates clean + compiles back to exact TS sources (JSON canonicalises `-0`→`0`). Seeder verified live (12 docs), external-edit→mtime→endpoint loop verified, gallery grew a poll-driven Documents section. Typecheck clean. Note: docs live FLAT (no characters/clips subdirs); clip ids are camelCase so names allow it. Outstanding: eyeball doc-vs-TS pixel identity in the browser gallery |
| **M3 ✓** | Save endpoint + sync (2026-08-02) | S | DONE: `[name].put.ts` (mtime fence → 409 + current disk content; `force` escalation; validates JSON + schema + id-filename agreement; server re-serialises so every writer lands 2-space + newline), `useDocumentSync` (2s poll; clean→silent reload, dirty→external banner, keep-mine→409→overwrite — all pinned by specs against an in-memory server), `StudioSyncBar` (name/dirty dot/validation chip popovers/save/two-stage banner), plus `/documents` — a raw-JSON browser page wiring it all (and a permanent escape hatch). 102 specs green; PUT paths exercised live over HTTP (409/200/force/3×400). Outstanding: eyeball the banner flows in the browser |
| **M3.5** ✓ | Documents in the ported editor (2026-08-03) | S | DONE, out of band: the editor no longer draws `DEFAULT_ART_STYLE` and no longer ignores the pool. `studio/composables/useDocumentPool.ts` is the shared read loop (gallery + still + editor were three copies of it); `RigEditor.vue` gained a Document bar — character picker over `mergeStyles(ART_STYLES, pool)`, clip-document open, `Save → <id>.clip.json` through the M3 fence, and the conflict banner in the editor's own chrome. `useDocumentSync.adopt` is save-as (empty fence ⇒ creates, or 409s rather than clobbering); `studio/clipDocument.ts` keeps open→save lossless over `compileClipDocument`'s deliberate lossiness. Deep-linkable: `/editor?character=hoodieGuy&clip=wave.clip.json`, routed by the page so `rig/` stays framework-free. 134 specs; typecheck clean. Note this is scaffolding on a component M7 deletes — the composables are the part that survives |
| **M3.6** ✓ | Documents-only rendering + gallery modal (2026-08-03) | S | DONE, out of band. Clicking a gallery card opens `app/components/CharacterModal.vue` — one character, `rig`-framed (half the clips raise an arm out of `bust`), every emote on a button, deep-linkable `?character=<id>`. Then the scope narrowed on request: **the app renders documents and nothing else.** Gone: the Styles and Skins gallery sections, `/still`'s skin picker, and `registry.ts`'s now-dead `mergeStyles`/`mergeClips` — there is no TS layer left to merge over. The avatar preview went with them in the same pass and was **restored immediately after** — "remove all the avatar previews" meant the previews of the TS styles, not the feature. It now runs on documents only: `frame="avatar"` + `avatarViewBox`/`AVATAR_CHEST_Y`, `studio/avatarBackgrounds.ts`, the gallery switch + backgrounds row, the modal toggle, `/still?frame=avatar&bg=&ring=`. `AvatarRig.art` and `.clips` became **required props**, which is the structural enforcement: no default means no page can draw TS data by accident. `rig/styles.ts` + `clips.ts` survive only as what the seeder migrates from. 143 specs; typecheck clean |
| **M4** | Studio shell + canvas (stacked SVGs, renderer `viewBox` prop, zoom/pan, mode tabs) | M | hoodie doc under overlay; debug crosshair on head pivot (200,230) at every zoom/pan; mode switch flips event routing |
| **M5a** | Select + primitives + undo + snapping (`pathModel.ts`, `useHistory`, `useSnapping`, mirror ghost) | M | capsule snapped to elbow pivot; undo/redo across 10 gestures; unit specs |
| **M5b** | Pen + node editing | M | trace the hoodie cap over the breathing character; save → one shape changed in JSON; node-maths specs |
| **M6** | Paint, slots, ordering, validation surface | M | recolour via role; skin switch follows; z reorder live; deliberate violation → chip, save allowed, test fails |
| **M7** | Animate mode + editor retirement (timeline on M1 composables; **delete `RigEditor.vue` + `pages/editor.vue`**) | M | keyframe by joint-drag, undo, play; clip library round-trips through save/reload |
| **M8** | Parametric panels + preview polish | M | place a face on a new head — blink/talk animate it; arm presets live; play `wave` over half-drawn art |
| **M9** | AI collaboration + **north-star character** (CLAUDE.md, `j-rig` skill, style-check; author hoodie-guy) | L | **V1 finish line**: document in `.data/jrig/`, validator green, plays all 10 clips in studio + gallery, side-by-side vs reference |

Sequencing rationale: M1 before studio work (the evaluator is the drift point); M2 before
all tool work (renderer-consumes-document gates everything); M5a before M5b (undo/snap/
gesture conventions before the hardest tool); AI polish last, against real authoring.

## Risks

1. **Compiler fidelity** — doc→ArtStyle must reproduce hand-authored styles exactly; the M2 deep-equality round-trip is the gate.
2. **Overlay registration drift** — shared `viewBox` prop + debug-crosshair check at every zoom.
3. **Deep-reactivity leak into the rAF loop** — shallowRef/version-bump contract in every store mutation.
4. **Arc segments** — untouched `A` segments must render and survive save; cubic-convert only on node-touch; validator guards AI-authored paths.
5. **Mirror invariant vs direct file edits** — canvas clamps, but Claude bypasses the canvas; the validator is the backstop.
6. **Tool scope creep** — six tools is the fence; booleans/gradients/freehand are v2.
7. **mtime granularity** — assumes one studio tab + one AI editor; degrades safely to 409+reload.
8. **HOUSE dual-source drift** (doc + TS spread-base for variant families) — the seeder spec fails loudly; migrating variant families is out of v1.
9. **`.data` durability** — hand-drawn documents are gitignored state; back up `.data/jrig/` (suite-wide posture). The seeder only regenerates TS-derived docs.
10. **Kraken provenance** — the source was ported from an *uncommitted* working tree on kraken's `avatar-rig` branch; this port is now the durable copy. Consider committing the kraken branch anyway for history.
