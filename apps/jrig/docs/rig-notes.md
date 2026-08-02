# Avatar rig

A chest-up character rig with arms, driven by keyframed numeric channels. The
premise is the Fortnite one: **any skin can play any emote**, because an emote
is data about a skeleton, never about a drawing.

| File | What it is |
|---|---|
| `avatarRigCore.ts` | The contract: skeleton, channels, clip format, sampler, matrix maths, parametric face geometry, skins. No Vue. |
| `avatarRigClips.ts` | The built-in clip library (idle, talking, laugh, cry, facepalm, raise hand, wave, point, thumbs up, shrug). Pure data. |
| `avatarRigArm.ts` | Procedural limbs: the arm and hand as one computed silhouette, plus the variant rigs. |
| `avatarRigStyles.ts` | The art styles: every silhouette, ink weight and face placement, as data. |
| `KUIAvatarRig.vue` | The rig: art bound to the skeleton + the per-frame playback engine. |
| `KUIAvatarRigEditor.vue` | Dev tooling to author clips. Not product UI. |

Dev page (Phoenix, unauthenticated): **`/avatar-rig`**, the clip editor. It
draws `DEFAULT_ART_STYLE`, which is the figure every choice below landed on.

The comparison pages this was picked on — every art style, the shading spread,
the limb variants — are gone now that it is picked. The styles themselves are
still in `avatarRigStyles.ts` and still side by side in the Storybook
`Styles` story, which is where to go to re-open any of these decisions.

## Why this isn't the CSS approach

The previous SVG avatar (`Content/StoryAsset/demo-svg`) proved the art direction
with CSS `@keyframes` and toggled expression shapes. That can't become a rig:

- **CSS keyframes aren't editable from a UI.** A rig has to be authored, and a
  tool can't write CSS at runtime. Clips here are JSON, so the editor round-trips
  them and `avatarRigClips.ts` is just the version that got committed.
- **Toggled shapes give you a fixed set of faces.** Here the mouth and eyes are
  *computed paths* — `mouthCurve: -0.4` is a real expression, not a missing asset.
- **CSS animations can't blend.** Layering an emote over a talk loop, at a
  weight, per channel, needs a per-frame evaluator.

## The skeleton

Parented joints, each with a pivot in view-box space. Because every transform is
identity at rest, a child's pivot is authored in the same global coordinates as
its parent's, and nesting handles propagation.

**The shoulder pivots sit inside the torso silhouette, not on its edge.** The
sleeve is drawn as a capsule around the shoulder, so a pivot on the outline makes
its round cap poke out above the shoulder as a visible nub, and a pivot outside
it makes the resting arm look detached. A spec asserts it, because it is easy to
reintroduce by nudging the torso path.

```
root → torso → chest ─┬─ neck → head ─┬─ browL / browR / eyeL / eyeR / jaw
                      ├─ armLClav → armLUp → armLLow → armLHand ─┬─ handLThumb1 → handLThumb2
                      │                                          ├─ handLIndex1 → handLIndex2
                      │                                          ├─ handLMiddle1 → …
                      │                                          ├─ handLRing1 → …
                      │                                          └─ handLPinky1 → …
                      └─ armRClav → armRUp → armRLow → armRHand ─── (the same, mirrored)
```

**The clavicle is a joint, not decoration.** A shoulder is not a socket bolted to
the ribcage: the whole girdle rides up and forward before the arm has rotated at
all, and that is most of the difference between a reach and a swing. It is
identity at rest, so every clip authored against the old three-bone chain still
means exactly what it did.

**Each digit is two bones, and its rest angles carry a curl** toward the palm
(+x on the left hand). A hand whose bones all rest on one axis reads as a splayed
board; the resting curl is why a hand hanging by the side looks relaxed before a
clip has touched it. Because both bones fold the same way, a clip can say "curl"
as a single positive number for any digit on either hand — see `handTracks` in
`avatarRigClips.ts`, which expands a grip into twenty tracks.

Each joint exposes `rot`, `x`, `y`, `sx`, `sy` as channels named `joint.channel`.
`KUIAvatarRig.vue` renders the tree as nested `<g transform>`; `computeJointFrames`
solves the same matrices analytically so the editor's drag handles land exactly on
the art, whatever the pose.

**Sign conventions** (SVG space: y grows down, positive rotation is clockwise /
toward the viewer's right) are documented at the top of `avatarRigClips.ts`.
The one that surprises people: elbows fold well past 180°, because full flexion
sweeps the forearm up and over. `armRLow.rot: -232` is a normal deep fold.

## The face is parametric

`face.*` channels drive geometry instead of transforms. Both the mouth and the
eyes come from one lens — corners that rise with `curve`, a body that opens with
`height` — in two finishes:

| | Used by | Corners |
|---|---|---|
| `lensPath` | mouth | pointed — two quadratics meeting at a point |
| `roundLensPath` | eyes | rounded — four cubics meeting with matching tangents |
| `boxLensPath` | `pixel` | none — an axis-aligned box between the same apexes |

Where the features sit and how big they are is per style (`FaceGeometry`), and
so is which finish each uses. The box finish is sized off the apexes the other
two *reach*, so every caller constant carries over — but a rectangle has no
corners to lift, so `mouthCurve` can only slide it. A style using it gets its
expression from the eyes and brows, and that trade is the style's to make.

Both degrade gracefully at every extreme: grin, frown, closed line, wide O,
squint. The round one places its apexes where the pointed one *reaches* rather
than where its controls sit, so the two are the same visual size for the same
inputs and every caller constant carries over between them. A spec pins that.

Three knobs are load-bearing and easy to get wrong:

- **`openUp`** — how much of the opening goes *above* the corner line. A mouth
  opens straight down from a lip line (`0`); an eye has to open about its centre
  (`0.5`). At `0` an eye is flat-topped, which reads as permanently half-lidded
  no matter how wide the clip opens it.
- **`minThickness`** — the floor on a closed shape. The mouth's is deliberately
  tiny (2.5): a closed mouth should be the *outline stroke* and nothing else,
  and anything larger reads as a mouth hanging open at rest. The eye's is **0**,
  for the reason below.
- **`CORNER_LIFT`** — a quadratic only reaches half its control offset, so the
  corner lift has to be generous or a "smile" renders as a flat line. All three
  are covered by specs.

That is what buys the emotional range. `mouthCurve` × `mouthOpen` × `mouthWide`
is a continuous space, and `eyeOpenL/R` + `eyeCurveL/R` are per-eye, so the rig
can wink or look sceptical without new art.

## The open eye and the shut eye are two drawings

The eye is a **plain circle** (32 across) with **no outline of its own** and a
modest pupil (r8). A rim around it fights the pupil for the same job and drags
the whole face heavier than it should read; the friendliness lives in the white
left visible around the pupil, so a pupil that fills the disc reads as alarmed
however friendly the mouth is.

But a *shut* eye has no white left to read, so it has to be a drawn line.
`eyeLidInk` crossfades between the two as `eyeOpen` falls through 0.34 → 0.16.
That is also why `minThickness` is 0 here: a floor would leave a sliver of white
showing through every blink and every held squint, so the eye is allowed to
vanish outright because the lid takes over on the way down.

The lid needs no shape of its own — it is `eyePath` *stroked*. At `eyeOpen: 0`
the lens is degenerate and the path collapses onto the arc the lids meet along,
so a shut eye already curves with `eyeCurve`: `laugh` squints upward, `cry`
squints downward, `facepalm` shuts flat.

## Layering — the important bit

Evaluated in order, every frame:

```
rest pose  →  base clip (idle / talking)  →  emote clip × weight  →  ambient
```

**A clip only overrides the channels it actually keyframes.** That sparseness
*is* the layer mask — no mask needs declaring. `raiseHand` keyframes the arms and
barely touches the face, so it plays over the talking loop and the character keeps
talking through it. `applyPose` blends by weight, except channels marked `stepped`
(`armL.front` / `armR.front`, which choose whether an arm draws in front of the
body) which snap, because a hand is either in front of the face or behind the
shoulder and never half of each.

The **ambient layer** runs last and is additive: breathing, sway, and autonomous
blinking every 2–5s. This is what makes the rig "move freely no matter what" —
nothing an emote does can leave the character dead still.

Blinking is **multiplicative** on `eyeOpen`, not absolute, so it reads over a
squint or a wide-eyed pose without ever fighting the clip that authored it, and
it is skipped entirely when the eye is already nearly shut. The lid snaps closed
over the first third of the blink and drifts back open over the rest — a
symmetric curve reads mechanical. `ambient` defaults on, including in the editor,
so the character is alive while you author; drags cache their pivot at the start
so the sway can never make a handle jitter.

## The art is data too

`KUIAvatarRig.vue` draws whatever `ArtStyle` it is handed (`art` prop, defaulting
to `house` — it can't be called `style`, which Vue reserves for the inline style
attribute). A style is silhouette paths, ink weights, where the parametric face
sits, and any extra pieces it needs; **none of it touches the skeleton**, so
every style plays every emote. That is the same claim as skins, one level up.

Left-side art is authored **once** and the renderer reflects it about x=200 for
the right, inside the joint group — so only the *drawing* mirrors and a joint's
rotation still means what the clips say. A style can't drift out of symmetry.

`ART_STYLES` runs from conservative to radical:

| | |
|---|---|
| `house` | The original drawing, unchanged. Egg head, plain tee, graded ink. |
| `hoodie` | Small head on a big soft mass, cap, sleeves to the wrist. |
| `chunk` | Big head, squat body, huge eyes, a hair mass. |
| `blocky` | Straight edges and chamfers, no freehand curve anywhere. |
| `linework` | Thin uniform ink, long neck, small features. Editorial. |
| `bean` | One soft mass. No neck, ears or nose; reads at icon size. |
| `pixel` | 8-bit sprite: staircase silhouettes, box eyes, square pupils. |
| `hose` | 1930s rubber hose: circle head, tube arms, white gloves. |
| `neon` | Linework as a sign — dark fills, one glowing stroke, glow in a filter. |
| `riso` | Two-colour print of `chunk`, with a spot plate off register. |
| `sketch` | `house` roughened: every edge displaced by fractal noise. |

Three of those are *treatments* rather than new shapes (`neon`, `riso`,
`sketch`), which is the point: a style can be almost entirely paint.

**A style's palette wins over the skin's.** Most styles only add variables the
skin doesn't know about (a cap, a hood lining, hair), so skins still drive them —
but `neon` and `riso` *are* their palettes, and a skin recolouring them would
just be a bug.

Two silhouette rules every style has to satisfy, both learned the hard way and
both pinned by `avatarRigStyles.spec.ts`:

1. The shirt tops out well above y=312 at x≈122, or the sleeve's round cap pokes
   over the shoulder as a nub.
2. The shirt is *wider* than the sleeve at shoulder height, or the sleeve's fill
   eats a bite out of the shoulder outline.

`hose` breaks the first on purpose: its arms attach as visible tubes, which is
the period look, and it has no sleeve for a cap to poke out of.

## Shading

Flat fills are the house look, not the only option the renderer supports.
The **Depth family** is one drawing at a spread of levels and techniques,
meant to be compared rather than merged:

| | Level or technique |
|---|---|
| `houseDepth` | The reference: gradients + occlusion + rim + specular + filter cast. |
| `depthWhisper` | The same recipe at a third of the value. |
| `depthBold` | The same recipe pushed until it is doing the drawing. |
| `depthHybrid` | Hard core shadow for form, soft occlusion for contact. |
| `depthGrounded` | Occlusion plus a real head/arm shadow on the body. |
| `depthOcclusion` | Contacts only — jaw, collar, shoulders, hem. No light direction. |
| `depthEdge` | Darkened from the silhouette inwards. Volume, no light direction. |
| `depthCut` | Paper cut: flat fills, one hard unblurred contact shadow. |
| `depthHalftone` | Screen tone: the shade side is dots, not value. |
| `depthHatch` | Cross-hatching at two densities. Survives one-colour print. |

`HOUSE_SHADING` keeps the earlier, coarser exploration (`houseCel`, `houseSoft`,
`houseCast`, `houseNight`); everything is in `ART_STYLES` either way.

### The rules that hold across all of them

- **Shading is clipped to the mass it sits on.** A shadow that spills past the
  silhouette stops reading as shadow instantly, so `shading.head` and
  `shading.shirt` are clipped to those paths and can be drawn loosely.
- **Shadows are black at low opacity and highlights are white**, never a colour
  mixed from the palette. Shading built out of skin tones bakes one skin into
  the art, and the whole point of a skin is that it swaps. `houseNight` is the
  deliberate exception: its light *is* a colour, so it says so.
- **A dark garment eats a black overlay.** Shading a forest-green shirt needs a
  white pass on the lit side as much as a black one on the shade side.
- **Tone needs area.** A crescent that works as a soft gradient reads as a
  blemish once it becomes dots, so the screened variants shade a broad third of
  each mass and stack a denser band inside it.

### Two ways to cast a shadow, and why one of them is wrong

`shading.cast` is a CSS filter on the head group and the arm instances. It
follows the pose, which painted-on shading cannot — but a filter knows nothing
about the scene, so the shadow also lands on the page behind him, as if he were
standing against a wall. That halo is what makes `houseDepth` and `depthBold`
look off once you notice it.

`shading.headShadow` / `shading.armShadow` do it properly. The head's own
silhouette (and the arm chain, instanced a third time and knocked to black with
`brightness(0)`) is offset, **clipped to the shirt**, and drawn inside the
transform tree. It tracks every tilt, a raised arm's shadow travels up the chest
with the arm, and it can only ever fall on the body. It costs one extra `<use>`.
`depthHybrid`, `depthGrounded` and `depthCut` use it; compare any of them with
`houseDepth` on the same page.

### The house look, specifically

Flat fills inside one heavy near-black ink line, no gradients, and **at most one
shade tone per material** — a second tone starts reading as rendering and breaks
the house style immediately. The line weight is graded, not uniform: ~4.5 for
silhouettes, ~4 for the head and features, ~3 for interior detail. A style that
makes those three equal reads as vector clip-art instead of a drawing, which is
a legitimate direction (`blocky`, `pixel`) and therefore a per-style choice.

The character is deliberately plain — a bald head and a plain tee, no props. Any
prop has to survive every pose the rig can reach, so anything added here earns
its keep or doesn't go in.

## Arms are one shape, not three

The original arm was three stroked bones stacked on each other, each with its own
dark edge capsule under its own fill. That is why it read as a string of
sausages, and the two complaints about it were really one complaint:

- every joint drew a **second outline inside the limb**, so the parts of the body
  were advertised at each seam;
- a stroke has **one width**, so nothing could taper — no deltoid, no wrist.

`avatarRigArm.ts` builds one shape instead. The bone chain is resampled onto a
spline through the joints (`smooth`), given a half-width at every sample
(`taper`), and turned into a closed outline by `tubePath` — a stroke, if a stroke
could change width. The palm and each digit are more tubes overlapping it.

The union happens at paint time, and it is the whole trick: the renderer draws
**every shape in a group inked first, then every shape filled**. The ink pass is
the silhouette dilated (filled *and* stroked in the line colour at `2 × ink`); the
fill pass paints the shapes back over the inner half of that stroke. What
survives is a uniform outline around the outside of the union and nothing at all
between its parts. An elbow is a bend in one silhouette; a finger meets the palm
with no seam. `segmented: true` puts each bone in its own group and reproduces the
old look, which is what the `sausage` rig is kept for.

Two consequences worth knowing:

- **A digit needs its own line or it disappears.** Fingers are spaced closer
  together than they are wide, so the union has no notch to show them. `creases`
  strokes each digit's outline (`inked`) or does it in skin shade (`soft`); a mask
  hides those lines inside the palm, where a finger's root cap would otherwise
  draw an arc across the middle of the hand.
- **A fist has a limit.** In three dimensions a curling finger goes *behind* the
  palm and foreshortens away; in the picture plane it can only swing sideways, so
  past ~100° of bend a digit stops being drawn as a separate finger and just
  swells the silhouette into knuckles. `FIST` in `avatarRigClips.ts` is the curl
  that stays the right side of that.

## Drawing arms in front or behind

Each arm chain is authored once in `<defs>` and instanced twice with `<use>` —
once before the torso, once after the head. `armX.front` picks which instance
renders, and **rests at "in front"**. The geometry is computed in *chest* space
(`computeSubtreeMatrices`), which is the space the static art was authored in, so
the procedural paths drop into the group the stroked bones lived in and inherit
the body's transforms, the shirt clip and the arm shadow unchanged.

Resting the arms in front is a deliberate art call, not just a z-order default.
A chest-up figure whose arms hide behind the body is one flat mass, and no amount
of reshaping the silhouette fixes that — widening it toward the bottom reads as a
dome, narrowing it reads as a vase. Two outlined arms down the sides give the
body structure, and the shoulder seam is what makes it read as a torso.

## The tee sleeve is the fiddly bit

The sleeve is a short capsule of shirt colour laid over the top of the upper-arm
bone. It is **filled but not outlined**; a separate open path inks only its outer
seam and hem. A closed outline would ring the shoulder in black *inside* the
shirt and read as a shoulder pad — the shirt's own silhouette carries the
shoulder, and the sleeve only has to say where it ends.

On a procedural limb the sleeve is the first `hem` fraction of the arm tube,
painted over the top and left out of the ink union entirely, with `capEdge`
giving the hem line. Three rules follow:

- its `swell` stays at **0**, because an uninked lip of shirt poking past the
  arm's outline reads as a rendering bug rather than as cloth;
- a shaded style hands it the shirt's paint via `shading.sleeve`, drawn as a
  *second* pass over the shirt colour — that paint is a translucent tone, so used
  as the fill it tints the bare arm instead of covering it and the sleeve becomes
  a smudge on the bicep;
- **the hem line goes away when the limb has no ink.** Otherwise the only line on
  the whole arm is a black arc across the bicep, which reads as a band. Where the
  sleeve stops is already said by the colour changing.

On the older stroked arm its width is pinned between two things, with little
slack:

- **wider than the arm** (44 outline / 36 fill), or the arm's own outline pokes
  out of the sleeve as a stray arc on the chest;
- **narrower than the shirt** at that height, or the sleeve's fill eats a bite
  out of the shoulder outline.

At the shoulder the arm outline reaches x≈100 and the shirt reaches x≈91, so the
52px sleeve sits in the ~8px gap between them. Change the arm weight, the shirt
path or the shoulder pivot and all three have to be re-checked together.

## Body proportions

The torso is widest below the deltoids with near-vertical sides, and the arms
overlap its outer edge so the *combined* shape defines the silhouette. Numbers
worth knowing before editing the path: the shoulders top out at y≈242, the crew
neckline dips to y≈266, the hem sits at y≈496, and the shoulder pivots are at
(122, 312) / (278, 312). Moving a shoulder pivot changes every arm's reach and
means re-deriving the clip poses (law of cosines against the target hand
position) — it is not a nudge.

## Skins

`Skin` is a set of CSS custom properties. In this iteration a skin is **colour
only** — the art is fixed, and the editor deliberately has no reskinning UI. The
contract is the point: a future skin binds to the same channels, so every emote
authored today keeps working. `SKINS` ships three (`rowan` the base, plus `juno`
and `wren`) to prove the swap.

Every skin recolours the *same* drawing, and `--rig-line` stays near-black in all
of them. A skin that recolours the outline stops the cast looking like one cast,
which defeats the point of having a house style at all.

## The editor

`/avatar-rig`. The clip is the single source of truth: scrubbing samples it,
dragging a bone writes back into it, and **Copy JSON** produces exactly the shape
`avatarRigClips.ts` holds.

- Drag a pivot to rotate; <kbd>Shift</kbd>-drag to translate. Auto-key (on by
  default) writes a keyframe at the playhead when you release.
- <kbd>Space</kbd> play, <kbd>←</kbd>/<kbd>→</kbd> step a frame, <kbd>K</kbd> key
  the pending edits, <kbd>⇧K</kbd> key every channel that differs from rest,
  <kbd>Delete</kbd> remove the selected keyframe.
- **Base** blends the emote over `idle` / `talking` while you author, using the
  same layer stack the rig runs. **Play in rig** hands the clip to the rig's own
  engine so you also see the fade in / fade out.
- **Skeleton** (on by default) toggles the rig overlay — bones, pivots and the
  selected joint's handle — so you can watch the pose as art. Dragging goes with
  it; select joints from the inspector chips while it is off.
- Work is persisted to `localStorage`; **Reset** returns to the built-ins.

## Adding an emote

Author it in the editor, hit **Copy JSON**, and paste the clip into
`BUILT_IN_CLIPS`. `avatarRigCore.spec.ts` guards the library: every clip must
reference real channels, keep its keyframes in order and inside its duration,
and — for emote-layer clips — **return to rest at the end**, so it can hand back
to the base loop without popping.
