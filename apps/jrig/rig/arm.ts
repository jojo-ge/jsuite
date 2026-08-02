// Procedural arms and hands.
//
// The old arms were three stroked bones stacked on top of each other, each with
// its own dark edge capsule under its own fill. That is why they read as a
// string of sausages: every joint drew a second outline *inside* the limb, and a
// stroke has one width, so nothing could taper. Both problems are the same
// problem — the arm was three drawings, not one.
//
// So this file builds one shape instead. Every bone in the chain (and every
// finger) becomes a variable-width tube, all of them are unioned by drawing them
// into a single ink pass and then a single fill pass, and the outline that
// survives is only the outside of the union. There is no seam to see because
// there is no seam: an elbow is a bend in one silhouette.
//
// Everything is computed in *chest* space (see `computeSubtreeMatrices`), which
// is the space the static art was authored in, so the renderer can drop these
// paths into exactly the group the old paths lived in.

import type { Joint, JointId, Matrix, Pose } from './core';

import { computeSubtreeMatrices, DIGITS, jointPivot, JOINTS_BY_ID, jointTip, withArmsAt } from './core';

export interface Point {
  x: number;
  y: number;
}

type Matrices = Partial<Record<JointId, Matrix>>;
/** The joint map this arm is being built against — the shared one, or a moved one. */
type Skeleton = Record<JointId, Joint>;

/** A half-width at a fraction along the chain. `at` runs shoulder 0 → wrist 1. */
export interface TaperStop {
  at: number;
  r: number;
}

export interface DigitWidth {
  root: number;
  tip: number;
}

export interface HandRig {
  /** `mitten` keeps the palm and thumb and drops the fingers. */
  kind: 'fingers' | 'mitten';
  /** Fingers to draw, from the index outward. The thumb is always drawn. */
  count?: 3 | 4;
  palm: {
    wrist: number;
    knuckle: number;
    /** How far a mitten runs past the knuckles, where fingers would have been. */
    overshoot?: number;
  };
  finger: DigitWidth;
  thumb: DigitWidth;
}

export interface ArmRig {
  id: string;
  name: string;
  /** What this variant is testing — shown in the gallery. */
  blurb: string;
  /** Half-widths along the arm. Between stops it interpolates linearly. */
  taper: TaperStop[];
  /**
   * How far the centreline is pulled off the bones and onto a spline through
   * them, 0..1. At 0 the elbow is a corner; at 1 it is a curve. This is the
   * single biggest lever on whether a bent arm reads as an arm or as tubing.
   */
  smooth: number;
  /** Outline weight. 0 draws no outline at all — the fill has to carry it. */
  ink: number;
  hand: HandRig;
  /**
   * Short sleeve over the top of the upper arm. `hem` is a fraction of the way
   * down the arm. `swell` widens it past the limb — keep it at 0 unless the
   * sleeve is also inked, because an uninked lip of shirt poking out past the
   * arm's outline reads as a rendering bug rather than as cloth.
   */
  sleeve?: { hem: number; swell: number } | null;
  /**
   * Interior linework. `none` leaves the hand a paddle — the fingers overlap, so
   * without a line between them the union has nothing to say they exist.
   */
  creases: 'none' | 'soft' | 'inked';
  /**
   * Ink and fill each bone separately, the way the old arm did. Kept so the
   * thing we are trying to get away from is on the page next to the thing we
   * replaced it with.
   */
  segmented?: boolean;
}

export interface LimbLine {
  d: string;
  kind: 'crease' | 'digit';
}

export interface ArmGeometry {
  /**
   * Ordered groups of shapes. Each group is inked once and then filled once, so
   * a group is a union with a single outline; several groups stack outlines the
   * way the old per-bone drawing did.
   */
  groups: string[][];
  /**
   * Painted over the top of the limb and never inked. An outlined sleeve rings
   * the shoulder in black *inside* the shirt and immediately reads as a shoulder
   * pad — the shirt's own silhouette is what carries the shoulder, and the
   * sleeve only has to say where it ends.
   */
  sleeve: string | null;
  /**
   * That ending: the hem, and the only line the sleeve is allowed. Inked at the
   * limb's own weight, so a limb with no ink has no hem either — otherwise the
   * single line on the whole arm is a black arc across the bicep, which reads as
   * a band rather than as the end of a sleeve. The colour change already says it.
   */
  hem: string | null;
  /**
   * The palm on its own. The renderer masks the digit lines out of it: a finger
   * is a closed tube, so its root cap would otherwise draw an arc *inside* the
   * palm and the hand would read as a bundle of sticks rather than fingers on a
   * mass.
   */
  palm: string;
  lines: LimbLine[];
}

const ARM_SAMPLES = 22;
const DIGIT_SAMPLES = 9;
const CAP_SAMPLES = 7;

const round = (value: number) => Math.round(value * 10) / 10;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

/** Catmull-Rom, so the sampled curve passes through every bone joint exactly. */
const spline = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const t2 = t * t;
  const t3 = t2 * t;
  const at = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) };
};

/**
 * Resamples a bone chain into a smooth centreline. `smooth` blends between the
 * raw polyline and the spline rather than switching, so a variant can sit
 * anywhere between "hinged" and "hosepipe".
 */
export const sampleCentreline = (
  { points, samples, smooth }: { points: Point[]; samples: number; smooth: number },
): Point[] => {
  if (points.length < 2) {
    return [...points];
  }
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  // Duplicated endpoints give the spline a tangent at the ends without adding a
  // control point the bones don't have.
  const padded = [first, ...points, last];
  const segments = points.length - 1;
  const out: Point[] = [];
  for (let i = 0; i < samples; i += 1) {
    const u = (i / (samples - 1)) * segments;
    const segment = Math.min(Math.floor(u), segments - 1);
    const t = u - segment;
    const raw = lerpPoint(points[segment] as Point, points[segment + 1] as Point, t);
    if (smooth <= 0) {
      out.push(raw);
      continue;
    }
    const curved = spline(
      padded[segment] as Point,
      padded[segment + 1] as Point,
      padded[segment + 2] as Point,
      padded[segment + 3] as Point,
      t,
    );
    out.push(smooth >= 1 ? curved : lerpPoint(raw, curved, smooth));
  }
  return out;
};

export const radiusAt = ({ taper, at }: { taper: TaperStop[]; at: number }): number => {
  const stops = [...taper].sort((a, b) => a.at - b.at);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) {
    return 0;
  }
  if (at <= first.at) {
    return first.r;
  }
  if (at >= last.at) {
    return last.r;
  }
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i] as TaperStop;
    const b = stops[i + 1] as TaperStop;
    if (at <= b.at) {
      const span = b.at - a.at;
      return span <= 0 ? b.r : lerp(a.r, b.r, (at - a.at) / span);
    }
  }
  return last.r;
};

const unit = (dx: number, dy: number): Point => {
  const length = Math.hypot(dx, dy);
  return length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
};

/** Central-difference tangent, so the offset sides stay smooth through a bend. */
const tangentAt = (points: Point[], index: number): Point => {
  const before = points[Math.max(index - 1, 0)] as Point;
  const after = points[Math.min(index + 1, points.length - 1)] as Point;
  return unit(after.x - before.x, after.y - before.y);
};

/**
 * A round cap as sampled points rather than an arc command. Arcs carry sweep
 * flags whose sign depends on the winding, and getting one wrong turns a
 * fingertip inside out; sampling can't be wrong.
 */
const capPoints = ({ centre, normal, radius }: { centre: Point; normal: Point; radius: number }): Point[] => {
  const from = Math.atan2(normal.y, normal.x);
  const out: Point[] = [];
  for (let i = 0; i <= CAP_SAMPLES; i += 1) {
    const angle = from - (i / CAP_SAMPLES) * Math.PI;
    out.push({ x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius });
  }
  return out;
};

const toPath = (points: Point[]): string =>
  `${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ')} Z`;

/**
 * A closed outline around a centreline with a half-width at every sample. This
 * is the primitive the whole file rests on: it is what a stroke would be if a
 * stroke could change width, which is the entire reason the old arm couldn't
 * taper.
 */
export const tubePath = ({ points, radii }: { points: Point[]; radii: number[] }): string => {
  if (points.length < 2) {
    return '';
  }
  const last = points.length - 1;
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= last; i += 1) {
    const p = points[i] as Point;
    const t = tangentAt(points, i);
    const r = radii[i] ?? 0;
    left.push({ x: p.x - t.y * r, y: p.y + t.x * r });
    right.push({ x: p.x + t.y * r, y: p.y - t.x * r });
  }
  const endTangent = tangentAt(points, last);
  const startTangent = tangentAt(points, 0);
  const outline = [
    ...left,
    ...capPoints({
      centre: points[last] as Point,
      normal: { x: -endTangent.y, y: endTangent.x },
      radius: radii[last] ?? 0,
    }),
    ...right.slice().reverse(),
    ...capPoints({
      centre: points[0] as Point,
      normal: { x: startTangent.y, y: -startTangent.x },
      radius: radii[0] ?? 0,
    }),
  ];
  return toPath(outline);
};

/** The cap on its own, as an open path — the sleeve's hem is exactly this edge. */
const capEdge = ({ points, radius, at }: { points: Point[]; radius: number; at: number }): string => {
  const tangent = tangentAt(points, at);
  const arc = capPoints({
    centre: points[at] as Point,
    normal: { x: -tangent.y, y: tangent.x },
    radius,
  });
  return arc.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
};

// `skeleton` rides along everywhere a pivot is read, not just where matrices are
// built. Every matrix is identity at rest, so a pivot read from the *default*
// skeleton comes back unmoved — which is a hand left behind by its own forearm.
const chainPoints = (
  { matrices, chain, skeleton }: { matrices: Matrices; chain: JointId[]; skeleton: Skeleton },
): Point[] => {
  const points = chain.map(joint => jointPivot({ matrices, joint, joints: skeleton }));
  const tip = chain[chain.length - 1];
  return tip ? [...points, jointTip({ matrices, joint: tip, joints: skeleton })] : points;
};

/**
 * Past this much bend away from the hand's own axis, a digit has folded into the
 * palm and stops being drawn as a separate finger.
 *
 * In three dimensions a curling finger goes *behind* the palm and foreshortens
 * away. In the picture plane it can only swing sideways, so a fist that keeps
 * inking every finger ends up as a scribble of overlapping outlines. Dropping
 * the line is the 2D equivalent of the finger disappearing: the shape still
 * swells the silhouette into knuckles, which is what a fist reads as anyway.
 */
const FOLDED_AWAY = 100;

const digitShape = (
  { matrices, side, digit, width, axis, skeleton }:
  {
    matrices: Matrices;
    side: 'L' | 'R';
    digit: string;
    width: DigitWidth;
    axis: Point;
    skeleton: Skeleton;
  },
): { d: string; folded: boolean } => {
  const chain = chainPoints({
    matrices,
    skeleton,
    chain: [`hand${side}${digit}1` as JointId, `hand${side}${digit}2` as JointId],
  });
  const points = sampleCentreline({ points: chain, samples: DIGIT_SAMPLES, smooth: 1 });
  const radii = points.map((_, i) => lerp(width.root, width.tip, i / (points.length - 1)));
  const last = chain[chain.length - 1] as Point;
  const previous = chain[chain.length - 2] as Point;
  const tip = unit(last.x - previous.x, last.y - previous.y);
  const bend = Math.acos(Math.min(1, Math.max(-1, tip.x * axis.x + tip.y * axis.y))) * (180 / Math.PI);
  return { d: tubePath({ points, radii }), folded: bend > FOLDED_AWAY };
};

/** Which digits a hand draws, thumb first. */
const digitsFor = (hand: HandRig): string[] => {
  if (hand.kind === 'mitten') {
    return ['Thumb'];
  }
  const fingers = DIGITS.filter(digit => digit !== 'Thumb').slice(0, hand.count ?? 4);
  return ['Thumb', ...fingers];
};

const handShapes = (
  { matrices, side, hand, skeleton }:
  { matrices: Matrices; side: 'L' | 'R'; hand: HandRig; skeleton: Skeleton },
): { palm: string; digits: { d: string; folded: boolean }[] } => {
  const wrist = jointPivot({ matrices, joint: `arm${side}Hand` as JointId, joints: skeleton });
  const roots = DIGITS
    .filter(digit => digit !== 'Thumb')
    .map(digit => jointPivot({ matrices, joint: `hand${side}${digit}1` as JointId, joints: skeleton }));
  // The knuckle line is wherever the fingers actually are, so the palm follows
  // the wrist through every pose without being animated itself.
  const knuckle = roots.reduce(
    (sum, point) => ({ x: sum.x + point.x / roots.length, y: sum.y + point.y / roots.length }),
    { x: 0, y: 0 },
  );
  const overshoot = hand.kind === 'mitten' ? (hand.palm.overshoot ?? 18) : 0;
  const along = unit(knuckle.x - wrist.x, knuckle.y - wrist.y);
  const end = { x: knuckle.x + along.x * overshoot, y: knuckle.y + along.y * overshoot };
  return {
    palm: tubePath({ points: [wrist, end], radii: [hand.palm.wrist, hand.palm.knuckle] }),
    digits: digitsFor(hand).map(digit => digitShape({
      matrices,
      skeleton,
      side,
      digit,
      width: digit === 'Thumb' ? hand.thumb : hand.finger,
      // Measured against the hand itself, so a bend counts as a bend whatever
      // the wrist and the whole arm above it happen to be doing.
      axis: along,
    })),
  };
};

/**
 * One arm and its hand, in chest space.
 *
 * The arm runs shoulder → elbow → wrist as a single tapered tube, and the palm
 * and digits are more tubes overlapping it. Nothing here decides how any of it
 * is painted; the renderer inks a whole group at once, which is what collapses
 * all of these into one silhouette.
 */
export const armGeometry = (
  { pose, side, rig, shoulder, pull = 0 }:
  { pose: Pose; side: 'l' | 'r'; rig: ArmRig; shoulder?: Point | null; pull?: number },
): ArmGeometry => {
  const s = side === 'l' ? 'L' : 'R';
  // Authored left-side, so the helper mirrors it for the right arm itself.
  const skeleton = shoulder || pull ? withArmsAt({ shoulder, pull }) : JOINTS_BY_ID;
  const matrices = computeSubtreeMatrices({ pose, root: `arm${s}Clav` as JointId, joints: skeleton });
  const bones = [`arm${s}Up`, `arm${s}Low`, `arm${s}Hand`].map(
    joint => jointPivot({ matrices, joint: joint as JointId, joints: skeleton }),
  );
  const spine = sampleCentreline({ points: bones, samples: ARM_SAMPLES, smooth: rig.smooth });
  const radii = spine.map((_, i) => radiusAt({ taper: rig.taper, at: i / (spine.length - 1) }));
  const { palm, digits } = handShapes({ matrices, side: s, hand: rig.hand, skeleton });

  const cut = rig.sleeve ?? null;
  const sleeve = cut
    ? (() => {
        const until = Math.max(1, Math.round(cut.hem * (spine.length - 1)));
        const points = spine.slice(0, until + 1);
        const swollen = radii.slice(0, until + 1).map(r => r + cut.swell);
        return {
          d: tubePath({ points, radii: swollen }),
          hem: capEdge({ points, radius: swollen[until] ?? 0, at: until }),
        };
      })()
    : null;

  const shapes = digits.map(digit => digit.d);

  const lines: LimbLine[] = rig.creases === 'none'
    ? []
    // The gaps between fingers are narrower than the fingers are wide, so the
    // union has no notch to show them. Their own outlines are the only thing
    // that says a hand has fingers rather than a paddle — until they fold into
    // the palm, at which point the outline is all that would be left of them.
    : digits.filter(digit => !digit.folded).map(digit => ({ d: digit.d, kind: 'digit' as const }));

  if (rig.segmented) {
    // The old drawing: each bone inked and filled in turn, so every joint leaves
    // an outline across the middle of the limb.
    const half = Math.round((spine.length - 1) / 2);
    const upper = spine.slice(0, half + 1);
    const lower = spine.slice(half);
    return {
      groups: [
        [tubePath({ points: upper, radii: radii.slice(0, upper.length) })],
        [tubePath({ points: lower, radii: radii.slice(radii.length - lower.length) })],
        [palm, ...shapes],
      ],
      sleeve: sleeve?.d ?? null,
      hem: rig.ink > 0 ? (sleeve?.hem ?? null) : null,
      palm,
      lines,
    };
  }

  return {
    groups: [[tubePath({ points: spine, radii }), palm, ...shapes]],
    sleeve: sleeve?.d ?? null,
    // The hem is inked at the limb's own weight, so a limb with no ink has no
    // hem line either — otherwise the only line on the whole arm is a black arc
    // across the bicep, which reads as a band rather than as the end of a sleeve.
    // Where the sleeve stops is already said by the colour changing.
    hem: rig.ink > 0 ? (sleeve?.hem ?? null) : null,
    palm,
    lines,
  };
};

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------
//
// Every one of these is the same skeleton and the same clips. They differ only
// in width profile, outline treatment and what a hand is made of, which is the
// point: they are meant to be looked at side by side and chosen between.

/** The width the old arm had, everywhere, because a stroke has one width. */
const UNIFORM_TAPER: TaperStop[] = [{ at: 0, r: 18 }, { at: 1, r: 18 }];

/** Deltoid at the top, narrowest at the elbow, a little forearm swell, thin wrist. */
const NATURAL_TAPER: TaperStop[] = [
  { at: 0, r: 21 },
  { at: 0.12, r: 22 },
  { at: 0.46, r: 16 },
  { at: 0.68, r: 17.5 },
  { at: 1, r: 12 },
];

const SLIM_TAPER: TaperStop[] = [
  { at: 0, r: 17 },
  { at: 0.14, r: 17.5 },
  { at: 0.48, r: 12.5 },
  { at: 0.7, r: 13.5 },
  { at: 1, r: 9.5 },
];

const ATHLETIC_TAPER: TaperStop[] = [
  { at: 0, r: 24 },
  { at: 0.16, r: 26 },
  { at: 0.44, r: 17 },
  { at: 0.66, r: 20 },
  { at: 1, r: 12.5 },
];

const HAND_FINGERS: HandRig = {
  kind: 'fingers',
  count: 4,
  palm: { wrist: 15, knuckle: 20 },
  finger: { root: 6.4, tip: 5 },
  thumb: { root: 6.6, tip: 5.2 },
};

const HAND_SLIM: HandRig = {
  kind: 'fingers',
  count: 4,
  palm: { wrist: 12.5, knuckle: 16.5 },
  finger: { root: 5, tip: 4 },
  thumb: { root: 5.4, tip: 4.2 },
};

const HAND_CHUNKY: HandRig = {
  kind: 'fingers',
  count: 3,
  palm: { wrist: 17, knuckle: 22 },
  finger: { root: 8, tip: 6.8 },
  thumb: { root: 8.4, tip: 7 },
};

const HAND_MITTEN: HandRig = {
  kind: 'mitten',
  palm: { wrist: 16, knuckle: 21, overshoot: 22 },
  finger: { root: 6.4, tip: 5 },
  thumb: { root: 7, tip: 5.6 },
};

const SHORT_SLEEVE = { hem: 0.3, swell: 0 };

/** The arm as it was: three stacked capsules, one width, a mitten on the end. */
export const ARM_SAUSAGE: ArmRig = {
  id: 'sausage',
  name: 'Sausage',
  blurb: 'The old arm: one width, every bone outlined separately, mitten hand.',
  taper: UNIFORM_TAPER,
  smooth: 0,
  ink: 3.2,
  hand: HAND_MITTEN,
  sleeve: SHORT_SLEEVE,
  creases: 'none',
  segmented: true,
};

export const ARM_SEAMLESS: ArmRig = {
  id: 'seamless',
  name: 'Seamless',
  blurb: 'Same width as before, but one silhouette — no outline crosses the limb.',
  taper: UNIFORM_TAPER,
  smooth: 0.6,
  ink: 3.2,
  hand: HAND_MITTEN,
  sleeve: SHORT_SLEEVE,
  creases: 'none',
};

export const ARM_TAPERED: ArmRig = {
  id: 'tapered',
  name: 'Tapered',
  blurb: 'Deltoid, elbow, forearm, wrist — width does the anatomy. Four fingers.',
  taper: NATURAL_TAPER,
  smooth: 1,
  ink: 3.2,
  hand: HAND_FINGERS,
  sleeve: SHORT_SLEEVE,
  creases: 'inked',
};

export const ARM_SOFT: ArmRig = {
  id: 'soft',
  name: 'Soft seams',
  blurb: 'Tapered, but the fingers are separated in skin shade rather than ink.',
  taper: NATURAL_TAPER,
  smooth: 1,
  ink: 3.2,
  hand: HAND_FINGERS,
  sleeve: SHORT_SLEEVE,
  creases: 'soft',
};

export const ARM_PADDLE: ArmRig = {
  id: 'paddle',
  name: 'No seams',
  blurb: 'Fingers rigged but never inked. Shows what the outline alone can carry.',
  taper: NATURAL_TAPER,
  smooth: 1,
  ink: 3.2,
  hand: HAND_FINGERS,
  sleeve: SHORT_SLEEVE,
  creases: 'none',
};

export const ARM_SLIM: ArmRig = {
  id: 'slim',
  name: 'Slim',
  blurb: 'Thinner arms, long fingers. More gesture, less mass.',
  taper: SLIM_TAPER,
  smooth: 1,
  ink: 2.8,
  hand: HAND_SLIM,
  sleeve: { hem: 0.3, swell: 0 },
  creases: 'inked',
};

export const ARM_ATHLETIC: ArmRig = {
  id: 'athletic',
  name: 'Athletic',
  blurb: 'Heavier deltoid and forearm, chunky three-finger hand.',
  taper: ATHLETIC_TAPER,
  smooth: 1,
  ink: 3.6,
  hand: HAND_CHUNKY,
  sleeve: { hem: 0.32, swell: 0 },
  creases: 'inked',
};

export const ARM_HEAVY_INK: ArmRig = {
  id: 'heavyInk',
  name: 'Heavy ink',
  blurb: 'Tapered, with a much heavier outline. Reads at icon size.',
  taper: NATURAL_TAPER,
  smooth: 1,
  ink: 5,
  hand: HAND_FINGERS,
  sleeve: SHORT_SLEEVE,
  creases: 'inked',
};

export const ARM_NO_INK: ArmRig = {
  id: 'noInk',
  name: 'No outline',
  blurb: 'No ink on the limbs at all — the arm is only where the shading says.',
  taper: NATURAL_TAPER,
  smooth: 1,
  ink: 0,
  hand: HAND_FINGERS,
  sleeve: SHORT_SLEEVE,
  creases: 'soft',
};

export const ARM_MITTEN: ArmRig = {
  id: 'mitten',
  name: 'Tapered mitten',
  blurb: 'The new arm with the old hand, to isolate what the fingers are worth.',
  taper: NATURAL_TAPER,
  smooth: 1,
  ink: 3.2,
  hand: HAND_MITTEN,
  sleeve: SHORT_SLEEVE,
  creases: 'none',
};

export const ARM_RIGS: ArmRig[] = [
  ARM_SAUSAGE,
  ARM_SEAMLESS,
  ARM_TAPERED,
  ARM_SOFT,
  ARM_PADDLE,
  ARM_MITTEN,
  ARM_SLIM,
  ARM_ATHLETIC,
  ARM_HEAVY_INK,
  ARM_NO_INK,
];
