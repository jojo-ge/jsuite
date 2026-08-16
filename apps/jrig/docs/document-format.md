# The jRig document format — `avatar-character/1` and `avatar-clip/1`

Characters and clips are strict-JSON documents in `.data/jrig/documents/` (flat —
the filename suffix carries the kind). They are the canonical format: the studio
edits them, Claude edits them directly on disk, and `rig/compiler.ts` compiles a
character into the `ArtStyle` the renderer consumes. A document is a
serialisable ArtStyle mirror, field-for-field, with exactly three deltas:

1. every SVG path string becomes a **segment list** (below),
2. every paint becomes a **bare role name** (`"fill": "cap"`),
3. a `schema`/`id`/`notes` **envelope** is added, and layers get required unique ids.

Rules of engagement (also in `CLAUDE.md`):

- **Filename = `<id>.character.json` / `<id>.clip.json`**, id matching `[a-z][a-zA-Z0-9-]*`.
- **Serialisation is fixed**: 2-space indent, trailing newline — studio saves and your edits must diff identically. `serialiseDocument` in `rig/document.ts` is the one implementation.
- **Strict JSON** — no comments; prose lives in the optional `"notes"` field (top level and on any layer).
- Validate your work: `pnpm --filter jrig test` runs the validator suite; the gallery shows a live error badge. Small mechanical rules are errors; taste is advisory only.

## Paths — the segment list

```json
{ "closed": true, "segments": [["M", 200, 64], ["C", 238, 64, 264, 88, 264, 132], ["L", 100, 100], ["Q", 5, 6, 7, 8], ["A", 15, 22, 0, 0, 1, 130, 172]] }
```

- Commands are **absolute** `M / L / C / Q / A` only; arity is `M,L: 2 · C: 6 · Q: 4 · A: 7` (`A` is `rx ry rotation largeArc sweep x y`, flags 0/1). No relative or shorthand commands exist in the format.
- `"closed": true` replaces `Z`. Filled shapes must be closed; stroked lines (brow, nose, crease, seam, cuff, ear fold, sleeve line) must stay open.
- Lossless: migration keeps `Q`/`A` verbatim; the studio's node editor converts one to cubics only when the artist touches that node. **The editor itself only ever emits cubics.**
- Equality anywhere is asserted on parsed numeric form, never on string formatting.

## Colour — roles, never colours

A layer's `fill` must be one of the **13 skin roles** — `skin`, `skin-shade`,
`skin-deep`, `shirt`, `shirt-shade`, `eye-white`, `pupil`, `brow`, `mouth`,
`teeth`, `tongue`, `blush`, `tear` — or a key of the document's own `palette`.
A `stroke` must be `line` or a palette key (line ink stays near-black; owning a
palette entry is the explicit escape hatch). Raw hex, `var()` or `url()` in a
layer is a validator **error**.

`palette` keys are bare (`"cap": "#241d54"`); the compiler prefixes `--rig-`.
Skins recolour any character by supplying the 13 roles; palette entries are the
colours a character owns outright (a cap can't be skin-coloured).

## The fixed skeleton

Art hangs off ONE skeleton, forever — that is the whole contract; every clip
plays on every character. Pivots in view-box space (y is DOWN):

| joint | pivot |
|---|---|
| head | 200, 230 |
| shoulders (L/R) | 122, 312 / 278, 312 |
| elbows | 100, 396 / 300, 396 |
| wrists | 90, 484 / 310, 484 |
| brows | 188, 114 / 212, 114 |
| eyes | 175, 138 / 225, 138 |

Sign conventions: y grows downward; rotations are degrees, composing additively
down the chain; elbows fold past 180° and a value like `armRLow.rot: -232` is
normal, not a bug.

**Left-side-only**: the ear, hand, sleeve line + seam, crease, cuff, and any
layer with `"mirrored": true` are authored on the LEFT (every x ≤ 200,
validator-enforced) — the renderer reflects them about x=200. The canvas clamps
input, but you edit files directly, so the validator is the backstop.

## Character document — field reference

Top level: `schema` (`"avatar-character/1"`) · `id` · `name` · `blurb` ·
`notes?` · `viewBox` · `ink` · `palette?` · `head` · `face` · `pupil` ·
`torso` · `arm`. Anything else (notably `shading`/`filter`/`rough`) is a
warning: **schema v1 is flat fills only**; the shading family stays TS-side
until an `avatar-character/2` ever exists.

- **`viewBox`** — `{ "bust": "24 44 352 542", "rig": "-40 -12 480 616" }`; the rig frame must contain the bust frame.
- **`ink`** — `{ silhouette, feature, detail }`, graded `silhouette ≥ feature ≥ detail > 0`. Grading apart reads as drawn; equal reads as clip-art.
- **`head`** — `path` (closed skull/face mass), `behind?`/`over?` (layer arrays: hair behind, cap/fringe over — headwear last so a cap sits over the brow line), `ear?` (`{path, fold?}` or null, left side), `brow` (`{d, width, cap?}` — an open stroked slash; outer end lower reads relaxed), `nose?`, `blush?` (`{cx, cy, rx, ry}` or null).
- **`face`** — parametric `FaceGeometry`, verbatim: `mouth {cx, cy, width, open, minThickness, finish?}`, `eye {l{cx,cy}, r{cx,cy}, width, open, finish?}`. The ENGINE draws expressions — you only place the geometry. Symmetry is enforced: `mouth.cx === 200`, `l.cx + r.cx === 400`, `l.cy === r.cy`; eyes+mouth must sit inside the head silhouette.
- **`pupil`** — `{r, glint, glintAt{x,y}, range{x,y}, square?}`; keep `2r < eye.width` (a pupil that fills the eye reads alarmed).
- **`torso`** — `neck?` (rect spec or null), `behind?` layers, `shirt` (closed), `shade?` (ONE hem tone, closed — a second tone starts reading as rendering), `detail?` layers (zips, hoods, pockets — drawn under the head so the jaw crops a collar).
- **`arm`** — either **rigged** or **legacy**, never both:
  - Rigged: `rig` embeds full `ArmRig` params verbatim (`taper` stops `{at: 0..1 ascending, r > 0}`, `smooth 0..1`, `ink ≥ 0`, `hand` rig, `sleeve? {hem, swell}`, `creases: none|soft|inked`), plus `shoulder?`, `pull?`, `upperFill`, `lowerFill`, `cap?`. The legacy fields below must be ABSENT (error — the renderer would silently ignore them). The compiler fills ArtStyle's required legacy slots with house defaults.
  - Legacy: `edgeWidth` > `fillWidth` (the ink capsule buries the fill), `sleeve?` (`{width, d, seam}` — width must exceed `edgeWidth`), `hand` (closed, straddling the wrist pivot), `crease?`, `cuff?`, `cap?`.
- **Silhouette traps** (validator errors, learned the hard way): the shirt must top out **above** `shoulderY − cap/2` (else the sleeve's round cap pokes out over the shoulder as a nub) and straddle both shoulder x's; a moved shoulder must keep `shoulder.x − taper[0].r ≥ shirt.minX`.

Every layer: `{ "id", "d", "fill?", "stroke?", "width?", "opacity?", "mirrored?", "notes?" }` —
ids unique across the document (the editor, undo labels and conversations
address layers by id; the compiler drops them). Arrays are paint order = z-order:
ArtStyle's slots ARE the bone bindings, there is no separate rigging table.

## Clip document — field reference

```json
{ "schema": "avatar-clip/1", "id": "wave", "name": "Wave", "duration": 1.6, "loop": false, "layer": "emote",
  "tracks": { "armRUp.rot": [ { "t": 0, "v": 0 }, { "t": 0.3, "v": -150, "e": "easeOut" } ] } }
```

- `layer` is `base` (steady loops: idle, talking) or `emote` (plays above, fading in/out; only overrides the channels it keyframes — that sparseness IS the layer mask).
- Every track channel must exist in the rig's `REST_POSE`; keys are `{t, v, e?}`, time-ordered inside `[0, duration]`; `e` ∈ `linear, ease, easeIn, easeOut, hold, back`.
- **An emote must sample back to rest at `t = duration`** (±0.05) or it can't hand back to the base loop.
- Tracks are fully expanded — no hand/mirror authoring sugar in the format.

## Storage + API

- Pool: `~/code/jojo/jsuite/.data/jrig/documents/` (gitignored state — suite convention). First boot seeds `house` + `hoodie` + the 10 built-in clips from the TS sources via `rig/migrate.ts`.
- `GET /api/rig/documents` on :43006 lists `{name, kind, mtimeMs}` (`?content=1` inlines contents); `GET /api/rig/documents/<name>` returns one. The studio polls mtimes every 2s, so your file edits appear in a running page within seconds. (PUT with an mtime fence lands in M3 — a 409 there means YOUR edit raced the studio: re-read, merge, retry.)

## Worked example (abridged character)

```json
{
  "schema": "avatar-character/1",
  "id": "hoodie",
  "name": "Hoodie",
  "blurb": "Reference direction: small head, big soft body, cap, full sleeves.",
  "viewBox": { "bust": "10 30 380 560", "rig": "-52 -20 504 640" },
  "ink": { "silhouette": 5, "feature": 4.5, "detail": 3.5 },
  "palette": { "cap": "#241d54", "hood": "#e3e5e6", "zip": "#eef1f0" },
  "head": {
    "path": { "closed": true, "segments": [["M", 200, 64], ["C", 238, 64, 264, 88, 264, 132], "…"] },
    "over": [
      { "id": "over-1", "d": { "closed": true, "segments": ["…"] }, "fill": "cap", "stroke": "line", "width": 4.5,
        "notes": "The cap crown — one mass; interior detail would read as a logo." }
    ],
    "brow": { "d": { "closed": false, "segments": [["M", 160, 118], ["L", 186, 112]] }, "width": 10 }
  },
  "face": { "mouth": { "cx": 200, "cy": 186, "width": 56, "open": 44, "minThickness": 3 },
            "eye": { "l": { "cx": 176, "cy": 138 }, "r": { "cx": 224, "cy": 138 }, "width": 30, "open": 60 } },
  "torso": { "shirt": { "closed": true, "segments": ["…"] },
             "detail": [ { "id": "detail-4", "d": { "closed": false, "segments": ["…"] }, "stroke": "line", "width": 3.5, "mirrored": true } ] },
  "arm": { "upperFill": "shirt", "lowerFill": "shirt", "edgeWidth": 62, "fillWidth": 54, "sleeve": null,
           "hand": { "closed": true, "segments": ["…"] } }
}
```

The full validator rule list lives in `rig/validator.ts` (each rule cites its
kraken-spec origin in docs/PLAN.md §M2); the real seeds in `.data/jrig/documents/`
are complete worked examples.
