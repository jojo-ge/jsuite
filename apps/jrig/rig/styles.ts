// Art styles for the rig.
//
// The skeleton, the channels and the clips are fixed (that is the whole contract
// — see README.md). What is *not* fixed is the drawing bound to them, and this
// file is that drawing, as data: silhouettes, ink weights, where the parametric
// face sits, and the handful of extra pieces a style needs (a cap, a hood, a
// zip). `AvatarRig.vue` renders any of these; every one plays every emote.
//
// Everything is authored in the same view-box space, and the skeleton pivots are
// the fixed anchors art has to respect:
//
//   head 200,230 · shoulders 122,312 / 278,312 · elbows 100,396 / 300,396
//   wrists 90,484 / 310,484 · brows 188,114 / 212,114 · eyes 175,138 / 225,138
//
// Left-side art is authored once and the right side is the same path reflected
// about x=200 by the renderer, so a style can never drift out of symmetry.
//
// Two rules every silhouette has to satisfy, both learned the hard way:
//
//  1. The shirt has to top out well above y=312 at x≈122, or the sleeve's round
//     cap pokes out over the shoulder as a nub.
//  2. The shirt has to be *wider* than the sleeve at shoulder height (the sleeve
//     reaches `sleeveWidth / 2` either side of the bone), or the sleeve's fill
//     eats a bite out of the shoulder outline.

import type { ArmRig } from './arm';
import type { FaceGeometry } from './core';

import { ARM_NO_INK, ARM_RIGS } from './arm';

/** A free-form piece of art: a cap, a hood, a zip, a pocket seam, a shadow. */
export interface StyleLayer {
  d: string;
  /** A colour, or `url(#id)` naming one of the style's gradients. */
  fill?: string;
  stroke?: string;
  /** Stroke width; defaults to the style's detail ink. */
  width?: number;
  opacity?: number;
  /** CSS filter, which is how a soft shadow gets its softness: `blur(10px)`. */
  filter?: string;
  /** Reflected about x=200 as well as drawn, for symmetric detail. */
  mirrored?: boolean;
}

/** A gradient in view-box coordinates, so its stops line up with the art. */
export interface StyleGradient {
  id: string;
  kind: 'linear' | 'radial';
  /** Linear: the axis. Radial: `from` is the centre and `r` the radius. */
  from: { x: number; y: number };
  to?: { x: number; y: number };
  r?: number;
  stops: { at: number; colour: string; opacity?: number }[];
}

/**
 * Everything a style does beyond flat fills. Shading is deliberately its own
 * block rather than more layers: a shadow shape has to be *clipped* to the mass
 * it sits on, or it spills past the silhouette and the whole illusion goes.
 */
/**
 * A tiling shade. Screen-tone and hatching are how print shaded before it could
 * blur, and they read completely differently from a gradient at the same value.
 */
export interface StylePattern {
  id: string;
  kind: 'dots' | 'lines';
  /** Tile size in view-box units. */
  size: number;
  colour: string;
  opacity?: number;
  /** Dot radius, or line thickness. */
  weight: number;
  /** Degrees. 45 is the usual for hatching; 0 for a horizontal screen. */
  angle?: number;
}

export interface StyleShading {
  gradients?: StyleGradient[];
  patterns?: StylePattern[];
  /** Clipped inside the head, drawn over the skin and under the features. */
  head?: StyleLayer[];
  /** Clipped inside the shirt, drawn over its flat fill. */
  shirt?: StyleLayer[];
  /**
   * CSS filters for real cast shadows. These follow the pose, which painted-on
   * shading can't: a raised arm's shadow travels up the chest with it.
   *
   * Their flaw is that a filter knows nothing about the scene — the shadow
   * lands on the page background too, as if there were a wall behind him. Use
   * `headShadow` where that shows.
   */
  cast?: { head?: string; arms?: string };
  /**
   * The head's shadow on the body: the head's own silhouette, offset, clipped
   * to the shirt, and drawn inside the transform tree so it tracks every tilt.
   * Physically what a cast shadow is, and it can only fall on the body.
   */
  headShadow?: { dx: number; dy: number; opacity: number; blur?: number };
  /**
   * The same trick for the arms: the arm chain instanced a third time, knocked
   * to black, offset and clipped to the shirt. Follows every pose, and a raised
   * arm's shadow travels up the chest with it.
   */
  armShadow?: { dx: number; dy: number; opacity: number; blur?: number };
  /** A second stroke laid over each limb — cylinder shading for an arm. */
  limb?: { stroke: string; width: number };
  /**
   * Paint for a procedural sleeve. The sleeve is part of the shirt, so a style
   * that shades the shirt has to hand the sleeve the same paint or it reads as a
   * flat patch stuck on the shoulder.
   */
  sleeve?: string;
}

export interface ArtStyle {
  id: string;
  name: string;
  /** What this style is going for — shown in the gallery. */
  blurb: string;
  /** Per-style framing: a bigger head or a wider body needs more room. */
  viewBox: { bust: string; rig: string };
  /**
   * Graded line weights. `silhouette` outlines the big masses, `feature` inks
   * the face, `detail` is interior linework. A style that grades them apart
   * reads as drawn; a style that makes them equal reads as vector clip-art —
   * both are legitimate directions, which is why it is a per-style choice.
   */
  ink: { silhouette: number; feature: number; detail: number };
  /** Colours this style owns rather than the skin — a cap can't be skin colour. */
  palette?: Record<string, string>;
  /** Gradients, clipped shadow shapes and cast shadows. See `StyleShading`. */
  shading?: StyleShading;
  /** CSS filter applied to the whole drawing: a neon glow, a paper shadow. */
  filter?: string;
  /** Displaces every edge with fractal noise, so the linework wobbles. */
  rough?: boolean;
  head: {
    /** The skull/face mass. */
    path: string;
    /** Drawn behind the head, moving with it: hair, a hood lining. */
    behind?: StyleLayer[];
    /** Drawn over the face: a cap, a fringe. */
    over?: StyleLayer[];
    /** Ear mass and its inner fold, left side only. `null` for no ears. */
    ear?: { path: string; fold?: string } | null;
    /** A stroked line, not a shape — every style's brow is a slash of some angle. */
    brow: { d: string; width: number; cap?: 'round' | 'butt' | 'square' };
    nose?: string | null;
    blush?: { cx: number; cy: number; rx: number; ry: number } | null;
  };
  face: FaceGeometry;
  pupil: {
    r: number;
    glint: number;
    /** A square pupil, for styles with no curves in them at all. */
    square?: boolean;
    /** Glint offset from the pupil centre. */
    glintAt: { x: number; y: number };
    /** How far `face.pupilX/Y` can slide the pupil. */
    range: { x: number; y: number };
  };
  torso: {
    neck?: { x: number; y: number; width: number; height: number; rx: number } | null;
    /** Drawn under the shirt: an off-register plate, a cast shadow. */
    behind?: StyleLayer[];
    shirt: string;
    /** Exactly one shade tone per material — a second starts reading as rendering. */
    shade?: string | null;
    /** Zips, drawstrings, hood collars: drawn over the shirt, under the head. */
    detail?: StyleLayer[];
  };
  arm: {
    /**
     * Procedural limbs. When set, the arm is one computed silhouette rather than
     * a stack of stroked bones, and `edgeWidth` / `fillWidth` / `hand` / `crease`
     * stop being read — the rig owns the width profile and the hand. See
     * `arm.ts` for why that is the only way to lose the sausage seams.
     */
    rig?: ArmRig | null;
    /**
     * Moves the shoulder joint for this drawing only, left side; the right is
     * mirrored. The limb starts here and the shoulder rotates about it, so this
     * is what decides whether an arm swings out of the middle of the chest or
     * off the edge of the shoulder. Defaults to the skeleton's own 122,312.
     */
    shoulder?: { x: number; y: number } | null;
    /**
     * Moves everything below the shoulder inboard, left side. A narrow torso
     * needs this: leave the bones where a wide one put them and the upper arm
     * hangs outside the shirt, which — on an uninked limb — shows up as the
     * shirt's outline drawn across the sleeve.
     */
    pull?: number;
    /** Bare arm or sleeve all the way down — a hoodie has no bare forearm. */
    upperFill: 'skin' | 'shirt';
    lowerFill: 'skin' | 'shirt';
    /** The ink capsule under the limb, and the fill capsule over it. */
    edgeWidth: number;
    fillWidth: number;
    /** Short sleeve laid over the top of the upper arm. `null` for full sleeves. */
    sleeve?: { width: number; d: string; seam: string } | null;
    /** Left hand; the right is its reflection. */
    hand: string;
    crease?: string | null;
    /** A cuff line where a full sleeve ends. */
    cuff?: string | null;
    /** Round caps keep joints gap-free; square does too, without the curve. */
    cap?: 'round' | 'square';
  };
}

/**
 * Shifts a path authored purely from x/y pairs — used for the off-register
 * plates a two-colour print needs. Arc segments carry flags that are not
 * coordinates, so nothing containing one is ever passed through here.
 */
const offsetPath = (d: string, dx: number, dy: number): string => {
  let index = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (match) => {
    const shifted = Number(match) + (index++ % 2 === 0 ? dx : dy);
    return String(Math.round(shifted * 10) / 10);
  });
};

// ---------------------------------------------------------------------------
// House — the current drawing, unchanged. The baseline everything else is
// measured against: an egg head, a plain crew tee, bare arms resting in front.
// ---------------------------------------------------------------------------

const HOUSE: ArtStyle = {
  id: 'house',
  name: 'House',
  blurb: 'The current rig. Egg head, plain tee, graded ink — the baseline.',
  viewBox: { bust: '24 44 352 542', rig: '-40 -12 480 616' },
  // Light for the size of the shapes it outlines. A heavier line here makes the
  // whole figure read as a sticker; the grading between the three weights is
  // what says "drawn", not the weight itself.
  ink: { silhouette: 3.2, feature: 2.8, detail: 2.2 },
  head: {
    // An egg rather than an ellipse: straighter at the temples, widest at the
    // cheeks, rounded into the chin.
    path: 'M 200 68 C 238 68, 268 92, 268 140 C 268 192, 246 234, 200 234 '
      + 'C 154 234, 132 192, 132 140 C 132 92, 162 68, 200 68 Z',
    ear: {
      path: 'M 130 128 A 15 22 0 0 0 130 172 A 15 22 0 0 0 130 128 Z',
      fold: 'M 126 140 C 120 146, 120 158, 127 163',
    },
    // Tilted so the outer end sits lower: that tilt reads as relaxed, level
    // brows read as a stare, and inner-end-down reads as a scowl. Baked into the
    // art so `browL.rot` still means pure expression on top of it.
    brow: { d: 'M 162.7 117.5 L 183.5 114.2', width: 9 },
    nose: 'M 198 138 C 189 156, 181 169, 188 175 Q 197 180 205 173',
    blush: { cx: 152, cy: 176, rx: 18, ry: 10 },
  },
  face: {
    mouth: { cx: 200, cy: 188, width: 52, open: 44, minThickness: 2.5 },
    eye: { l: { cx: 175, cy: 138 }, r: { cx: 225, cy: 138 }, width: 32, open: 64 },
  },
  pupil: { r: 8, glint: 2.6, glintAt: { x: 4, y: -6 }, range: { x: 7, y: 6 } },
  torso: {
    neck: { x: 173, y: 188, width: 54, height: 86, rx: 16 },
    shirt: 'M 84 496 C 72 448, 72 384, 84 336 C 92 288, 116 256, 148 246 '
      + 'C 158 242, 166 244, 172 252 C 180 262, 190 266, 200 266 '
      + 'C 210 266, 220 262, 228 252 C 234 244, 242 242, 252 246 '
      + 'C 284 256, 308 288, 316 336 C 328 384, 328 448, 316 494 '
      + 'C 272 506, 128 506, 84 494 Z',
    shade: 'M 84 448 C 114 478, 158 488, 200 488 C 242 488, 286 478, 316 448 '
      + 'C 318 464, 317 480, 314 492 C 272 503, 128 503, 86 492 '
      + 'C 83 480, 82 464, 84 448 Z',
  },
  arm: {
    upperFill: 'skin',
    lowerFill: 'skin',
    edgeWidth: 44,
    fillWidth: 36,
    // Wider than the arm (or its outline pokes out onto the chest) and narrower
    // than the shirt (or it eats the shoulder). At the shoulder the arm reaches
    // x≈100 and the shirt x≈91, so 52 sits in the gap.
    sleeve: {
      width: 52,
      d: 'M 122 312 L 108 366',
      seam: 'M 86 348 L 83 359 A 26 26 0 0 0 133 373',
    },
    // A mitten: one tapered finger mass with the thumb as a bump on the inside
    // edge. Kept short on purpose — the idle loop folds both forearms inward,
    // and a longer hand makes the two collide at the pocket.
    hand: 'M 76 484 C 64 496, 60 518, 66 536 C 72 552, 92 556, 102 544 '
      + 'C 110 534, 112 512, 108 496 C 116 492, 120 482, 114 476 '
      + 'C 108 470, 98 472, 95 480 Z',
    crease: 'M 70 510 C 80 520, 94 520, 104 508',
  },
};

// ---------------------------------------------------------------------------
// Hoodie — the reference direction. Small head on a big soft mass, a cap, and
// sleeves all the way to the wrist so the only bare skin is the face and hands.
// ---------------------------------------------------------------------------

const HOODIE: ArtStyle = {
  id: 'hoodie',
  name: 'Hoodie',
  blurb: 'Reference direction: small head, big soft body, cap, full sleeves.',
  viewBox: { bust: '10 30 380 560', rig: '-52 -20 504 640' },
  ink: { silhouette: 5, feature: 4.5, detail: 3.5 },
  palette: { '--rig-cap': '#241d54', '--rig-hood': '#e3e5e6', '--rig-zip': '#eef1f0' },
  head: {
    path: 'M 200 64 C 238 64, 264 88, 264 132 C 264 182, 240 224, 200 224 '
      + 'C 160 224, 136 182, 136 132 C 136 88, 162 64, 200 64 Z',
    // The cap is one crown mass plus a brim that reads only in silhouette — a
    // brim with its own interior detail immediately looks like a logo.
    over: [
      {
        d: 'M 138 108 C 134 66, 163 42, 200 42 C 240 42, 268 68, 263 110 '
          + 'C 234 94, 168 94, 138 108 Z',
        fill: 'var(--rig-cap)',
        stroke: 'var(--rig-line)',
        width: 4.5,
      },
      {
        d: 'M 141 106 C 118 101, 99 107, 97 118 C 95 129, 122 130, 152 120 '
          + 'C 160 117, 157 108, 141 106 Z',
        fill: 'var(--rig-cap)',
        stroke: 'var(--rig-line)',
        width: 4.5,
      },
    ],
    ear: { path: 'M 137 126 A 13 19 0 0 0 137 164 A 13 19 0 0 0 137 126 Z' },
    brow: { d: 'M 160 118 L 186 112', width: 10 },
    nose: 'M 196 136 C 186 154, 178 168, 186 174 Q 196 179 205 171',
    blush: { cx: 156, cy: 176, rx: 17, ry: 9 },
  },
  face: {
    mouth: { cx: 200, cy: 186, width: 56, open: 44, minThickness: 3 },
    eye: { l: { cx: 176, cy: 138 }, r: { cx: 224, cy: 138 }, width: 30, open: 60 },
  },
  pupil: { r: 8.5, glint: 2.8, glintAt: { x: 4, y: -6 }, range: { x: 6, y: 5 } },
  torso: {
    neck: { x: 176, y: 186, width: 48, height: 88, rx: 16 },
    // Wide and soft, flaring toward the hem: the mass *is* the character, and
    // the head has to sit small on top of it for the proportion to read.
    shirt: 'M 54 500 C 34 448, 40 372, 66 324 C 88 282, 118 262, 148 256 '
      + 'C 158 252, 166 256, 172 264 C 181 276, 190 280, 200 280 '
      + 'C 210 280, 219 276, 228 264 C 234 256, 242 252, 252 256 '
      + 'C 282 262, 312 282, 334 324 C 360 372, 366 448, 346 500 '
      + 'C 276 522, 124 522, 54 500 Z',
    shade: 'M 54 452 C 96 490, 150 502, 200 502 C 250 502, 304 490, 346 452 '
      + 'C 350 470, 350 488, 346 500 C 276 520, 124 520, 54 500 '
      + 'C 50 488, 50 470, 54 452 Z',
    detail: [
      // The hood: a collar of lining that sits behind the neck and over the
      // shoulders. Drawn under the head so the jaw crops it.
      {
        d: 'M 158 252 C 166 280, 180 292, 200 292 C 220 292, 234 280, 242 252 '
          + 'C 264 262, 272 286, 264 304 C 240 318, 160 318, 136 304 '
          + 'C 128 286, 136 262, 158 252 Z',
        fill: 'var(--rig-hood)',
        stroke: 'var(--rig-line)',
        width: 4,
      },
      // The zip, and the two drawstrings hanging off the collar.
      { d: 'M 200 302 L 200 512', stroke: 'var(--rig-zip)', width: 6 },
      { d: 'M 186 306 C 182 330, 184 352, 190 366', stroke: 'var(--rig-zip)', width: 4 },
      { d: 'M 214 306 C 218 330, 216 352, 210 366', stroke: 'var(--rig-zip)', width: 4 },
      // One pocket seam per side, mirrored.
      { d: 'M 108 420 C 128 452, 156 466, 186 468', stroke: 'var(--rig-line)', width: 3.5, mirrored: true },
    ],
  },
  arm: {
    upperFill: 'shirt',
    lowerFill: 'shirt',
    edgeWidth: 62,
    fillWidth: 54,
    sleeve: null,
    hand: 'M 74 496 C 60 508, 56 532, 63 550 C 70 568, 92 572, 103 558 '
      + 'C 112 546, 114 522, 109 506 C 118 501, 122 490, 115 484 '
      + 'C 108 477, 97 480, 94 489 Z',
    crease: 'M 66 522 C 78 534, 94 534, 106 520',
    cuff: 'M 66 486 A 30 30 0 0 0 118 476',
  },
};

// ---------------------------------------------------------------------------
// Chunk — same streetwear read, pushed the other way: a big head on a squat
// body. The face gets the room, the body is a plinth.
// ---------------------------------------------------------------------------

const CHUNK: ArtStyle = {
  id: 'chunk',
  name: 'Chunk',
  blurb: 'Big head, squat body, huge eyes. The face carries everything.',
  viewBox: { bust: '14 6 372 588', rig: '-44 -40 488 660' },
  ink: { silhouette: 5.5, feature: 5, detail: 4 },
  palette: { '--rig-hair': '#2a1c16' },
  head: {
    path: 'M 200 30 C 254 30, 292 72, 292 134 C 292 198, 254 244, 200 244 '
      + 'C 146 244, 108 198, 108 134 C 108 72, 146 30, 200 30 Z',
    // A short crop, drawn as one mass with a fringe that breaks over the brow —
    // a hairline that runs straight across reads as a swim cap.
    over: [
      {
        d: 'M 106 132 C 104 68, 150 26, 200 26 C 252 26, 296 70, 294 134 '
          + 'C 286 106, 268 84, 244 74 C 232 92, 200 100, 170 90 '
          + 'C 146 84, 120 104, 106 132 Z',
        fill: 'var(--rig-hair)',
        stroke: 'var(--rig-line)',
        width: 5,
      },
    ],
    ear: { path: 'M 108 128 A 16 22 0 0 0 108 172 A 16 22 0 0 0 108 128 Z' },
    brow: { d: 'M 150 108 L 186 100', width: 12 },
    nose: 'M 198 156 C 192 168, 188 176, 194 180 Q 200 183 206 178',
    blush: { cx: 138, cy: 186, rx: 22, ry: 12 },
  },
  face: {
    // Eyes big and set wide; the mouth stays small so the eyes stay dominant.
    mouth: { cx: 200, cy: 204, width: 48, open: 44, minThickness: 3.5 },
    eye: { l: { cx: 166, cy: 146 }, r: { cx: 234, cy: 146 }, width: 44, open: 88 },
  },
  pupil: { r: 13, glint: 4.5, glintAt: { x: 5, y: -8 }, range: { x: 9, y: 8 } },
  torso: {
    neck: null,
    // No neck at all: the head sits straight on the shoulders, which is most of
    // what makes the proportion read as a chibi rather than a short adult.
    shirt: 'M 86 500 C 76 452, 80 388, 96 342 C 106 306, 124 268, 162 246 '
      + 'C 176 238, 224 238, 238 246 C 276 268, 294 306, 304 342 '
      + 'C 320 388, 324 452, 314 500 C 264 514, 136 514, 86 500 Z',
    shade: 'M 86 456 C 118 488, 158 498, 200 498 C 242 498, 282 488, 314 456 '
      + 'C 316 472, 316 488, 313 498 C 264 512, 136 512, 87 498 '
      + 'C 84 488, 84 472, 86 456 Z',
  },
  arm: {
    upperFill: 'skin',
    lowerFill: 'skin',
    edgeWidth: 52,
    fillWidth: 42,
    sleeve: {
      width: 56,
      d: 'M 122 312 L 110 356',
      seam: 'M 85 342 L 82 353 A 28 28 0 0 0 137 367',
    },
    hand: 'M 70 486 C 54 500, 50 528, 58 548 C 66 568, 92 572, 104 556 '
      + 'C 114 542, 116 516, 110 498 C 120 493, 124 481, 116 474 '
      + 'C 108 466, 96 470, 93 480 Z',
    crease: 'M 62 516 C 76 530, 94 530, 108 514',
  },
};

// ---------------------------------------------------------------------------
// Blocky — the same character built from straight edges and chamfers. Nothing
// here is drawn freehand; every curve is a corner radius.
// ---------------------------------------------------------------------------

const BLOCKY: ArtStyle = {
  id: 'blocky',
  name: 'Blocky',
  blurb: 'Straight edges and chamfers. Geometric, printable, no freehand curves.',
  viewBox: { bust: '24 44 352 542', rig: '-40 -12 480 616' },
  ink: { silhouette: 4.5, feature: 4, detail: 3 },
  head: {
    path: 'M 152 70 L 248 70 Q 268 70 269 92 L 271 186 Q 271 212 250 222 '
      + 'L 200 234 L 150 222 Q 129 212 129 186 L 131 92 Q 132 70 152 70 Z',
    ear: { path: 'M 136 138 L 114 138 Q 106 138 106 146 L 106 164 Q 106 172 114 172 L 136 172 Z' },
    brow: { d: 'M 160 112 L 188 112', width: 10 },
    nose: 'M 200 142 L 200 170 L 212 170',
    blush: { cx: 150, cy: 182, rx: 16, ry: 8 },
  },
  face: {
    mouth: { cx: 200, cy: 190, width: 50, open: 42, minThickness: 3 },
    eye: { l: { cx: 174, cy: 140 }, r: { cx: 226, cy: 140 }, width: 28, open: 56 },
  },
  pupil: { r: 7.5, glint: 2.4, glintAt: { x: 4, y: -5 }, range: { x: 6, y: 5 } },
  torso: {
    neck: { x: 178, y: 196, width: 44, height: 80, rx: 6 },
    shirt: 'M 88 498 L 88 348 L 126 282 Q 134 268 150 264 L 176 256 '
      + 'Q 186 270 200 270 Q 214 270 224 256 L 250 264 Q 266 268 274 282 '
      + 'L 312 348 L 312 498 Q 200 510 88 498 Z',
    shade: 'M 88 458 L 312 458 L 312 498 Q 200 510 88 498 Z',
  },
  arm: {
    upperFill: 'skin',
    lowerFill: 'skin',
    edgeWidth: 42,
    fillWidth: 34,
    sleeve: {
      width: 50,
      d: 'M 122 312 L 110 358',
      seam: 'M 87 344 L 85 358 L 135 372',
    },
    hand: 'M 72 486 L 72 540 Q 72 552 84 552 L 100 552 Q 112 552 112 540 '
      + 'L 112 496 Q 120 492 118 482 Q 114 472 104 476 L 96 482 Z',
    crease: 'M 72 512 L 112 512',
  },
};

// ---------------------------------------------------------------------------
// Linework — thin uniform ink, longer proportions, small features. The opposite
// bet to Chunk: the drawing carries it, not the shapes.
// ---------------------------------------------------------------------------

const LINEWORK: ArtStyle = {
  id: 'linework',
  name: 'Linework',
  blurb: 'Thin uniform ink, long neck, small features. Editorial rather than mascot.',
  viewBox: { bust: '30 40 340 552', rig: '-40 -12 480 616' },
  ink: { silhouette: 2.6, feature: 2.6, detail: 2 },
  head: {
    path: 'M 200 58 C 232 58, 253 82, 252 122 C 251 176, 234 228, 200 228 '
      + 'C 166 228, 149 176, 148 122 C 147 82, 168 58, 200 58 Z',
    ear: {
      path: 'M 149 128 A 12 18 0 0 0 149 164 A 12 18 0 0 0 149 128 Z',
      fold: 'M 146 138 C 141 143, 141 152, 147 156',
    },
    brow: { d: 'M 166 114 L 185 111', width: 5 },
    nose: 'M 199 140 C 193 158, 187 170, 193 175 Q 200 179 206 174',
    blush: { cx: 164, cy: 172, rx: 14, ry: 7 },
  },
  face: {
    mouth: { cx: 200, cy: 186, width: 42, open: 36, minThickness: 2 },
    eye: { l: { cx: 179, cy: 136 }, r: { cx: 221, cy: 136 }, width: 22, open: 44 },
  },
  pupil: { r: 5.5, glint: 1.8, glintAt: { x: 3, y: -4 }, range: { x: 5, y: 4 } },
  torso: {
    // A visible neck is most of this style: it is what stops the head sitting on
    // the shoulders like a mascot's.
    neck: { x: 184, y: 202, width: 34, height: 78, rx: 15 },
    shirt: 'M 96 498 C 88 452, 92 388, 106 344 C 116 306, 138 280, 166 272 '
      + 'C 176 268, 182 272, 187 280 C 191 288, 195 292, 200 292 '
      + 'C 205 292, 209 288, 213 280 C 218 272, 224 268, 234 272 '
      + 'C 262 280, 284 306, 294 344 C 308 388, 312 452, 304 498 '
      + 'C 268 508, 132 508, 96 498 Z',
    shade: 'M 96 462 C 126 486, 162 494, 200 494 C 238 494, 274 486, 304 462 '
      + 'C 305 476, 305 490, 303 498 C 268 507, 132 507, 97 498 '
      + 'C 95 490, 95 476, 96 462 Z',
  },
  arm: {
    upperFill: 'skin',
    lowerFill: 'skin',
    edgeWidth: 30,
    fillWidth: 25,
    sleeve: {
      width: 40,
      d: 'M 122 312 L 112 350',
      seam: 'M 94 338 L 92 348 A 20 20 0 0 0 130 358',
    },
    hand: 'M 80 486 C 72 496, 69 516, 74 532 C 79 546, 95 549, 103 538 '
      + 'C 109 529, 110 511, 107 498 C 113 494, 116 486, 111 481 '
      + 'C 106 476, 98 478, 96 485 Z',
    crease: 'M 76 508 C 84 516, 96 516, 104 506',
  },
};

// ---------------------------------------------------------------------------
// Bean — one continuous soft mass. No neck, no ears, no nose: a mascot that
// reads at 32px, at the cost of everything the face detail was buying.
// ---------------------------------------------------------------------------

const BEAN: ArtStyle = {
  id: 'bean',
  name: 'Bean',
  blurb: 'One soft mass. No neck, ears or nose — reads clearly at icon size.',
  viewBox: { bust: '16 20 368 570', rig: '-44 -24 488 648' },
  ink: { silhouette: 6, feature: 5, detail: 4 },
  head: {
    path: 'M 200 44 C 250 44, 288 84, 288 140 C 288 198, 250 240, 200 240 '
      + 'C 150 240, 112 198, 112 140 C 112 84, 150 44, 200 44 Z',
    ear: null,
    brow: { d: 'M 152 100 L 178 94', width: 10 },
    nose: null,
    blush: { cx: 140, cy: 180, rx: 21, ry: 11 },
  },
  face: {
    mouth: { cx: 200, cy: 192, width: 52, open: 48, minThickness: 4 },
    eye: { l: { cx: 168, cy: 142 }, r: { cx: 232, cy: 142 }, width: 38, open: 76 },
  },
  pupil: { r: 12, glint: 4, glintAt: { x: 5, y: -7 }, range: { x: 8, y: 7 } },
  torso: {
    neck: null,
    // A rounded pill that tucks under the head. The overlap is the join — there
    // is deliberately no shoulder line anywhere in this style.
    shirt: 'M 76 492 C 62 442, 66 380, 88 334 C 104 296, 132 250, 172 232 '
      + 'C 184 226, 216 226, 228 232 C 268 250, 296 296, 312 334 '
      + 'C 334 380, 338 442, 324 492 C 268 512, 132 512, 76 492 Z',
    shade: 'M 76 446 C 112 482, 156 494, 200 494 C 244 494, 288 482, 324 446 '
      + 'C 328 464, 328 482, 324 492 C 268 512, 132 512, 76 492 '
      + 'C 72 482, 72 464, 76 446 Z',
  },
  arm: {
    upperFill: 'shirt',
    lowerFill: 'shirt',
    edgeWidth: 58,
    fillWidth: 48,
    sleeve: null,
    hand: 'M 72 492 C 56 506, 52 534, 61 554 C 70 574, 96 576, 107 560 '
      + 'C 116 546, 117 520, 111 502 C 121 497, 125 484, 117 477 '
      + 'C 109 470, 96 474, 93 484 Z',
    crease: null,
    cuff: 'M 64 490 A 30 30 0 0 0 116 480',
  },
};

// ===========================================================================
// The radical end. Everything above is the same character redrawn; everything
// below changes what kind of picture it is.
// ===========================================================================

// ---------------------------------------------------------------------------
// Pixel — an 8-bit sprite. No curve survives anywhere: the silhouettes are
// staircases, the eyes and mouth swap the lens for its box finish, and the
// pupils are blocks. The trade is explicit — `mouthCurve` can only slide a bar,
// so a smile has to come from the eyes and brows.
// ---------------------------------------------------------------------------

const PIXEL: ArtStyle = {
  id: 'pixel',
  name: 'Pixel',
  blurb: '8-bit sprite. Staircase silhouettes, box eyes, square pupils, no curves at all.',
  viewBox: { bust: '24 40 352 546', rig: '-40 -12 480 616' },
  ink: { silhouette: 6, feature: 6, detail: 6 },
  head: {
    path: 'M 152 64 L 152 56 L 248 56 L 248 64 L 256 64 L 256 72 L 264 72 '
      + 'L 264 176 L 256 176 L 256 192 L 248 192 L 248 208 L 240 208 L 240 216 '
      + 'L 160 216 L 160 208 L 152 208 L 152 192 L 144 192 L 144 176 L 136 176 '
      + 'L 136 72 L 144 72 L 144 64 Z',
    ear: { path: 'M 138 128 L 120 128 L 120 168 L 138 168 Z' },
    brow: { d: 'M 158 104 L 190 104', width: 12, cap: 'butt' },
    nose: 'M 196 144 L 196 168 L 212 168',
    blush: null,
  },
  face: {
    mouth: { cx: 200, cy: 186, width: 40, open: 36, minThickness: 8, finish: 'box' },
    eye: { l: { cx: 174, cy: 134 }, r: { cx: 226, cy: 134 }, width: 24, open: 48, finish: 'box' },
  },
  pupil: { r: 6, glint: 0, glintAt: { x: 0, y: 0 }, range: { x: 5, y: 4 }, square: true },
  torso: {
    neck: { x: 180, y: 200, width: 40, height: 72, rx: 0 },
    shirt: 'M 96 496 L 96 368 L 104 368 L 104 320 L 112 320 L 112 280 L 136 280 '
      + 'L 136 264 L 168 264 L 168 256 L 232 256 L 232 264 L 264 264 L 264 280 '
      + 'L 288 280 L 288 320 L 296 320 L 296 368 L 304 368 L 304 496 Z',
    shade: 'M 96 456 L 304 456 L 304 496 L 96 496 Z',
  },
  arm: {
    upperFill: 'skin',
    lowerFill: 'skin',
    edgeWidth: 36,
    fillWidth: 28,
    cap: 'square',
    sleeve: {
      width: 44,
      d: 'M 122 312 L 112 356',
      seam: 'M 100 336 L 100 358 L 144 366',
    },
    hand: 'M 72 480 L 72 544 L 80 544 L 80 552 L 104 552 L 104 544 L 112 544 '
      + 'L 112 496 L 120 496 L 120 480 L 104 480 L 104 488 L 96 488 L 96 480 Z',
    crease: null,
  },
};

// ---------------------------------------------------------------------------
// Hose — 1930s rubber hose. A perfect circle for a head, tube arms with no
// elbow to speak of, white gloves, and a grin that takes up most of the face.
// The arms attach as visible stubs at the shoulder, which is the look, not a
// bug: this is the one style where the sleeve is deliberately absent.
// ---------------------------------------------------------------------------

const HOSE: ArtStyle = {
  id: 'hose',
  name: 'Hose',
  blurb: '1930s rubber hose. Circle head, tube arms, white gloves, enormous grin.',
  viewBox: { bust: '16 34 368 556', rig: '-40 -12 480 616' },
  ink: { silhouette: 5.5, feature: 5, detail: 4 },
  palette: { '--rig-hand': '#fbf7ee', '--rig-glint': '#ffffff', '--rig-skin-deep': '#b8b1a3' },
  head: {
    path: 'M 200 58 C 246 58, 280 92, 280 138 C 280 186, 246 220, 200 220 '
      + 'C 154 220, 120 186, 120 138 C 120 92, 154 58, 200 58 Z',
    ear: { path: 'M 126 116 A 22 22 0 0 0 126 160 A 22 22 0 0 0 126 116 Z' },
    brow: { d: 'M 164 98 L 186 94', width: 6 },
    nose: null,
    // The nose is a blob laid over the face, the way the period did it.
    over: [
      {
        d: 'M 200 148 C 212 148, 220 156, 220 165 C 220 174, 211 181, 200 181 '
          + 'C 189 181, 180 174, 180 165 C 180 156, 188 148, 200 148 Z',
        fill: 'var(--rig-skin-shade)',
        stroke: 'var(--rig-line)',
        width: 4,
      },
    ],
    blush: { cx: 148, cy: 178, rx: 20, ry: 11 },
  },
  face: {
    // Tall oval eyes and a grin wide enough to break the head's centre line.
    mouth: { cx: 200, cy: 196, width: 66, open: 44, minThickness: 15 },
    eye: { l: { cx: 178, cy: 130 }, r: { cx: 222, cy: 130 }, width: 26, open: 76 },
  },
  pupil: { r: 9, glint: 3, glintAt: { x: 4, y: -7 }, range: { x: 6, y: 6 } },
  torso: {
    neck: { x: 182, y: 196, width: 36, height: 80, rx: 14 },
    // A barrel, not a cone: the arms attach as visible tubes at the shoulder,
    // which only reads as period-correct if the mass under them is even.
    shirt: 'M 112 490 C 94 442, 94 370, 120 332 C 138 302, 164 284, 200 284 '
      + 'C 236 284, 262 302, 280 332 C 306 370, 306 442, 288 490 '
      + 'C 244 504, 156 504, 112 490 Z',
    shade: 'M 112 450 C 140 482, 170 492, 200 492 C 230 492, 260 482, 288 450 '
      + 'C 292 466, 292 482, 288 490 C 244 504, 156 504, 112 490 '
      + 'C 108 482, 108 466, 112 450 Z',
  },
  arm: {
    upperFill: 'skin',
    lowerFill: 'skin',
    edgeWidth: 36,
    fillWidth: 28,
    sleeve: null,
    hand: 'M 72 486 C 58 494, 52 514, 57 530 C 62 548, 86 558, 100 547 '
      + 'C 112 537, 116 516, 111 500 C 120 494, 122 482, 114 476 '
      + 'C 105 470, 94 474, 92 483 Z',
    crease: 'M 68 508 C 82 500, 98 502, 108 512',
    cuff: 'M 64 490 A 28 28 0 0 0 116 480',
  },
};

// ---------------------------------------------------------------------------
// Neon — the same lean geometry as Linework, treated as a sign: dark fills, a
// single glowing stroke colour, and a glow that lives in a CSS filter rather
// than in any path. Proof that a style can be almost entirely paint.
// ---------------------------------------------------------------------------

const NEON: ArtStyle = {
  ...LINEWORK,
  id: 'neon',
  name: 'Neon',
  blurb: 'Linework treated as a sign: dark fills, one glowing stroke, glow in the filter.',
  ink: { silhouette: 3, feature: 3, detail: 2.5 },
  filter: 'drop-shadow(0 0 4px rgb(79 245 214 / 85%)) drop-shadow(0 0 15px rgb(79 245 214 / 45%))',
  palette: {
    '--rig-skin': '#0a1020',
    '--rig-skin-shade': '#0a1020',
    '--rig-skin-deep': '#2f8fa0',
    '--rig-shirt': '#0a1020',
    '--rig-shirt-shade': '#101a30',
    '--rig-eye-white': '#0a1020',
    '--rig-pupil': '#4ff5d6',
    '--rig-brow': '#4ff5d6',
    '--rig-mouth': '#0a1020',
    '--rig-teeth': '#4ff5d6',
    '--rig-tongue': '#1c6f7d',
    '--rig-line': '#4ff5d6',
    '--rig-hand': '#0a1020',
    '--rig-glint': '#c9fff4',
    '--rig-blush': '#ff5ea8',
    '--rig-tear': '#4ff5d6',
  },
  torso: {
    ...LINEWORK.torso,
    shade: null,
    // Three tube runs across the chest — the only art this style adds.
    detail: [
      { d: 'M 118 372 C 152 392, 248 392, 282 372', stroke: 'var(--rig-line)', width: 2.5 },
      { d: 'M 108 412 C 148 434, 252 434, 292 412', stroke: 'var(--rig-line)', width: 2.5 },
      { d: 'M 102 452 C 146 476, 254 476, 298 452', stroke: 'var(--rig-line)', width: 2.5 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Riso — a two-colour print of Chunk. Everything collapses to one ink and one
// paper, the keyline is the *paper* colour so overlapping masses separate, and
// a spot plate sits deliberately off register behind the drawing.
// ---------------------------------------------------------------------------

const RISO_INK = '#1b1713';
const RISO_PAPER = '#f2ece0';
const RISO_SPOT = '#e2504a';
const RISO_SHIFT: [number, number] = [11, -9];

const RISO: ArtStyle = {
  ...CHUNK,
  id: 'riso',
  name: 'Riso',
  blurb: 'Two-colour print. One ink, paper keylines, a spot plate off register behind it.',
  ink: { silhouette: 3.5, feature: 3.5, detail: 3 },
  palette: {
    '--rig-skin': RISO_INK,
    '--rig-skin-shade': RISO_INK,
    '--rig-skin-deep': RISO_PAPER,
    '--rig-shirt': RISO_INK,
    '--rig-shirt-shade': RISO_INK,
    '--rig-hair': RISO_INK,
    '--rig-eye-white': RISO_PAPER,
    '--rig-pupil': RISO_INK,
    '--rig-brow': RISO_PAPER,
    '--rig-mouth': RISO_PAPER,
    '--rig-teeth': RISO_INK,
    '--rig-tongue': RISO_SPOT,
    '--rig-line': RISO_PAPER,
    '--rig-hand': RISO_INK,
    '--rig-glint': RISO_INK,
    '--rig-blush': RISO_SPOT,
    '--rig-tear': RISO_PAPER,
  },
  head: {
    ...CHUNK.head,
    behind: [{ d: offsetPath(CHUNK.head.path, ...RISO_SHIFT), fill: RISO_SPOT }],
  },
  torso: {
    ...CHUNK.torso,
    shade: null,
    behind: [{ d: offsetPath(CHUNK.torso.shirt, ...RISO_SHIFT), fill: RISO_SPOT }],
  },
};

// ---------------------------------------------------------------------------
// Sketch — the house drawing put through a displacement filter, so every edge
// wobbles the way a drawn one does, plus hatching on the shirt. Nothing here is
// a different shape; it is the same shapes drawn by a hand that isn't steady.
// ---------------------------------------------------------------------------

const SKETCH: ArtStyle = {
  ...HOUSE,
  id: 'sketch',
  name: 'Sketch',
  blurb: 'House, roughened. Every edge wobbles through a noise filter, shirt is hatched.',
  rough: true,
  ink: { silhouette: 3.5, feature: 3.5, detail: 2.5 },
  palette: {
    '--rig-line': '#2c2a25',
    '--rig-shirt-shade': '#0a4a28',
  },
  torso: {
    ...HOUSE.torso,
    detail: [
      { d: 'M 118 372 L 168 340', stroke: 'var(--rig-line)', width: 2 },
      { d: 'M 118 400 L 186 356', stroke: 'var(--rig-line)', width: 2 },
      { d: 'M 122 430 L 196 378', stroke: 'var(--rig-line)', width: 2 },
      { d: 'M 132 458 L 212 398', stroke: 'var(--rig-line)', width: 2 },
      { d: 'M 158 478 L 232 420', stroke: 'var(--rig-line)', width: 2 },
    ],
  },
};

// ===========================================================================
// House, shaded. Five ways to put light on the same drawing, from a painted-on
// terminator to real cast shadows that follow the pose.
//
// Every shadow here is **black at low opacity and every highlight is white**,
// never a skin colour: shading mixed from the palette bakes one skin into the
// art, and the whole point of a skin is that it swaps.
// ===========================================================================

/** The boundary of a light from the top left, drawn well outside the head. */
const HEAD_TERMINATOR = 'M 246 54 C 266 110, 264 192, 230 244 L 304 244 L 304 54 Z';
/** The jaw underside, where a head shades itself before anything else does. */
const HEAD_UNDERSIDE = 'M 118 194 C 150 246, 250 246, 282 194 L 282 252 L 118 252 Z';
/** Same light, carried onto the shirt. */
const SHIRT_TERMINATOR = 'M 248 236 C 268 318, 268 420, 244 512 L 344 512 L 344 236 Z';
/** The lit side of the shirt. Black alone barely registers on a dark garment. */
const SHIRT_KEY = 'M 132 240 C 108 320, 106 430, 124 512 L 60 512 L 60 240 Z';
/** What the head and neck drop onto the chest. */
const CHEST_OCCLUSION = 'M 138 248 C 158 294, 242 294, 262 248 '
  + 'C 272 262, 278 284, 272 300 C 240 318, 160 318, 128 300 '
  + 'C 122 284, 128 262, 138 248 Z';
/** A sliver along the lit edge — the last thing you add, and the most obvious. */
const HEAD_RIM = 'M 200 62 C 158 62, 130 92, 130 142 L 142 142 '
  + 'C 142 100, 166 74, 200 74 Z';

const HOUSE_CEL: ArtStyle = {
  ...HOUSE,
  id: 'houseCel',
  name: 'House · Cel',
  blurb: 'One hard terminator. Two tones per material, no blur anywhere.',
  shading: {
    gradients: [
      // A hard stop, so the arms take the same two tones as everything else.
      {
        id: 'celLimb',
        kind: 'linear',
        from: { x: 60, y: 0 },
        to: { x: 340, y: 0 },
        stops: [
          { at: 0.5, colour: '#000000', opacity: 0 },
          { at: 0.5, colour: '#000000', opacity: 0.17 },
          { at: 1, colour: '#000000', opacity: 0.17 },
        ],
      },
    ],
    head: [
      { d: HEAD_TERMINATOR, fill: '#000000', opacity: 0.15 },
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.13 },
    ],
    shirt: [
      { d: SHIRT_KEY, fill: '#ffffff', opacity: 0.1 },
      { d: SHIRT_TERMINATOR, fill: '#000000', opacity: 0.26 },
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.28 },
    ],
    limb: { stroke: 'url(#celLimb)', width: 36 },
  },
};

const HOUSE_SOFT: ArtStyle = {
  ...HOUSE,
  id: 'houseSoft',
  name: 'House · Soft',
  blurb: 'Gradients and blurred occlusion. Rounded masses, no hard terminator.',
  shading: {
    gradients: [
      {
        id: 'softSkin',
        kind: 'radial',
        from: { x: 166, y: 100 },
        r: 190,
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.32 },
          { at: 0.42, colour: '#ffffff', opacity: 0 },
          { at: 0.62, colour: '#000000', opacity: 0.04 },
          { at: 1, colour: '#000000', opacity: 0.34 },
        ],
      },
      {
        id: 'softShirt',
        kind: 'linear',
        from: { x: 96, y: 250 },
        to: { x: 316, y: 512 },
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.2 },
          { at: 0.38, colour: '#000000', opacity: 0 },
          { at: 1, colour: '#000000', opacity: 0.48 },
        ],
      },
      {
        id: 'softLimb',
        kind: 'linear',
        from: { x: 62, y: 0 },
        to: { x: 338, y: 0 },
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.16 },
          { at: 0.45, colour: '#000000', opacity: 0 },
          { at: 1, colour: '#000000', opacity: 0.3 },
        ],
      },
    ],
    head: [
      { d: HOUSE.head.path, fill: 'url(#softSkin)' },
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.22, filter: 'blur(9px)' },
    ],
    shirt: [
      { d: HOUSE.torso.shirt, fill: 'url(#softShirt)' },
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.36, filter: 'blur(11px)' },
    ],
    limb: { stroke: 'url(#softLimb)', width: 36 },
  },
};

const HOUSE_CAST: ArtStyle = {
  ...HOUSE,
  id: 'houseCast',
  name: 'House · Cast',
  blurb: 'Flat fills, real cast shadows. The only shading here that follows the pose.',
  shading: {
    // Filters on the head group and the arm instances, so the shadow is
    // computed from whatever the rig is doing rather than painted at rest.
    cast: {
      head: 'drop-shadow(7px 11px 5px rgb(16 13 12 / 32%))',
      arms: 'drop-shadow(9px 8px 6px rgb(16 13 12 / 30%))',
    },
  },
};

const HOUSE_DEPTH: ArtStyle = {
  ...HOUSE,
  id: 'houseDepth',
  name: 'House · Depth',
  blurb: 'Everything at once: gradients, occlusion, rim light, specular, cast shadows.',
  shading: {
    gradients: HOUSE_SOFT.shading?.gradients,
    head: [
      { d: HOUSE.head.path, fill: 'url(#softSkin)' },
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.24, filter: 'blur(8px)' },
      // Rim first, specular second: the rim describes the form, the specular
      // says what the surface is made of.
      { d: HEAD_RIM, fill: '#ffffff', opacity: 0.65, filter: 'blur(1.5px)' },
      {
        d: 'M 176 96 C 190 88, 206 90, 210 98 C 202 106, 184 108, 176 96 Z',
        fill: '#ffffff',
        opacity: 0.42,
        filter: 'blur(4px)',
      },
    ],
    shirt: [
      { d: HOUSE.torso.shirt, fill: 'url(#softShirt)' },
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.38, filter: 'blur(12px)' },
      {
        d: 'M 96 330 C 90 380, 90 440, 98 486 L 112 486 C 104 438, 104 380, 110 332 Z',
        fill: '#ffffff',
        opacity: 0.3,
        filter: 'blur(3px)',
      },
    ],
    limb: { stroke: 'url(#softLimb)', width: 36 },
    cast: {
      head: 'drop-shadow(5px 9px 7px rgb(16 13 12 / 28%))',
      arms: 'drop-shadow(7px 7px 8px rgb(16 13 12 / 26%))',
    },
  },
};

const HOUSE_NIGHT: ArtStyle = {
  ...HOUSE,
  id: 'houseNight',
  name: 'House · Night',
  blurb: 'The light moved. Cool ambient, warm rim from the right, everything else in shadow.',
  palette: {
    '--rig-skin': '#a97a56',
    '--rig-skin-shade': '#8d6244',
    '--rig-skin-deep': '#6d4931',
    '--rig-shirt': '#06341c',
    '--rig-shirt-shade': '#042313',
  },
  shading: {
    gradients: [
      {
        id: 'nightSkin',
        kind: 'linear',
        from: { x: 130, y: 0 },
        to: { x: 268, y: 0 },
        stops: [
          { at: 0, colour: '#0b1430', opacity: 0.45 },
          { at: 0.55, colour: '#0b1430', opacity: 0.22 },
          { at: 0.82, colour: '#ffb457', opacity: 0 },
          { at: 1, colour: '#ffb457', opacity: 0.8 },
        ],
      },
      {
        id: 'nightShirt',
        kind: 'linear',
        from: { x: 84, y: 0 },
        to: { x: 316, y: 0 },
        stops: [
          { at: 0, colour: '#0b1430', opacity: 0.5 },
          { at: 0.6, colour: '#0b1430', opacity: 0.28 },
          { at: 0.84, colour: '#ffb457', opacity: 0 },
          { at: 1, colour: '#ffb457', opacity: 0.6 },
        ],
      },
      {
        id: 'nightLimb',
        kind: 'linear',
        from: { x: 62, y: 0 },
        to: { x: 338, y: 0 },
        stops: [
          { at: 0, colour: '#0b1430', opacity: 0.42 },
          { at: 0.8, colour: '#0b1430', opacity: 0.2 },
          { at: 1, colour: '#ffb457', opacity: 0.3 },
        ],
      },
    ],
    head: [
      { d: HOUSE.head.path, fill: 'url(#nightSkin)' },
      { d: HEAD_UNDERSIDE, fill: '#0b1430', opacity: 0.4, filter: 'blur(8px)' },
    ],
    shirt: [
      { d: HOUSE.torso.shirt, fill: 'url(#nightShirt)' },
      { d: CHEST_OCCLUSION, fill: '#0b1430', opacity: 0.45, filter: 'blur(12px)' },
    ],
    limb: { stroke: 'url(#nightLimb)', width: 36 },
    cast: { head: 'drop-shadow(-8px 10px 8px rgb(6 10 26 / 45%))' },
  },
};

// ---------------------------------------------------------------------------
// The Depth family. `houseDepth` is the reference; everything below it changes
// either the *level* (how far the same recipe is pushed) or the *technique*
// (what the shadow is made of). They are meant to be compared, not merged.
// ---------------------------------------------------------------------------

/** Where the arms sit against the body — the contact a directional light misses. */
const SHOULDER_OCCLUSION = 'M 86 286 C 116 314, 128 378, 124 442 L 52 442 L 52 286 Z';
/** The hem, which is the other place a flat figure stops reading as solid. */
const HEM_OCCLUSION = 'M 84 474 C 132 502, 268 502, 316 474 L 316 524 L 84 524 Z';
/**
 * Tone needs area. A crescent that works as a soft gradient reads as a blemish
 * once it becomes dots, so the screened variants shade a broad third of each
 * mass and stack a denser band inside it.
 */
const TONE_HEAD = 'M 204 50 C 238 112, 236 198, 200 248 L 308 248 L 308 50 Z';
const TONE_HEAD_DEEP = 'M 248 50 C 268 112, 266 194, 238 248 L 308 248 L 308 50 Z';
const TONE_SHIRT = 'M 212 232 C 242 320, 242 426, 210 518 L 348 518 L 348 232 Z';
const TONE_SHIRT_DEEP = 'M 268 232 C 290 320, 290 426, 262 518 L 348 518 L 348 232 Z';

/** The inside of the shirt's own outline — volume with no light direction implied. */
const SHIRT_EDGE = HOUSE.torso.shirt;
const HEAD_EDGE = HOUSE.head.path;

/** The same recipe as `houseDepth`, at a fraction of the value. */
const DEPTH_WHISPER: ArtStyle = {
  ...HOUSE,
  id: 'depthWhisper',
  name: 'Depth · Whisper',
  blurb: 'The same recipe at a third of the value. Volume you notice only if you look.',
  shading: {
    gradients: [
      {
        id: 'whisperSkin',
        kind: 'radial',
        from: { x: 166, y: 100 },
        r: 190,
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.12 },
          { at: 0.45, colour: '#ffffff', opacity: 0 },
          { at: 1, colour: '#000000', opacity: 0.13 },
        ],
      },
      {
        id: 'whisperShirt',
        kind: 'linear',
        from: { x: 96, y: 250 },
        to: { x: 316, y: 512 },
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.08 },
          { at: 0.4, colour: '#000000', opacity: 0 },
          { at: 1, colour: '#000000', opacity: 0.18 },
        ],
      },
    ],
    head: [
      { d: HOUSE.head.path, fill: 'url(#whisperSkin)' },
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.1, filter: 'blur(10px)' },
    ],
    shirt: [
      { d: HOUSE.torso.shirt, fill: 'url(#whisperShirt)' },
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.16, filter: 'blur(13px)' },
    ],
    cast: { head: 'drop-shadow(3px 5px 6px rgb(16 13 12 / 14%))' },
  },
};

/** The same recipe pushed until it is doing the drawing. */
const DEPTH_BOLD: ArtStyle = {
  ...HOUSE,
  id: 'depthBold',
  name: 'Depth · Bold',
  blurb: 'The same recipe pushed hard. Reads at thumbnail size, at the cost of subtlety.',
  shading: {
    gradients: [
      {
        id: 'boldSkin',
        kind: 'radial',
        from: { x: 162, y: 94 },
        r: 175,
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.45 },
          { at: 0.36, colour: '#ffffff', opacity: 0 },
          { at: 0.55, colour: '#000000', opacity: 0.08 },
          { at: 1, colour: '#000000', opacity: 0.52 },
        ],
      },
      {
        id: 'boldShirt',
        kind: 'linear',
        from: { x: 92, y: 244 },
        to: { x: 320, y: 514 },
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.28 },
          { at: 0.34, colour: '#000000', opacity: 0 },
          { at: 1, colour: '#000000', opacity: 0.62 },
        ],
      },
      {
        id: 'boldLimb',
        kind: 'linear',
        from: { x: 62, y: 0 },
        to: { x: 338, y: 0 },
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.24 },
          { at: 0.42, colour: '#000000', opacity: 0 },
          { at: 1, colour: '#000000', opacity: 0.45 },
        ],
      },
    ],
    head: [
      { d: HOUSE.head.path, fill: 'url(#boldSkin)' },
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.4, filter: 'blur(7px)' },
      { d: HEAD_RIM, fill: '#ffffff', opacity: 0.85, filter: 'blur(1px)' },
      {
        d: 'M 172 92 C 190 82, 210 86, 214 96 C 204 106, 182 108, 172 92 Z',
        fill: '#ffffff',
        opacity: 0.6,
        filter: 'blur(3px)',
      },
    ],
    shirt: [
      { d: HOUSE.torso.shirt, fill: 'url(#boldShirt)' },
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.5, filter: 'blur(10px)' },
      { d: SHOULDER_OCCLUSION, fill: '#000000', opacity: 0.34, filter: 'blur(12px)', mirrored: true },
    ],
    limb: { stroke: 'url(#boldLimb)', width: 36 },
    cast: {
      head: 'drop-shadow(8px 13px 5px rgb(16 13 12 / 42%))',
      arms: 'drop-shadow(10px 9px 6px rgb(16 13 12 / 38%))',
    },
  },
};

/**
 * No light direction at all — only the contacts. This is the honest minimum: a
 * figure reads as solid because of where its forms *meet*, not because of a
 * terminator, and nothing here has to be re-authored if the light changes.
 */
const DEPTH_OCCLUSION: ArtStyle = {
  ...HOUSE,
  id: 'depthOcclusion',
  name: 'Depth · Occlusion',
  blurb: 'Contact shadows only — jaw, collar, shoulders, hem. No light direction implied.',
  shading: {
    head: [
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.26, filter: 'blur(10px)' },
    ],
    shirt: [
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.42, filter: 'blur(12px)' },
      { d: SHOULDER_OCCLUSION, fill: '#000000', opacity: 0.32, filter: 'blur(14px)', mirrored: true },
      { d: HEM_OCCLUSION, fill: '#000000', opacity: 0.3, filter: 'blur(12px)' },
    ],
  },
};

/**
 * Volume from the silhouette inwards: the outline stroked thickly and clipped
 * to its own shape, so only the inner half survives. Also light-agnostic, and
 * the cheapest way to stop a flat fill reading as a sticker.
 */
const DEPTH_EDGE: ArtStyle = {
  ...HOUSE,
  id: 'depthEdge',
  name: 'Depth · Edge',
  blurb: 'Darkened from the silhouette inwards. Volume without picking a light direction.',
  shading: {
    head: [
      { d: HEAD_EDGE, stroke: '#000000', width: 30, opacity: 0.3, filter: 'blur(9px)' },
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.18, filter: 'blur(10px)' },
    ],
    shirt: [
      { d: SHIRT_EDGE, stroke: '#000000', width: 44, opacity: 0.36, filter: 'blur(12px)' },
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.3, filter: 'blur(12px)' },
    ],
    limb: { stroke: 'url(#edgeLimb)', width: 36 },
    gradients: [
      {
        id: 'edgeLimb',
        kind: 'linear',
        from: { x: 62, y: 0 },
        to: { x: 338, y: 0 },
        stops: [
          { at: 0, colour: '#000000', opacity: 0.22 },
          { at: 0.5, colour: '#000000', opacity: 0 },
          { at: 1, colour: '#000000', opacity: 0.22 },
        ],
      },
    ],
  },
};

/**
 * A hard core shadow for the form and soft occlusion for the contacts. The two
 * jobs shading does, each done with the tool that suits it — this is the one
 * that stays graphic while still sitting in a space.
 */
const DEPTH_HYBRID: ArtStyle = {
  ...HOUSE,
  id: 'depthHybrid',
  name: 'Depth · Hybrid',
  blurb: 'Hard core shadow for form, soft occlusion for contact. Graphic but grounded.',
  shading: {
    gradients: [
      {
        id: 'hybridLimb',
        kind: 'linear',
        from: { x: 60, y: 0 },
        to: { x: 340, y: 0 },
        stops: [
          { at: 0.52, colour: '#000000', opacity: 0 },
          { at: 0.52, colour: '#000000', opacity: 0.2 },
          { at: 1, colour: '#000000', opacity: 0.2 },
        ],
      },
    ],
    head: [
      { d: HEAD_TERMINATOR, fill: '#000000', opacity: 0.17 },
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.24, filter: 'blur(9px)' },
      { d: HEAD_RIM, fill: '#ffffff', opacity: 0.5, filter: 'blur(1.5px)' },
    ],
    shirt: [
      { d: SHIRT_KEY, fill: '#ffffff', opacity: 0.1 },
      { d: SHIRT_TERMINATOR, fill: '#000000', opacity: 0.26 },
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.34, filter: 'blur(12px)' },
      { d: SHOULDER_OCCLUSION, fill: '#000000', opacity: 0.24, filter: 'blur(14px)', mirrored: true },
    ],
    limb: { stroke: 'url(#hybridLimb)', width: 36 },
    headShadow: { dx: 7, dy: 12, opacity: 0.3, blur: 5 },
    armShadow: { dx: 8, dy: 10, opacity: 0.26, blur: 6 },
  },
};

/**
 * Screen tone: the shade side as a dot pattern instead of a value. Three
 * densities stacked is how print graded before it could blur, and it holds the
 * flat-ink house style completely — nothing here is a gradient.
 */
const DEPTH_HALFTONE: ArtStyle = {
  ...HOUSE,
  id: 'depthHalftone',
  name: 'Depth · Halftone',
  blurb: 'Screen tone. The shade side is dots, not value — no gradient anywhere.',
  shading: {
    patterns: [
      { id: 'toneLight', kind: 'dots', size: 9, weight: 1.5, colour: '#100d0c', opacity: 0.55 },
      { id: 'toneMid', kind: 'dots', size: 9, weight: 2.4, colour: '#100d0c', opacity: 0.6 },
      { id: 'toneDark', kind: 'dots', size: 9, weight: 3.4, colour: '#100d0c', opacity: 0.65 },
    ],
    head: [
      { d: TONE_HEAD, fill: 'url(#toneLight)' },
      { d: TONE_HEAD_DEEP, fill: 'url(#toneMid)' },
      { d: HEAD_UNDERSIDE, fill: 'url(#toneMid)' },
    ],
    shirt: [
      { d: TONE_SHIRT, fill: 'url(#toneLight)' },
      { d: TONE_SHIRT_DEEP, fill: 'url(#toneMid)' },
      { d: CHEST_OCCLUSION, fill: 'url(#toneDark)' },
      { d: HEM_OCCLUSION, fill: 'url(#toneMid)' },
    ],
  },
};

/**
 * The same idea with line hatching instead of dots, at two densities. Reads as
 * drawn rather than printed, and it is the only technique here that survives
 * being reproduced in one colour at any size.
 */
const DEPTH_HATCH: ArtStyle = {
  ...HOUSE,
  id: 'depthHatch',
  name: 'Depth · Hatch',
  blurb: 'Cross-hatched shade at two densities. Reads as drawn, survives one-colour print.',
  shading: {
    patterns: [
      { id: 'hatchThin', kind: 'lines', size: 9, weight: 1.6, colour: '#100d0c', opacity: 0.4, angle: 45 },
      { id: 'hatchThick', kind: 'lines', size: 8, weight: 2.6, colour: '#100d0c', opacity: 0.5, angle: 45 },
      { id: 'hatchCross', kind: 'lines', size: 8, weight: 2.2, colour: '#100d0c', opacity: 0.4, angle: -45 },
    ],
    head: [
      { d: TONE_HEAD, fill: 'url(#hatchThin)' },
      { d: TONE_HEAD_DEEP, fill: 'url(#hatchCross)' },
      { d: HEAD_UNDERSIDE, fill: 'url(#hatchThin)' },
    ],
    shirt: [
      { d: TONE_SHIRT, fill: 'url(#hatchThick)' },
      { d: TONE_SHIRT_DEEP, fill: 'url(#hatchCross)' },
      { d: CHEST_OCCLUSION, fill: 'url(#hatchCross)' },
      { d: HEM_OCCLUSION, fill: 'url(#hatchThin)' },
    ],
    headShadow: { dx: 6, dy: 12, opacity: 0.16 },
  },
};

/**
 * Occlusion plus a single hard cast shadow with no blur at all — the paper-cut
 * read. Everything is either lit or not; nothing is in between.
 */
const DEPTH_CUT: ArtStyle = {
  ...HOUSE,
  id: 'depthCut',
  name: 'Depth · Cut',
  blurb: 'Paper cut: flat fills, one hard unblurred cast shadow, nothing in between.',
  shading: {
    head: [
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.14 },
    ],
    shirt: [
      { d: CHEST_OCCLUSION, fill: '#000000', opacity: 0.2 },
    ],
    headShadow: { dx: 13, dy: 16, opacity: 0.24 },
    armShadow: { dx: 13, dy: 16, opacity: 0.2 },
  },
};

/**
 * Occlusion plus the head's real shadow on the chest. No filters, so nothing
 * lands on the background: this is the same idea as `houseDepth`'s cast, done
 * the way that survives being looked at.
 */
const DEPTH_GROUNDED: ArtStyle = {
  ...HOUSE,
  id: 'depthGrounded',
  name: 'Depth · Grounded',
  blurb: 'Occlusion + a real head shadow on the chest, clipped to the body. Nothing spills.',
  shading: {
    gradients: [
      {
        id: 'groundedSkin',
        kind: 'radial',
        from: { x: 168, y: 104 },
        r: 190,
        stops: [
          { at: 0, colour: '#ffffff', opacity: 0.22 },
          { at: 0.44, colour: '#ffffff', opacity: 0 },
          { at: 1, colour: '#000000', opacity: 0.26 },
        ],
      },
    ],
    head: [
      { d: HOUSE.head.path, fill: 'url(#groundedSkin)' },
      { d: HEAD_UNDERSIDE, fill: '#000000', opacity: 0.2, filter: 'blur(9px)' },
    ],
    shirt: [
      { d: SHOULDER_OCCLUSION, fill: '#000000', opacity: 0.26, filter: 'blur(14px)', mirrored: true },
      { d: HEM_OCCLUSION, fill: '#000000', opacity: 0.26, filter: 'blur(12px)' },
    ],
    headShadow: { dx: 8, dy: 14, opacity: 0.34, blur: 7 },
    armShadow: { dx: 9, dy: 11, opacity: 0.3, blur: 7 },
  },
};

// ---------------------------------------------------------------------------
// Arms. `depthWhisper` is the settled character, so every arm variant is that
// drawing with a different limb rig underneath — the only thing changing across
// the row is what an arm is made of.
// ---------------------------------------------------------------------------

const armVariant = (rig: ArmRig): ArtStyle => ({
  ...DEPTH_WHISPER,
  id: `arm${rig.id.charAt(0).toUpperCase()}${rig.id.slice(1)}`,
  name: `Arms · ${rig.name}`,
  blurb: rig.blurb,
  // The sleeve takes the shirt's own gradient, so the shoulder is one garment.
  shading: { ...DEPTH_WHISPER.shading, sleeve: 'url(#whisperShirt)' },
  arm: { ...HOUSE.arm, rig },
});

/** Ordered old-to-new, so the first is what we had. In the Storybook gallery. */
export const ARM_VARIANTS: ArtStyle[] = ARM_RIGS.map(armVariant);

/**
 * The arm that won: no ink on the limbs, so the shading alone says where the arm
 * is. This is the one the demo page shows.
 */
export const HOUSE_ARMS: ArtStyle = armVariant(ARM_NO_INK);

// ---------------------------------------------------------------------------
// Bodies. The house torso is a barrel — its sides bow out past the hem, which
// reads as a pear. These three are the same character on the same arm rig with
// a straighter shirt under it, from softly rectangular to a hard slab.
//
// Both silhouette rules still bind: the shirt has to clear x=96 at the shoulder
// (the sleeve capsule reaches that far) and top out well above y=286 there.
// ---------------------------------------------------------------------------

interface Body {
  id: string;
  name: string;
  blurb: string;
  /** The shirt silhouette, authored full-width — the torso is not mirrored. */
  shirt: string;
  /** The hem band. Drawn unclipped, so it has to sit inside `shirt`. */
  shade: string;
}

const bodyVariant = ({ id, name, blurb, shirt, shade }: Body): ArtStyle => ({
  ...HOUSE_ARMS,
  id,
  name,
  blurb,
  torso: { ...HOUSE_ARMS.torso, shirt, shade },
  shading: {
    ...HOUSE_ARMS.shading,
    // The first shirt layer paints the gradient onto the silhouette itself, so
    // it has to be *this* body's path. The clip alone would leave the corners
    // this shape has and the house one doesn't unpainted.
    shirt: [
      { d: shirt, fill: 'url(#whisperShirt)' },
      ...(HOUSE_ARMS.shading?.shirt ?? []).slice(1),
    ],
  },
});

/** Vertical sides, square-ish shoulders, straight hem. The middle option. */
const BODY_BOXY = bodyVariant({
  id: 'bodyBoxy',
  name: 'Body · Boxy',
  blurb: 'Dead-straight sides and a flat hem, with the shoulders still rounded off.',
  shirt: 'M 88 500 L 88 292 C 88 266, 102 252, 126 248 L 150 244 '
    + 'C 158 242, 166 244, 172 252 C 180 262, 190 266, 200 266 '
    + 'C 210 266, 220 262, 228 252 C 234 244, 242 242, 250 244 '
    + 'L 274 248 C 298 252, 312 266, 312 292 L 312 500 Z',
  shade: 'M 92 456 L 308 456 L 308 496 L 92 496 Z',
});

/** The hard read: wider, flat-topped shoulders, corners barely rounded. */
const BODY_SLAB = bodyVariant({
  id: 'bodySlab',
  name: 'Body · Slab',
  blurb: 'Wider and flatter — a hanging tee. Squarest shoulders, sharpest corners.',
  shirt: 'M 76 504 L 76 274 Q 76 252, 98 248 L 150 240 '
    + 'C 158 238, 166 242, 172 252 C 180 262, 190 266, 200 266 '
    + 'C 210 266, 220 262, 228 252 C 234 242, 242 238, 250 240 '
    + 'L 302 248 Q 324 252, 324 274 L 324 504 Z',
  shade: 'M 80 458 L 320 458 L 320 500 L 80 500 Z',
});

/**
 * The soft read, drawn off a body rather than a box. Three things do the work,
 * and all three are what a vertical-sided rectangle was missing:
 *
 *  1. A **trapezius**: one shallow run from the base of the neck out to the
 *     acromion, bowed very slightly upward the way the muscle is. No corner in
 *     it — a shoulder that turns down in five units of height reads as a box
 *     with a lid, however round the rest of the drawing is.
 *  2. A **deltoid**: the trap turns through it into the side, and it is the
 *     widest point of the figure. It also has a job — the sleeve is an uninked
 *     shape drawn on top of the shirt, so wherever the sleeve escapes past this
 *     outline, the outline is what you see drawn across the sleeve. The deltoid
 *     has to cover the arm from the cap down to the sleeve's hem. `arm.pull`
 *     brings the limb in to meet it; between them there is no crossing until
 *     the bare forearm leaves the body, which is what a forearm should do.
 *  3. A **straight side**, deltoid to waist, then a flare out to the hem. Any
 *     curve in this run reads as a bulging ribcage, so there isn't one — the
 *     control points are the thirds of the line, which is how you spell
 *     "straight" in a cubic.
 *
 * Only the left half is written; the right is the same numbers about x=200.
 * Every measurement is a **half-width**, so a bigger number is a narrower body.
 */
/**
 * Where the deltoid stops being the widest point and the straight side starts.
 * Sits at the sleeve's widest, not above it: the sleeve's hem is a round cap and
 * that cap is the part most likely to escape the shirt.
 */
const DELTOID_Y = 345;

const softboxShirt = (
  { chest, waist, hem, acromion }: { chest: number; waist: number; hem: number; acromion: number },
) => {
  // The side, as a straight line from the waist up to the deltoid.
  const run = (share: number) => ({
    x: Math.round(waist + (chest - waist) * share),
    y: Math.round(440 + (DELTOID_Y - 440) * share),
  });
  const [side1, side2] = [run(1 / 3), run(2 / 3)];

  return `M ${hem} 500 C ${hem + 1} 482, ${waist - 1} 458, ${waist} 440 `
    + `C ${side1.x} ${side1.y}, ${side2.x} ${side2.y}, ${chest} ${DELTOID_Y} `
    + `C ${chest} 315, ${chest + 4} 290, ${acromion} 282 `
    + `C ${acromion + 20} 268, 158 258, 172 256 `
    + 'C 180 264, 190 268, 200 268 '
    + 'C 210 268, 220 264, 228 256 '
    + `C 242 258, ${380 - acromion} 268, ${400 - acromion} 282 `
    + `C ${396 - chest} 290, ${400 - chest} 315, ${400 - chest} ${DELTOID_Y} `
    + `C ${400 - side2.x} ${side2.y}, ${400 - side1.x} ${side1.y}, ${400 - waist} 440 `
    + `C ${401 - waist} 458, ${399 - hem} 482, ${400 - hem} 500 `
    + `C ${358 - hem} 508, ${hem + 42} 508, ${hem} 500 Z`;
};

/** The hem band, inset ~3 inside the same silhouette so it never eats the ink. */
const softboxShade = ({ waist, hem }: { waist: number; hem: number }) =>
  `M ${waist + 3} 452 C ${waist + 22} 476, 160 486, 200 486 `
  + `C 240 486, ${378 - waist} 476, ${397 - waist} 452 `
  + `C ${398 - waist} 470, ${396 - hem} 484, ${397 - hem} 496 `
  + `C ${355 - hem} 503, ${hem + 45} 503, ${hem + 3} 496 `
  + `C ${hem + 4} 484, ${waist + 2} 470, ${waist + 3} 452 Z`;

interface SoftBody extends Omit<Body, 'shirt' | 'shade'> {
  /** Half-width across the chest at y=340, and with it the whole shoulder line. */
  chest: number;
  /** Half-width of the torso at the ribs, y=440. Bigger is a tighter waist. */
  waist: number;
  /** Half-width at the hem, y=500 — where the shirt flares back out. */
  hem: number;
  /** Where the trap slope ends and the deltoid turns down, y=282. */
  acromion?: number;
}

const softboxBody = ({ chest, waist, hem, acromion = 118, ...body }: SoftBody): ArtStyle => bodyVariant({
  ...body,
  shirt: softboxShirt({ chest, waist, hem, acromion }),
  shade: softboxShade({ waist, hem }),
});

const BODY_SOFTBOX = softboxBody({
  id: 'bodySoftbox',
  name: 'Body · Softbox',
  blurb: 'Straight-hanging, but off a real shoulder line: sloped traps, round deltoid, soft waist.',
  chest: 84,
  waist: 88,
  hem: 86,
});

/** Soft to hard, so the row reads left-to-right. */
export const BODY_VARIANTS: ArtStyle[] = [BODY_SOFTBOX, BODY_BOXY, BODY_SLAB];

// ---------------------------------------------------------------------------
// Shoulder joint. The skeleton hinges the arm at x=122, which is the middle of
// the shoulder — so a raised arm swings out of the chest rather than off the
// joint you can see. This moves it outboard along the shoulder line.
//
// How far out it can go is set by the drawing, not by taste: the limb starts at
// this point and its root half-width is ~21, so the shirt edge is the hard stop.
// Past it the bare shoulder pokes out of the sleeve, and the spec says so.
// ---------------------------------------------------------------------------

/**
 * Where the shoulder ended up: halfway out, hinging under the sleeve rather
 * than under the collar. Height is the skeleton's own.
 */
const SETTLED_SHOULDER = { x: 110, y: 312 };

/**
 * Chosen from 116 / 110 / 104 against the body as it was then. Those three are
 * gone: the silhouette has been straightened since, and a comparison row drawn
 * on a body that no longer exists is worse than no row at all. To run it again,
 * spread this into `arm.shoulder` with a different `x`.
 */

// ---------------------------------------------------------------------------
// Shoulder line. The frame is settled at 196 across — 1.44 head widths, where it
// was 1.7 — so the remaining question is the corner the shoulder turns through.
//
// The waist and hem sit off the chest rather than being authored: held fixed
// while the shoulders narrowed, they would have ended up *wider* than the chest
// and the figure would read as bottom-heavy instead of narrower. Ribs 10 in,
// hem 2. The shoulder joint tracks the frame too, or the arm hangs off a
// shoulder that is no longer under it.
// ---------------------------------------------------------------------------

const SETTLED_FRAME = { chest: 102, waist: 112, hem: 104 };

/**
 * The figure, settled, and `DEFAULT_ART_STYLE`. Every choice in one style: the
 * uninked arm rig, the softbox torso at 196 across, the shoulder joint out at
 * 128, and the limb pulled in far enough that the sleeve stays under the
 * deltoid the whole way to its hem.
 *
 * 21 is not a taste number. The sleeve reaches its widest ~40 below the joint,
 * and at this frame that put it 12 outside the shirt — which is the outline
 * drawn across the sleeve that this is here to stop. Measured back: 16 still
 * left 2 outside, 21 puts it ~2 inside all the way to the hem.
 */
export const HOUSE_FIGURE: ArtStyle = (() => {
  const body = softboxBody({
    ...SETTLED_FRAME,
    id: 'houseFigure',
    name: 'The figure',
    blurb: 'Settled: 196 frame, trap into deltoid, arms pulled in to sit under the sleeve.',
  });
  return {
    ...body,
    arm: {
      ...body.arm,
      shoulder: { ...SETTLED_SHOULDER, x: SETTLED_SHOULDER.x + (SETTLED_FRAME.chest - 84) },
      pull: 21,
    },
  };
})();

/** The Depth family: the flat baseline, then the spread it was chosen from. */
export const HOUSE_DEPTH_FAMILY: ArtStyle[] = [
  HOUSE,
  HOUSE_DEPTH,
  DEPTH_WHISPER,
  DEPTH_BOLD,
  DEPTH_HYBRID,
  DEPTH_GROUNDED,
  DEPTH_OCCLUSION,
  DEPTH_EDGE,
  DEPTH_CUT,
  DEPTH_HALFTONE,
  DEPTH_HATCH,
];

/** The House family: the baseline first, then five lighting treatments of it. */
export const HOUSE_SHADING: ArtStyle[] = [
  HOUSE,
  HOUSE_CEL,
  HOUSE_SOFT,
  HOUSE_CAST,
  HOUSE_DEPTH,
  HOUSE_NIGHT,
];

export const ART_STYLES: ArtStyle[] = [
  HOUSE,
  HOODIE,
  CHUNK,
  BLOCKY,
  LINEWORK,
  BEAN,
  PIXEL,
  HOSE,
  NEON,
  RISO,
  SKETCH,
  ...HOUSE_SHADING.slice(1),
  ...HOUSE_DEPTH_FAMILY.slice(2),
  ...ARM_VARIANTS,
  ...BODY_VARIANTS,
  HOUSE_FIGURE,
];

export const STYLES_BY_ID: Record<string, ArtStyle> = Object.fromEntries(
  ART_STYLES.map(style => [style.id, style]),
);

/**
 * What the rig draws when nobody says otherwise, and what the editor authors
 * against. Everything else in this file is the spread it was chosen from.
 *
 * Keep a **fingered** rig here: the editor has no style picker, and authoring a
 * hand pose against a mitten is authoring blind.
 */
export const DEFAULT_ART_STYLE: ArtStyle = HOUSE_FIGURE;
