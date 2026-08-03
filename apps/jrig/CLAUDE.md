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
- **Documents are the only thing the app renders.** `rig/styles.ts` and
  `rig/clips.ts` still hold the TS art and clip library, but purely as what
  `rig/migrate.ts` seeds `.data/jrig/documents/` from — nothing draws them.
  `AvatarRig`'s `art` and `clips` props are required for exactly this reason: a
  default would let a page draw TS data without meaning to. A page with no
  documents says so; it does not fall back.
- The two `.vue` files import `ref`/`computed`/etc. from `vue` explicitly —
  keep it that way; `rig/` sits outside `app/` and gets no auto-imports.
- A 409 from a document PUT means *your* edit raced the studio — re-GET, merge
  on top, retry. Never blind-force.
- Run `pnpm --filter jrig test` (143 specs) before calling rig-core work done.
  `rig/pool.spec.ts` validates, compiles and re-serialises every document
  actually on disk — it is what catches a hand-written file whose number
  formatting or id/filename pairing would make the next studio save a rewrite.

## Characters in the pool

`hoodieGuy` is the north-star character, traced from `reference.png` at 0.5
reference-pixels per rig unit with the reference jaw on the head pivot. That
scale is the whole trick: it lands the reference's hand on the rig's hand and
its head on a 170-wide skull, which forces the body to the 556-wide mass it is.
Two things about it are worth knowing before editing:

- **The sleeves are torso art, not the limb.** The reference's sleeve mass runs
  from the shoulder to well below the wrist, so no arm on this skeleton could be
  it. `torso.detail.sleeve-edge` draws it; the limb is an uninked tube hidden
  inside, carrying only the hand. Give that limb ink and you get an outline down
  the middle of each side of the body that the reference does not have.
- **`arm.rig.sleeve.swell` is 3 on purpose.** The sleeve paints shirt over a
  skin-filled limb; at swell 0 the two edges coincide exactly and antialiasing
  leaves a skin hairline tracing the whole arm.

`hoodie` is the older, TS-derived approximation of the same direction — kept
because the seeder regenerates it. `hoodieGuy` is the one drawn from the image.

Screenshot loop: `/still?id=<id>&frame=bust&size=800` renders one character on a
bare page in the rest pose, and `&clip=wave&t=0.5` freezes any clip on it. Both
are static, so two shots of the same document are identical and a pixel diff
means the art moved. `id` and `clip` name documents; there is no skin picker,
because a skin is the one rendering input a document cannot express (it owns the
13 colour roles) and so is simply the rig's default everywhere.
`&frame=avatar&bg=%23f3f4f0&ring=%23ff8793` shoots the round cut-out instead.

## The gallery

Every character document in the pool, sorted by name, with the emote buttons
built from the clip *documents* rather than `BUILT_IN_CLIPS`. Clicking a card
opens `app/components/CharacterModal.vue` — that character on its own with the
whole clip library on buttons. The gallery compares characters, the modal
interrogates one. Deep-linkable with `/gallery?character=hoodieGuy`.

Unfolded, the modal uses the `rig` frame rather than `bust`: it exists to play
emotes and half the library raises an arm out of the portrait crop.

## Avatar preview — the round cut-out

`frame="avatar"` is a third framing beside `bust` and `rig`: a square crop from
the top of the character's own `bust` frame down to `AVATAR_CHEST_Y` (370,
skeleton space), clipped to a circle. It is **derived, not authored**
(`avatarViewBox` in `rig/styles.ts`), so it works on every document that exists
and every one drawn later, with no schema version carrying a third viewBox. 370
is chosen against the skeleton, not against any one drawing: shoulders (312) in,
wrists (484) out — the product shows these chest-up and the hands are never in
shot.

Turn it on with the **Avatar** switch in the gallery (`/gallery?avatar=1`), the
toggle inside the character modal, or per-still with `frame=avatar`. It is a
view, not a variant — switch it off and you get the full drawing exactly as
before, which is the point. The modal's toggle is local state seeded from the
page's, so flipping one character to check how it crops does not re-render the
gallery behind it.

`studio/avatarBackgrounds.ts` holds the colours, lifted from kraken so the
preview shows the real thing. One correction worth keeping, because the
intuition runs the other way: **a story-asset character in Phoenix is not on a
coloured circle.** The circle is `bg-white`/off-white and the colour is the
*ring* plus the matching name-tag pill — KUI pairs them on purpose so they can
never drift. The only Phoenix circle that is actually filled is the user's own
profile avatar, which has its own 7-colour set. Both are here as `story` and
`filled` treatments; `story` is what the cast list does.

`AvatarRig`'s `ring` width is a length, not a percentage — `border-width`
silently computes to zero if you hand it one. Scale it per size through
`--rig-ring-width` (KUI uses 2px at 64px, 4px at 128px).

## Loading documents into the editor

`/editor?character=hoodieGuy&clip=wave.clip.json` opens the keyframe editor on a
character and a clip document; both are also pickers in its Document bar, and
the character choice persists in localStorage. Routing lives in
`app/pages/editor.vue` and reaches `RigEditor.vue` as plain props, because
`rig/` is framework-free by rule.

- **Character** lists the pool and nothing else, and only changes what you are
  looking at. One skeleton — a pose authored against `hoodieGuy` plays on
  `house` and always will. An empty pool means an empty stage, by design.
- **Save → `<id>.clip.json`** writes the *active* clip, so the target follows
  the clip, not the thing you opened. Saving a clip you never opened adopts an
  empty mtime fence and therefore 409s rather than clobbering it; the banner's
  "Overwrite anyway" is the way through. Same fence, same 409 story, as
  `/documents`.
- `studio/clipDocument.ts` is why open→save is lossless. `compileClipDocument`
  is deliberately lossy (a `Clip` is what the renderer needs, not what the file
  holds), so a save layers the regenerated fields over the document as it was
  read — otherwise `notes` and anything else off the runtime type would
  silently disappear the first time you pressed Save.
- `studio/composables/useDocumentPool.ts` is the one read loop over
  `.data/jrig/documents/` — list, compile, follow mtimes. The gallery, the still
  page and the editor all share it; don't write a fourth copy.
