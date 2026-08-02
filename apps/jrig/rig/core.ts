// The avatar rig contract: skeleton, channels, clip format, sampler and the
// matrix maths that turns a pose into world-space joint frames.
//
// Nothing here knows what the character *looks like*. The rig is a set of named
// numeric channels; a skin is whatever art binds itself to those channels. That
// separation is the point — any skin can play any emote (see README.md).

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/** The five digits, in the order they sit across the knuckles. */
export const DIGITS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;

export type Digit = typeof DIGITS[number];

/** `handLIndex2` — side, digit, and which of the two bones. */
export type DigitJointId = `hand${'L' | 'R'}${Digit}${1 | 2}`;

export type JointId
  = | 'root'
    | 'torso'
    | 'chest'
    | 'neck'
    | 'head'
    | 'browL'
    | 'browR'
    | 'eyeL'
    | 'eyeR'
    | 'jaw'
    | 'armLClav'
    | 'armLUp'
    | 'armLLow'
    | 'armLHand'
    | 'armRClav'
    | 'armRUp'
    | 'armRLow'
    | 'armRHand'
    | DigitJointId;

export type TransformChannel = 'rot' | 'x' | 'y' | 'sx' | 'sy';

export interface Joint {
  id: JointId;
  label: string;
  parent: JointId | null;
  // Rest pivot in view-box space. Because every transform is identity at rest,
  // a child's pivot can be authored in the same global coordinates as its
  // parent's — nesting takes care of propagation.
  pivot: readonly [number, number];
  // Rest direction of the bone in degrees (0 = +x, 90 = down). Used by the
  // editor to draw handles along the bone; `null` for jointless nodes.
  restAngle: number | null;
  length: number;
  group: 'body' | 'arms' | 'face' | 'hands';
  // Channels the editor exposes for this joint. Every joint still *supports*
  // all five; this is just the curated inspector surface.
  channels: TransformChannel[];
}

const RAD = Math.PI / 180;

/**
 * One hand, authored for the left and mirrored about x=200 for the right — the
 * same rule the art follows, so a hand can never drift out of symmetry.
 *
 * Each digit is two bones, and the rest angles carry a slight curl that grows
 * toward the tip. A hand whose bones all rest on the same axis reads as a
 * splayed board; the curl is what makes a hand hanging by the side look relaxed
 * before a single clip has touched it.
 */
interface DigitSpec {
  digit: Digit;
  /** Knuckle, in view-box space. */
  root: readonly [number, number];
  /** Proximal then distal bone. */
  lengths: readonly [number, number];
  angles: readonly [number, number];
}

// The palm faces the body, so both bones of every digit fold toward +x on the
// left hand — angles *decrease* down the chain. That one convention is what lets
// a clip say "curl" as a single positive number for every digit on either hand.
//
// Two numbers decide whether this reads as a hand or as a rake, and both are
// about the gaps rather than the fingers:
//
//  1. **Knuckle spacing must be less than a finger is wide.** At 8 apart and
//     ~13 wide the tubes union into one mass; at 10 they only just touch, and
//     anything that pulls them apart downstream opens a slot.
//  2. **The fan has to be small enough that the curl doesn't outrun it.** Every
//     digit curls the same way, so a wide fan means the tips keep diverging all
//     the way down — spread knuckles, spread tips, four separate sausages. Two
//     degrees per finger keeps them together while still splaying.
//
// It matters more here than it would elsewhere because the limb this hangs off
// may carry no outline at all, in which case these digit seams are the only
// lines on the whole arm, and anything they get wrong is the drawing.
const LEFT_DIGITS: readonly DigitSpec[] = [
  // The thumb sits *on* the palm's inner edge, not off it: rooted any further
  // out it stops reading as a thumb and starts reading as a second limb.
  { digit: 'Thumb', root: [103, 502], lengths: [11.5, 8.5], angles: [78, 56] },
  { digit: 'Index', root: [100, 514], lengths: [14, 10.5], angles: [93, 70] },
  { digit: 'Middle', root: [92, 517], lengths: [15, 11], angles: [95, 72] },
  { digit: 'Ring', root: [84, 514], lengths: [14, 10.5], angles: [97, 74] },
  { digit: 'Pinky', root: [76, 507], lengths: [11.5, 8.5], angles: [100, 78] },
];

const digitJoints = (side: 'L' | 'R'): Joint[] => LEFT_DIGITS.flatMap((spec) => {
  const flip = side === 'R';
  const x = (value: number) => (flip ? 400 - value : value);
  const angle = (value: number) => (flip ? 180 - value : value);
  const [rootX, rootY] = spec.root;
  const [proximal, distal] = spec.lengths;
  const first = angle(spec.angles[0]);
  const second = angle(spec.angles[1]);
  // The distal bone hangs off the tip of the proximal one, so a length or angle
  // change here can never leave a gap between the two.
  const knuckle: [number, number] = [
    x(rootX) + Math.cos(first * RAD) * proximal,
    rootY + Math.sin(first * RAD) * proximal,
  ];
  const base: Pick<Joint, 'group' | 'channels'> = { group: 'hands', channels: ['rot'] };
  return [
    {
      ...base,
      id: `hand${side}${spec.digit}1` as JointId,
      label: `${spec.digit} ${side} 1`,
      parent: `arm${side}Hand` as JointId,
      pivot: [x(rootX), rootY],
      restAngle: first,
      length: proximal,
    },
    {
      ...base,
      id: `hand${side}${spec.digit}2` as JointId,
      label: `${spec.digit} ${side} 2`,
      parent: `hand${side}${spec.digit}1` as JointId,
      pivot: knuckle,
      restAngle: second,
      length: distal,
    },
  ];
});

// The shoulder pivots sit *inside* the torso silhouette, not on its edge, so a
// resting arm reads as attached to the shoulder rather than floating alongside
// it. Arms draw in front of the body by default (see DEPTH_CHANNELS), so the
// sleeve is a visible outlined mass down each side — that, more than the
// silhouette's width profile, is what stops the torso reading as a plain shape.
export const SKELETON: readonly Joint[] = [
  { id: 'root', label: 'Root', parent: null, pivot: [200, 400], restAngle: -90, length: 120, group: 'body', channels: ['x', 'y', 'rot'] },
  { id: 'torso', label: 'Torso', parent: 'root', pivot: [200, 400], restAngle: -90, length: 100, group: 'body', channels: ['rot', 'x', 'y', 'sx', 'sy'] },
  { id: 'chest', label: 'Chest', parent: 'torso', pivot: [200, 340], restAngle: -90, length: 70, group: 'body', channels: ['rot', 'x', 'y', 'sx', 'sy'] },
  { id: 'neck', label: 'Neck', parent: 'chest', pivot: [200, 258], restAngle: -90, length: 28, group: 'body', channels: ['rot', 'x', 'y'] },
  { id: 'head', label: 'Head', parent: 'neck', pivot: [200, 230], restAngle: -90, length: 96, group: 'body', channels: ['rot', 'x', 'y', 'sx', 'sy'] },

  { id: 'browL', label: 'Brow L', parent: 'head', pivot: [188, 114], restAngle: 180, length: 34, group: 'face', channels: ['rot', 'y', 'x'] },
  { id: 'browR', label: 'Brow R', parent: 'head', pivot: [212, 114], restAngle: 0, length: 34, group: 'face', channels: ['rot', 'y', 'x'] },
  { id: 'eyeL', label: 'Eye L', parent: 'head', pivot: [175, 138], restAngle: 0, length: 16, group: 'face', channels: ['x', 'y', 'rot'] },
  { id: 'eyeR', label: 'Eye R', parent: 'head', pivot: [225, 138], restAngle: 0, length: 16, group: 'face', channels: ['x', 'y', 'rot'] },
  { id: 'jaw', label: 'Jaw', parent: 'head', pivot: [200, 176], restAngle: 90, length: 40, group: 'face', channels: ['rot', 'y', 'x'] },

  // A shoulder is not a socket bolted to the ribcage: the whole girdle rides up
  // and forward before the arm has rotated at all. The clavicle is that joint,
  // and it is most of what separates a reach from a swing. Identity at rest, so
  // every clip authored against the old three-bone chain still means what it did.
  { id: 'armLClav', label: 'Shoulder L', parent: 'chest', pivot: [176, 300], restAngle: 167.5, length: 55, group: 'arms', channels: ['rot', 'x', 'y'] },
  { id: 'armLUp', label: 'Upper arm L', parent: 'armLClav', pivot: [122, 312], restAngle: 104.7, length: 86.8, group: 'arms', channels: ['rot', 'x', 'y'] },
  { id: 'armLLow', label: 'Forearm L', parent: 'armLUp', pivot: [100, 396], restAngle: 96.5, length: 88.6, group: 'arms', channels: ['rot'] },
  { id: 'armLHand', label: 'Wrist L', parent: 'armLLow', pivot: [90, 484], restAngle: 96.5, length: 34, group: 'arms', channels: ['rot', 'x', 'y'] },
  { id: 'armRClav', label: 'Shoulder R', parent: 'chest', pivot: [224, 300], restAngle: 12.5, length: 55, group: 'arms', channels: ['rot', 'x', 'y'] },
  { id: 'armRUp', label: 'Upper arm R', parent: 'armRClav', pivot: [278, 312], restAngle: 75.3, length: 86.8, group: 'arms', channels: ['rot', 'x', 'y'] },
  { id: 'armRLow', label: 'Forearm R', parent: 'armRUp', pivot: [300, 396], restAngle: 83.5, length: 88.6, group: 'arms', channels: ['rot'] },
  { id: 'armRHand', label: 'Wrist R', parent: 'armRLow', pivot: [310, 484], restAngle: 83.5, length: 34, group: 'arms', channels: ['rot', 'x', 'y'] },

  ...digitJoints('L'),
  ...digitJoints('R'),
];

export const JOINTS_BY_ID: Record<JointId, Joint> = Object.fromEntries(
  SKELETON.map(joint => [joint.id, joint]),
) as Record<JointId, Joint>;

/** Which side of the body a limb or hand joint belongs to. */
const LIMB_SIDE = /^(?:arm|hand)([LR])/;

/**
 * The same skeleton with the arms placed for a particular drawing, mirrored
 * about x=200. Two independent knobs:
 *
 * - `shoulder` puts the upper-arm joint somewhere absolute. A wide flat shirt
 *   wants it out near the edge, a narrow one wants it tucked in.
 * - `pull` moves everything below the shoulder inboard. This one is not taste:
 *   a torso that narrows without its arms leaves the upper arm hanging outside
 *   the shirt, and since the limb carries no outline of its own, the shirt's
 *   outline ends up drawn straight across it.
 *
 * Every matrix is identity at rest, so a moved pivot changes exactly two
 * things — where that bone sits, and what it rotates about. Children follow
 * because they are shifted with it, and every authored clip keeps meaning what
 * it meant, because a clip is angles rather than positions.
 */
export const withArmsAt = (
  { shoulder, pull = 0 }: { shoulder?: { x: number; y: number } | null; pull?: number },
): Record<JointId, Joint> => {
  const out = { ...JOINTS_BY_ID };
  if (pull !== 0) {
    for (const joint of SKELETON) {
      const side = LIMB_SIDE.exec(joint.id)?.[1];
      // The clavicle stays: it pivots near the sternum, which the frame's width
      // does not move. The upper arm stays because `shoulder` places it.
      const below = joint.id.endsWith('Low') || joint.id.endsWith('Hand') || joint.id.startsWith('hand');
      if (!side || !below) {
        continue;
      }
      const dx = side === 'L' ? pull : -pull;
      out[joint.id] = { ...joint, pivot: [joint.pivot[0] + dx, joint.pivot[1]] };
    }
  }
  if (shoulder) {
    out.armLUp = { ...out.armLUp, pivot: [shoulder.x, shoulder.y] };
    out.armRUp = { ...out.armRUp, pivot: [400 - shoulder.x, shoulder.y] };
  }
  return out;
};

// Parents always precede children in SKELETON, so a single forward pass builds
// every world matrix.
export const JOINT_ORDER: JointId[] = SKELETON.map(joint => joint.id);

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type ChannelId = string;

export interface ChannelSpec {
  id: ChannelId;
  label: string;
  min: number;
  max: number;
  step: number;
  rest: number;
  // Channels that must not be interpolated — they snap at the keyframe.
  stepped?: boolean;
}

const transformChannelSpec = (joint: Joint, channel: TransformChannel): ChannelSpec => {
  const id = `${joint.id}.${channel}`;
  switch (channel) {
    case 'rot':
      // Elbows fold well past 180° in 2D (full flexion sweeps the forearm up
      // and over), so the arm channels need the wide range.
      return { id, label: 'Rotate', min: -240, max: 240, step: 0.5, rest: 0 };
    case 'x':
      return { id, label: 'Offset X', min: -120, max: 120, step: 0.5, rest: 0 };
    case 'y':
      return { id, label: 'Offset Y', min: -120, max: 120, step: 0.5, rest: 0 };
    case 'sx':
      return { id, label: 'Scale X', min: 0.4, max: 1.8, step: 0.01, rest: 1 };
    case 'sy':
      return { id, label: 'Scale Y', min: 0.4, max: 1.8, step: 0.01, rest: 1 };
  }
};

export const TRANSFORM_CHANNELS: ChannelSpec[] = SKELETON.flatMap(joint =>
  joint.channels.map(channel => transformChannelSpec(joint, channel)),
);

// Face channels drive computed geometry rather than a transform. They are what
// make the expression range continuous: every value between a frown and a grin
// is a real pose, not a missing artwork variant.
export const FACE_CHANNELS: ChannelSpec[] = [
  { id: 'face.mouthOpen', label: 'Mouth open', min: 0, max: 1, step: 0.01, rest: 0 },
  { id: 'face.mouthWide', label: 'Mouth width', min: 0.5, max: 1.5, step: 0.01, rest: 1 },
  { id: 'face.mouthCurve', label: 'Mouth curve', min: -1, max: 1, step: 0.01, rest: 0.22 },
  { id: 'face.eyeOpenL', label: 'Eye open L', min: 0, max: 1.3, step: 0.01, rest: 1 },
  { id: 'face.eyeOpenR', label: 'Eye open R', min: 0, max: 1.3, step: 0.01, rest: 1 },
  { id: 'face.eyeCurveL', label: 'Eye curve L', min: -1, max: 1, step: 0.01, rest: 0 },
  { id: 'face.eyeCurveR', label: 'Eye curve R', min: -1, max: 1, step: 0.01, rest: 0 },
  { id: 'face.pupilX', label: 'Look X', min: -1, max: 1, step: 0.01, rest: 0 },
  { id: 'face.pupilY', label: 'Look Y', min: -1, max: 1, step: 0.01, rest: 0 },
  { id: 'face.blush', label: 'Blush', min: 0, max: 1, step: 0.01, rest: 0 },
  { id: 'face.tear', label: 'Tears', min: 0, max: 1, step: 0.01, rest: 0 },
  { id: 'face.browSad', label: 'Brow sad', min: -1, max: 1, step: 0.01, rest: 0 },
];

// Which arm draws in front of the body. Snapped, never blended — a hand is
// either in front of the face or behind the shoulder, never half of each.
//
// Rest is *in front*: a resting arm read as a separate outlined mass down the
// side of the body is what stops the torso looking like a plain rounded shape.
// Drop it to 0 for poses that tuck an arm behind the body.
export const DEPTH_CHANNELS: ChannelSpec[] = [
  { id: 'armL.front', label: 'Arm L in front', min: 0, max: 1, step: 1, rest: 1, stepped: true },
  { id: 'armR.front', label: 'Arm R in front', min: 0, max: 1, step: 1, rest: 1, stepped: true },
];

export const ALL_CHANNELS: ChannelSpec[] = [
  ...TRANSFORM_CHANNELS,
  ...FACE_CHANNELS,
  ...DEPTH_CHANNELS,
];

export const CHANNELS_BY_ID: Record<ChannelId, ChannelSpec> = Object.fromEntries(
  ALL_CHANNELS.map(channel => [channel.id, channel]),
);

export type Pose = Record<ChannelId, number>;

export const REST_POSE: Readonly<Pose> = Object.freeze(
  Object.fromEntries(ALL_CHANNELS.map(channel => [channel.id, channel.rest])),
);

export const createRestPose = (): Pose => ({ ...REST_POSE });

export const channelLabel = (id: ChannelId): string => {
  const spec = CHANNELS_BY_ID[id];
  if (!spec) {
    return id;
  }
  const [owner] = id.split('.');
  const joint = JOINTS_BY_ID[owner as JointId];
  return joint ? `${joint.label} · ${spec.label}` : spec.label;
};

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export type Easing = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold' | 'back';

export const EASING_IDS: Easing[] = ['linear', 'ease', 'easeIn', 'easeOut', 'hold', 'back'];

const BACK_C1 = 1.70158;

export const EASING_FNS: Record<Easing, (t: number) => number> = {
  linear: t => t,
  ease: t => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) ** 2,
  // Holds the outgoing keyframe until the next one lands — step interpolation.
  hold: () => 0,
  back: t => 1 + (BACK_C1 + 1) * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2,
};

export interface Keyframe {
  t: number;
  v: number;
  /** Easing from this keyframe to the next. Defaults to `ease`. */
  e?: Easing;
}

export interface Clip {
  id: string;
  name: string;
  /** Seconds. */
  duration: number;
  loop: boolean;
  /**
   * `base` clips are the steady state (idle, talking). `emote` clips play on
   * the layer above and only override the channels they actually keyframe, so
   * an arms-only emote leaves the face on the talk loop.
   */
  layer: 'base' | 'emote';
  tracks: Record<ChannelId, Keyframe[]>;
}

/** Value of one track at time `t`, or `undefined` if the track is empty. */
export const sampleTrack = (keys: Keyframe[], t: number): number | undefined => {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) {
    return undefined;
  }
  if (t <= first.t) {
    return first.v;
  }
  if (t >= last.t) {
    return last.v;
  }
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1] as Keyframe).t <= t) {
    i += 1;
  }
  const a = keys[i] as Keyframe;
  const b = keys[i + 1] as Keyframe;
  const span = b.t - a.t;
  if (span <= 0) {
    return b.v;
  }
  const eased = EASING_FNS[a.e ?? 'ease']((t - a.t) / span);
  return a.v + (b.v - a.v) * eased;
};

/** Only the channels this clip actually animates — that sparseness is the mask. */
export const sampleClip = (clip: Clip, t: number): Partial<Pose> => {
  const time = clip.loop && clip.duration > 0
    ? ((t % clip.duration) + clip.duration) % clip.duration
    : Math.min(Math.max(t, 0), clip.duration);
  const out: Partial<Pose> = {};
  for (const [channel, keys] of Object.entries(clip.tracks)) {
    const value = sampleTrack(keys, time);
    if (value !== undefined) {
      out[channel] = value;
    }
  }
  return out;
};

/** Blends `over` onto `base` in place, weighted 0..1. Stepped channels snap. */
export const applyPose = (base: Pose, over: Partial<Pose>, weight = 1): Pose => {
  if (weight <= 0) {
    return base;
  }
  for (const [channel, value] of Object.entries(over)) {
    if (value === undefined) {
      continue;
    }
    if (CHANNELS_BY_ID[channel]?.stepped) {
      if (weight >= 0.5) {
        base[channel] = value;
      }
      continue;
    }
    const from = base[channel] ?? REST_POSE[channel] ?? 0;
    base[channel] = weight >= 1 ? value : from + (value - from) * weight;
  }
  return base;
};

export const sortTrack = (keys: Keyframe[]): Keyframe[] => [...keys].sort((a, b) => a.t - b.t);

/** Inserts or replaces the keyframe at `t` (within a 1ms tolerance). */
export const putKeyframe = (keys: Keyframe[], t: number, v: number, e?: Easing): Keyframe[] => {
  const next = keys.filter(key => Math.abs(key.t - t) > 0.001);
  next.push({ t, v, ...(e ? { e } : {}) });
  return sortTrack(next);
};

// ---------------------------------------------------------------------------
// World-space evaluation
// ---------------------------------------------------------------------------

/** A 2D affine matrix as SVG orders it: [a, b, c, d, e, f]. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export const applyMatrix = (m: Matrix, x: number, y: number): { x: number; y: number } => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

const DEG = Math.PI / 180;

/**
 * Local matrix for one joint: rotate and scale about the pivot, then offset.
 * Mirrors the transform string the SVG group renders, so handles and art can
 * never drift apart.
 */
export const jointMatrix = (joint: Joint, pose: Pose): Matrix => {
  const [px, py] = joint.pivot;
  const rot = (pose[`${joint.id}.rot`] ?? 0) * DEG;
  const sx = pose[`${joint.id}.sx`] ?? 1;
  const sy = pose[`${joint.id}.sy`] ?? 1;
  const tx = pose[`${joint.id}.x`] ?? 0;
  const ty = pose[`${joint.id}.y`] ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return [a, b, c, d, px + tx - (a * px + c * py), py + ty - (b * px + d * py)];
};

export const jointTransform = (joint: Joint, pose: Pose): string => {
  const [px, py] = joint.pivot;
  const rot = pose[`${joint.id}.rot`] ?? 0;
  const sx = pose[`${joint.id}.sx`] ?? 1;
  const sy = pose[`${joint.id}.sy`] ?? 1;
  const tx = pose[`${joint.id}.x`] ?? 0;
  const ty = pose[`${joint.id}.y`] ?? 0;
  return `translate(${px + tx} ${py + ty}) rotate(${rot}) scale(${sx} ${sy}) translate(${-px} ${-py})`;
};

export interface JointFrame {
  /** Pivot in view-box space, after every ancestor transform. */
  x: number;
  y: number;
  /** Accumulated world rotation in degrees, including this joint's own. */
  rot: number;
  /** World rotation of the parent — the frame a drag delta must be applied in. */
  parentRot: number;
  /** Tip of the bone in view-box space, for drawing handles. */
  tipX: number;
  tipY: number;
}

const matrixRotation = (m: Matrix): number => Math.atan2(m[1], m[0]) / DEG;

/**
 * Every joint's pivot and rotation in view-box space. The editor needs this to
 * put a drag handle exactly where the bone is, whatever the pose.
 */
export const computeJointFrames = (
  { pose, joints = JOINTS_BY_ID }: { pose: Pose; joints?: Record<JointId, Joint> },
): Record<JointId, JointFrame> => {
  const world = {} as Record<JointId, Matrix>;
  const frames = {} as Record<JointId, JointFrame>;
  for (const id of JOINT_ORDER) {
    const joint = joints[id];
    const parentMatrix = joint.parent ? world[joint.parent] : IDENTITY;
    const matrix = multiply(parentMatrix, jointMatrix(joint, pose));
    world[id] = matrix;
    const pivot = applyMatrix(matrix, joint.pivot[0], joint.pivot[1]);
    const rot = matrixRotation(matrix);
    const tipAngle = (joint.restAngle ?? 0) * DEG;
    const tip = applyMatrix(
      matrix,
      joint.pivot[0] + Math.cos(tipAngle) * joint.length,
      joint.pivot[1] + Math.sin(tipAngle) * joint.length,
    );
    frames[id] = {
      x: pivot.x,
      y: pivot.y,
      rot,
      parentRot: matrixRotation(parentMatrix),
      tipX: tip.x,
      tipY: tip.y,
    };
  }
  return frames;
};

const CHILDREN: Partial<Record<JointId, JointId[]>> = SKELETON.reduce((map, joint) => {
  if (joint.parent) {
    (map[joint.parent] ??= []).push(joint.id);
  }
  return map;
}, {} as Partial<Record<JointId, JointId[]>>);

/**
 * Every matrix in one subtree, evaluated as if the subtree's root hung off the
 * origin rather than off its ancestors. An arm evaluated from `armLClav`
 * therefore lands in *chest* space — which is the space the art is authored in,
 * so procedural limb geometry drops straight into the group the static paths
 * lived in and inherits the body's transforms, its clip and its shadow for free.
 */
export const computeSubtreeMatrices = (
  { pose, root, joints = JOINTS_BY_ID }:
  { pose: Pose; root: JointId; joints?: Record<JointId, Joint> },
): Partial<Record<JointId, Matrix>> => {
  const out: Partial<Record<JointId, Matrix>> = {};
  const visit = (id: JointId, parentMatrix: Matrix) => {
    const matrix = multiply(parentMatrix, jointMatrix(joints[id], pose));
    out[id] = matrix;
    for (const child of CHILDREN[id] ?? []) {
      visit(child, matrix);
    }
  };
  visit(root, IDENTITY);
  return out;
};

/** Where a joint's pivot ends up, given the matrices it was evaluated into. */
export const jointPivot = (
  { matrices, joint, joints = JOINTS_BY_ID }:
  { matrices: Partial<Record<JointId, Matrix>>; joint: JointId; joints?: Record<JointId, Joint> },
): { x: number; y: number } => {
  const { pivot } = joints[joint];
  return applyMatrix(matrices[joint] ?? IDENTITY, pivot[0], pivot[1]);
};

/** The far end of a bone, in the same space as `jointPivot`. */
export const jointTip = (
  { matrices, joint, joints = JOINTS_BY_ID }:
  { matrices: Partial<Record<JointId, Matrix>>; joint: JointId; joints?: Record<JointId, Joint> },
): { x: number; y: number } => {
  const { pivot, restAngle, length } = joints[joint];
  const angle = (restAngle ?? 0) * DEG;
  return applyMatrix(
    matrices[joint] ?? IDENTITY,
    pivot[0] + Math.cos(angle) * length,
    pivot[1] + Math.sin(angle) * length,
  );
};

// ---------------------------------------------------------------------------
// Parametric geometry
// ---------------------------------------------------------------------------

/** How far `curve` lifts the corners, as a fraction of the shape's width. */
const CORNER_LIFT = 0.42;
/** How far `curve` bows the body the other way, keeping the shape crescent-like. */
const BODY_SAG = 0.2;

export interface LensOptions {
  cx: number;
  cy: number;
  width: number;
  /** Vertical opening. */
  height: number;
  /** -1 fully downturned, 0 flat, +1 fully upturned. */
  curve: number;
  /** Floor on the thickness so a closed shape is still a visible line. */
  minThickness: number;
  /**
   * Fraction of the opening that goes *above* the corner line.
   * `0` opens straight down from a lip line (a mouth); `0.5` opens symmetrically
   * about the centre (an eye). At 0 an eye would be flat-topped — permanently
   * half-lidded — which is the whole reason this knob exists.
   */
  openUp?: number;
}

interface LensGeometry {
  half: number;
  /** y of the two side corners — `curve` lifts these. */
  corner: number;
  /** Quadratic control y above the corner line. */
  top: number;
  /** Quadratic control y below it. */
  bottom: number;
}

const lensGeometry = ({ cx: _cx, cy, width, height, curve, minThickness, openUp = 0 }: LensOptions): LensGeometry => {
  // A quadratic only reaches half its control offset, so the corner lift has to
  // be generous or a "smile" reads as a flat line.
  const corner = cy - curve * width * CORNER_LIFT;
  const thickness = Math.max(height, minThickness);
  const top = cy + curve * width * BODY_SAG - thickness * openUp;
  return { half: width / 2, corner, top, bottom: top + thickness };
};

/**
 * A lens between two quadratic curves — pointed at the corners, which is what a
 * mouth wants. Corners rise with `curve`, the body opens with `height`, and it
 * degrades gracefully at every extreme (grin, frown, closed line, wide O).
 *
 * A quadratic reaches half its control offset, so the visual height of the shape
 * is `thickness / 2` — callers size `height` accordingly.
 */
export const lensPath = (options: LensOptions): string => {
  const { cx, cy: _cy } = options;
  const { half, corner, top, bottom } = lensGeometry(options);
  return `M ${cx - half} ${corner} Q ${cx} ${top} ${cx + half} ${corner} Q ${cx} ${bottom} ${cx - half} ${corner} Z`;
};

/** Cubic control ratio that makes four smooth segments approximate a circle. */
const CIRCLE_K = 0.5523;

/**
 * The same lens with its corners rounded off — four cubics meeting with matching
 * tangents instead of two quadratics meeting at a point. This is what the eyes
 * use: an almond has visible corners, and an eye in this style has to read as a
 * plain round shape.
 *
 * It places the apexes where the quadratic version *reaches* rather than where
 * its controls sit, so both primitives are the same visual size for the same
 * inputs and every caller constant carries over unchanged.
 */
export const roundLensPath = (options: LensOptions): string => {
  const { cx } = options;
  const { half, corner, top, bottom } = lensGeometry(options);
  const apexTop = (corner + top) / 2;
  const apexBottom = (corner + bottom) / 2;
  const hx = half * CIRCLE_K;
  const vTop = (corner - apexTop) * CIRCLE_K;
  const vBottom = (apexBottom - corner) * CIRCLE_K;
  return `M ${cx - half} ${corner}`
    + ` C ${cx - half} ${corner - vTop} ${cx - hx} ${apexTop} ${cx} ${apexTop}`
    + ` C ${cx + hx} ${apexTop} ${cx + half} ${corner - vTop} ${cx + half} ${corner}`
    + ` C ${cx + half} ${corner + vBottom} ${cx + hx} ${apexBottom} ${cx} ${apexBottom}`
    + ` C ${cx - hx} ${apexBottom} ${cx - half} ${corner + vBottom} ${cx - half} ${corner} Z`;
};

/**
 * The same lens with no curvature at all — an axis-aligned box between the two
 * apexes. A pixel face can't be drawn with quadratics, and this keeps it on the
 * same contract instead of forking the geometry: it is sized off the apexes the
 * other two primitives *reach*, so `width`/`height` still mean the same thing.
 *
 * `curve` only slides it, because a rectangle has no corners to lift. That is a
 * real trade — a style using this gets its expression from the eyes and brows.
 */
export const boxLensPath = (options: LensOptions): string => {
  const { cx } = options;
  const { half, corner, top, bottom } = lensGeometry(options);
  const apexTop = (corner + top) / 2;
  const apexBottom = (corner + bottom) / 2;
  return `M ${cx - half} ${apexTop} L ${cx + half} ${apexTop}`
    + ` L ${cx + half} ${apexBottom} L ${cx - half} ${apexBottom} Z`;
};

/** Which primitive a feature is drawn with. */
export type LensFinish = 'pointed' | 'round' | 'box';

const LENS_FINISHES: Record<LensFinish, (options: LensOptions) => string> = {
  pointed: lensPath,
  round: roundLensPath,
  box: boxLensPath,
};

export const MOUTH_ORIGIN = { cx: 200, cy: 188 } as const;
export const EYE_ORIGIN = { l: { cx: 175, cy: 138 }, r: { cx: 225, cy: 138 } } as const;

/**
 * Where the parametric features sit and how big they are. Everything else about
 * a face is a drawn path, but the mouth and eyes are computed, so an art style
 * that moves the eyes or wants a wider mouth has to say so here.
 *
 * `open` is the opening at channel value 1, not the resting size — the resting
 * size of both features is their `minThickness`.
 */
export interface FaceGeometry {
  mouth: {
    cx: number;
    cy: number;
    width: number;
    open: number;
    minThickness: number;
    /** Defaults to `pointed`: a mouth wants corners. */
    finish?: LensFinish;
  };
  eye: {
    l: { cx: number; cy: number };
    r: { cx: number; cy: number };
    width: number;
    open: number;
    /** Defaults to `round`: an almond has visible corners, an eye shouldn't. */
    finish?: LensFinish;
  };
}

// A closed mouth is a *drawn line*, not a filled shape — the outline stroke over
// a near-zero lens is the whole smile. `minThickness` is the floor that keeps it
// from collapsing to nothing; anything larger reads as an open mouth at rest.
//
// The eye's opening is `width * 2` so a resting eye is a plain circle: a
// quadratic reaches half its control offset, so the visual height is `open / 2`.
export const DEFAULT_FACE_GEOMETRY: FaceGeometry = {
  mouth: { ...MOUTH_ORIGIN, width: 52, open: 44, minThickness: 2.5 },
  eye: { ...EYE_ORIGIN, width: 32, open: 64 },
};

export const mouthPath = (pose: Pose, face: FaceGeometry = DEFAULT_FACE_GEOMETRY): string => LENS_FINISHES[face.mouth.finish ?? 'pointed']({
  cx: face.mouth.cx,
  cy: face.mouth.cy,
  width: face.mouth.width * (pose['face.mouthWide'] ?? 1),
  height: face.mouth.open * (pose['face.mouthOpen'] ?? 0),
  curve: pose['face.mouthCurve'] ?? 0,
  minThickness: face.mouth.minThickness,
});

export const eyePath = (
  pose: Pose,
  side: 'l' | 'r',
  face: FaceGeometry = DEFAULT_FACE_GEOMETRY,
): string => {
  const origin = face.eye[side];
  const open = pose[side === 'l' ? 'face.eyeOpenL' : 'face.eyeOpenR'] ?? 1;
  const curve = pose[side === 'l' ? 'face.eyeCurveL' : 'face.eyeCurveR'] ?? 0;
  // Opens symmetrically (`openUp: 0.5`) so the shape grows about its centre — at
  // 0 it would be flat-topped and read as permanently half-lidded however wide a
  // clip opens it.
  //
  // `minThickness: 0` so the eye genuinely closes. A floor here would leave a
  // sliver of white showing through every blink and every held squint; the lid
  // line below is what makes a shut eye readable instead.
  return LENS_FINISHES[face.eye.finish ?? 'round']({
    cx: origin.cx,
    cy: origin.cy,
    width: face.eye.width,
    height: face.eye.open * open,
    curve,
    minThickness: 0,
    openUp: 0.5,
  });
};

/** Below this the eye is drawn as a lid line; above it, purely as an open eye. */
const LID_VISIBLE_BELOW = 0.34;
/** Above this the lid is gone entirely. */
const LID_GONE_ABOVE = 0.16;

/**
 * How strongly to ink the lid line over the eye, 0..1.
 *
 * The open eye and the shut eye are two different drawings, and this crossfades
 * them. An open eye is a white disc with no outline at all — a rim on it fights
 * the pupil for the same job and drags the whole face heavier. But a *shut* eye
 * has no white left to read, so it has to be a drawn line, the same weight as
 * the brow above it.
 *
 * Stroking `eyePath` gives exactly that line for free: at `eyeOpen: 0` the lens
 * is degenerate and the path collapses onto the arc the lids meet along, so the
 * shut eye already curves with `eyeCurve` — a laugh squints upward and a sob
 * squints downward without a second shape existing.
 */
export const eyeLidInk = (pose: Pose, side: 'l' | 'r'): number => {
  const open = pose[side === 'l' ? 'face.eyeOpenL' : 'face.eyeOpenR'] ?? 1;
  const t = (LID_VISIBLE_BELOW - open) / (LID_VISIBLE_BELOW - LID_GONE_ABOVE);
  return Math.min(1, Math.max(0, t));
};

// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------

/**
 * A skin is only colour in this iteration — the art itself is fixed. The rig
 * contract is what matters: any future skin binds to the same channels, so
 * every emote authored today keeps working.
 *
 * Every skin is a recolour of the *same* drawing, which is deliberate: the
 * house style is one character — plain tee, no props, heavy uniform ink line,
 * flat fills, exactly one shade per material — and a skin may not break it.
 * `--rig-line` therefore stays near-black in all of them; a coloured outline is
 * what makes a cast stop looking like one cast.
 */
export interface Skin {
  id: string;
  name: string;
  colours: Record<string, string>;
}

/** The base: light tan, forest-green tee. */
const ROWAN: Skin = {
  id: 'rowan',
  name: 'Rowan',
  colours: {
    '--rig-skin': '#eeba8c',
    '--rig-skin-shade': '#d99a68',
    '--rig-skin-deep': '#b87a4e',
    '--rig-shirt': '#0b5b30',
    '--rig-shirt-shade': '#06391e',
    '--rig-eye-white': '#ffffff',
    '--rig-pupil': '#100d0c',
    '--rig-brow': '#100d0c',
    '--rig-mouth': '#7a2d2d',
    '--rig-teeth': '#ffffff',
    '--rig-tongue': '#d3596a',
    '--rig-blush': '#e0736b',
    '--rig-tear': '#7fc6f2',
    '--rig-line': '#100d0c',
  },
};

const JUNO: Skin = {
  id: 'juno',
  name: 'Juno',
  colours: {
    '--rig-skin': '#8d5f45',
    '--rig-skin-shade': '#734a35',
    '--rig-skin-deep': '#5f3c2c',
    '--rig-shirt': '#22356e',
    '--rig-shirt-shade': '#141f47',
    '--rig-eye-white': '#ffffff',
    '--rig-pupil': '#100d0c',
    '--rig-brow': '#100d0c',
    '--rig-mouth': '#5c2028',
    '--rig-teeth': '#ffffff',
    '--rig-tongue': '#cf5566',
    '--rig-blush': '#c65a52',
    '--rig-tear': '#7fc6f2',
    '--rig-line': '#100d0c',
  },
};

const WREN: Skin = {
  id: 'wren',
  name: 'Wren',
  colours: {
    '--rig-skin': '#f6d3ae',
    '--rig-skin-shade': '#e0b184',
    '--rig-skin-deep': '#c08f61',
    '--rig-shirt': '#c4441f',
    '--rig-shirt-shade': '#8d2c11',
    '--rig-eye-white': '#ffffff',
    '--rig-pupil': '#100d0c',
    '--rig-brow': '#100d0c',
    '--rig-mouth': '#6e2019',
    '--rig-teeth': '#ffffff',
    '--rig-tongue': '#e0697a',
    '--rig-blush': '#ef8378',
    '--rig-tear': '#7fc6f2',
    '--rig-line': '#100d0c',
  },
};

export const SKINS: Skin[] = [ROWAN, JUNO, WREN];

export const DEFAULT_SKIN: Skin = ROWAN;
