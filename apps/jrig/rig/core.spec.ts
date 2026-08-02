import { describe, expect, it } from 'vitest';

import type { Clip, Pose } from './core';

import { BUILT_IN_CLIPS } from './clips';
import {
  applyPose,
  computeJointFrames,
  createRestPose,
  EYE_ORIGIN,
  eyeLidInk,
  eyePath,
  JOINTS_BY_ID,
  lensPath,
  mouthPath,
  putKeyframe,
  REST_POSE,
  roundLensPath,
  sampleClip,
  sampleTrack,
} from './core';

// Mirrors the shirt path in AvatarRig.vue: the mass tops out at y≈242 on the
// shoulders and reaches roughly 116 either side of centre.
const TORSO_TOP_Y = 242;
const TORSO_HALF_WIDTH_AT_SHOULDER = 116;

const clip = (tracks: Clip['tracks'], overrides: Partial<Clip> = {}): Clip => ({
  id: 'test',
  name: 'Test',
  duration: 1,
  loop: false,
  layer: 'emote',
  tracks,
  ...overrides,
});

describe('sampleTrack', () => {
  it('returns undefined for an empty track', () => {
    expect(sampleTrack([], 0.5)).toBeUndefined();
  });

  it('clamps outside the keyed range', () => {
    const keys = [{ t: 0.2, v: 5 }, { t: 0.8, v: 9 }];
    expect(sampleTrack(keys, 0)).toBe(5);
    expect(sampleTrack(keys, 2)).toBe(9);
  });

  it('interpolates between keyframes', () => {
    const value = sampleTrack([{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 10, e: 'linear' }], 0.25);
    expect(value).toBeCloseTo(2.5);
  });

  it('holds the outgoing value for stepped easing', () => {
    const keys = [{ t: 0, v: 0, e: 'hold' as const }, { t: 1, v: 1 }];
    expect(sampleTrack(keys, 0.99)).toBe(0);
    expect(sampleTrack(keys, 1)).toBe(1);
  });
});

describe('sampleClip', () => {
  it('wraps time for looping clips', () => {
    const looping = clip({ 'head.rot': [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 20, e: 'linear' }] }, {
      duration: 2,
      loop: true,
    });
    expect(sampleClip(looping, 1)?.['head.rot']).toBeCloseTo(10);
    expect(sampleClip(looping, 3)?.['head.rot']).toBeCloseTo(10);
  });

  it('only returns the channels the clip animates — that sparseness is the layer mask', () => {
    const sampled = sampleClip(clip({ 'armRUp.rot': [{ t: 0, v: -90 }] }), 0);
    expect(Object.keys(sampled)).toEqual(['armRUp.rot']);
    expect(sampled['face.mouthOpen']).toBeUndefined();
  });
});

describe('applyPose', () => {
  it('leaves unkeyed channels untouched so an emote layers over a base clip', () => {
    const pose = createRestPose();
    applyPose(pose, { 'face.mouthOpen': 0.8 });
    applyPose(pose, { 'armRUp.rot': -140 });
    expect(pose['face.mouthOpen']).toBe(0.8);
    expect(pose['armRUp.rot']).toBe(-140);
  });

  it('blends by weight', () => {
    const pose = createRestPose();
    pose['head.rot'] = 0;
    applyPose(pose, { 'head.rot': 10 }, 0.5);
    expect(pose['head.rot']).toBeCloseTo(5);
  });

  it('snaps stepped channels instead of blending them', () => {
    const pose = createRestPose();
    const rest = REST_POSE['armR.front'] as number;
    const other = rest === 1 ? 0 : 1;
    // Below half weight the incoming value is ignored outright; above it, it
    // takes over whole. A hand is never half in front of the face.
    applyPose(pose, { 'armR.front': other }, 0.4);
    expect(pose['armR.front']).toBe(rest);
    applyPose(pose, { 'armR.front': other }, 0.6);
    expect(pose['armR.front']).toBe(other);
  });
});

describe('putKeyframe', () => {
  it('inserts in time order', () => {
    const keys = putKeyframe(putKeyframe([], 1, 10), 0.5, 5);
    expect(keys.map(key => key.t)).toEqual([0.5, 1]);
  });

  it('replaces a keyframe at the same time rather than duplicating it', () => {
    const keys = putKeyframe(putKeyframe([], 0.5, 5), 0.5, 9);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.v).toBe(9);
  });
});

describe('computeJointFrames', () => {
  it('places every pivot at its rest position for the rest pose', () => {
    const frames = computeJointFrames({ pose: createRestPose() });
    expect(frames.head.x).toBeCloseTo(JOINTS_BY_ID.head.pivot[0]);
    expect(frames.head.y).toBeCloseTo(JOINTS_BY_ID.head.pivot[1]);
    expect(frames.armRUp.rot).toBeCloseTo(0);
  });

  it('propagates a parent rotation down the chain', () => {
    const pose: Pose = { ...createRestPose(), 'chest.rot': 90 };
    const frames = computeJointFrames({ pose });
    // A quarter turn about the chest pivot maps (dx, dy) → (-dy, dx).
    const [cx, cy] = JOINTS_BY_ID.chest.pivot;
    const [sx, sy] = JOINTS_BY_ID.armRUp.pivot;
    expect(frames.armRUp.x).toBeCloseTo(cx - (sy - cy));
    expect(frames.armRUp.y).toBeCloseTo(cy + (sx - cx));
    expect(frames.armRUp.rot).toBeCloseTo(90);
    expect(frames.armRUp.parentRot).toBeCloseTo(90);
  });

  it('keeps every shoulder inside the torso silhouette at rest', () => {
    // The sleeve capsule is drawn around the shoulder pivot, sized to sit
    // between the arm's outline and the shirt's. A pivot on (or outside) the
    // body outline leaves no room for it, and the resting arm then reads as
    // detached from the shoulder rather than hanging off it.
    const frames = computeJointFrames({ pose: createRestPose() });
    for (const id of ['armLUp', 'armRUp'] as const) {
      expect(frames[id].y, id).toBeGreaterThan(TORSO_TOP_Y);
      expect(Math.abs(frames[id].x - 200), id).toBeLessThan(TORSO_HALF_WIDTH_AT_SHOULDER);
    }
  });

  it('rotates a joint about its own pivot without moving it', () => {
    const frames = computeJointFrames({ pose: { ...createRestPose(), 'armRUp.rot': -150 } });
    expect(frames.armRUp.x).toBeCloseTo(JOINTS_BY_ID.armRUp.pivot[0]);
    expect(frames.armRUp.y).toBeCloseTo(JOINTS_BY_ID.armRUp.pivot[1]);
    // ...but its tip, and therefore the whole forearm, swings up.
    expect(frames.armRUp.tipY).toBeLessThan(JOINTS_BY_ID.armRUp.pivot[1]);
  });
});

describe('parametric face geometry', () => {
  // `lensPath` is `M x0 corner Q cx top x1 corner Q cx bottom x0 corner Z`, so
  // these three numbers are its corner line and its two control offsets.
  const controls = (path: string) => {
    const n = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    return { corner: n[1] as number, top: n[3] as number, bottom: n[7] as number };
  };

  /** Bounding box of a path. Every command here takes plain x/y pairs. */
  const bounds = (path: string) => {
    const n = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const xs = n.filter((_, index) => index % 2 === 0);
    const ys = n.filter((_, index) => index % 2 === 1);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  };

  it('produces a finite path at every extreme', () => {
    const extremes = [
      { curve: -1, height: 0 },
      { curve: 1, height: 0 },
      { curve: 0, height: 60 },
      { curve: -1, height: 60 },
    ];
    for (const { curve, height } of extremes) {
      for (const primitive of [lensPath, roundLensPath]) {
        const path = primitive({ cx: 200, cy: 200, width: 50, height, curve, minThickness: 4 });
        expect(path).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it('sizes the round primitive to match what the pointed one reaches', () => {
    // The two differ only in whether the corners are pointed, so every caller
    // constant has to carry over between them unchanged. A quadratic reaches
    // half its control offset, and that is where the round version puts its
    // apexes outright.
    const options = { cx: 200, cy: 200, width: 50, height: 40, curve: 0.3, minThickness: 4 };
    const { corner, top, bottom } = controls(lensPath(options));
    const round = bounds(roundLensPath(options));
    expect(round.minY).toBeCloseTo(Math.min(corner, (corner + top) / 2), 5);
    expect(round.maxY).toBeCloseTo(Math.max(corner, (corner + bottom) / 2), 5);
    expect(round.maxX - round.minX).toBeCloseTo(options.width, 5);
  });

  it('keeps a closed mouth visible as a line rather than collapsing', () => {
    const closed = mouthPath({ ...createRestPose(), 'face.mouthOpen': 0 });
    const open = mouthPath({ ...createRestPose(), 'face.mouthOpen': 1 });
    expect(closed).not.toBe(open);
    expect(closed).not.toMatch(/NaN/);
  });

  it('drives each eye independently so a rig can wink', () => {
    const pose: Pose = { ...createRestPose(), 'face.eyeOpenL': 0, 'face.eyeOpenR': 1 };
    expect(eyePath(pose, 'l')).not.toBe(eyePath(pose, 'r'));
  });

  it('draws a fully-open eye as a circle centred on its origin', () => {
    // Round, not almond. The eye carries no outline of its own, so its shape is
    // the whole read — and an almond's pointed corners are exactly the detail
    // this style does not have.
    const { minX, maxX, minY, maxY } = bounds(eyePath({ ...createRestPose(), 'face.eyeOpenL': 1 }, 'l'));
    expect(maxX - minX).toBeCloseTo(maxY - minY, 5);
    // ...and it opens about that centre rather than downward from a lid line. A
    // lens that only opens downward is flat-topped, and the character then looks
    // permanently half-lidded however wide the clip opens it.
    expect(EYE_ORIGIN.l.cy - minY).toBeCloseTo(maxY - EYE_ORIGIN.l.cy, 5);
  });

  it('closes the eye all the way, and inks the lid line when it does', () => {
    // A thickness floor here would leave a sliver of white showing through every
    // blink and every held squint. The eye is allowed to vanish because the lid
    // line takes over as it goes.
    const shut = { ...createRestPose(), 'face.eyeOpenL': 0, 'face.eyeCurveL': 0 };
    const box = bounds(eyePath(shut, 'l'));
    expect(box.maxY - box.minY).toBeCloseTo(0, 5);
    expect(eyeLidInk(shut, 'l')).toBe(1);
  });

  it('keeps the lid off a wide-open eye, so it never reads as an outline', () => {
    expect(eyeLidInk(createRestPose(), 'l')).toBe(0);
    expect(eyeLidInk({ ...createRestPose(), 'face.eyeOpenL': 0.6 }, 'l')).toBe(0);
  });

  it('curves the shut eye with eyeCurve, so a laugh and a sob squint differently', () => {
    // The lid line is the eye path stroked, so this falls out of the same
    // geometry rather than needing a second shape.
    const shut = (curve: number) => bounds(eyePath(
      { ...createRestPose(), 'face.eyeOpenL': 0, 'face.eyeCurveL': curve },
      'l',
    ));
    expect(shut(0.9).minY).toBeLessThan(shut(0).minY);
    expect(shut(-0.9).maxY).toBeGreaterThan(shut(0).maxY);
  });

  it('opens the mouth downward from the lip line', () => {
    const { corner, top, bottom } = controls(mouthPath({ ...createRestPose(), 'face.mouthOpen': 1, 'face.mouthCurve': 0 }));
    expect(top).toBeCloseTo(corner, 5);
    expect(bottom).toBeGreaterThan(corner);
  });

  it('lifts the corners enough for a resting smile to actually read', () => {
    const flat = controls(mouthPath({ ...createRestPose(), 'face.mouthCurve': 0 }));
    const resting = controls(mouthPath(createRestPose()));
    expect(flat.corner - resting.corner).toBeGreaterThan(4);
  });
});

describe('built-in clips', () => {
  it('exposes the emotes the rig ships with', () => {
    expect(BUILT_IN_CLIPS.map(entry => entry.id)).toEqual([
      'idle',
      'talking',
      'laugh',
      'cry',
      'facepalm',
      'raiseHand',
      'wave',
      'point',
      'thumbsUp',
      'shrug',
    ]);
  });

  it('only references channels the rig actually has', () => {
    for (const entry of BUILT_IN_CLIPS) {
      for (const channel of Object.keys(entry.tracks)) {
        expect(REST_POSE[channel], `${entry.id} → ${channel}`).toBeDefined();
      }
    }
  });

  it('keeps every keyframe inside its clip duration and in time order', () => {
    for (const entry of BUILT_IN_CLIPS) {
      for (const [channel, keys] of Object.entries(entry.tracks)) {
        const times = keys.map(key => key.t);
        expect(times, `${entry.id} → ${channel}`).toEqual([...times].sort((a, b) => a - b));
        expect(Math.max(...times), `${entry.id} → ${channel}`).toBeLessThanOrEqual(entry.duration);
        expect(Math.min(...times)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('returns every emote to rest so it can hand back to the base loop', () => {
    const rest = createRestPose();
    for (const entry of BUILT_IN_CLIPS.filter(candidate => candidate.layer === 'emote')) {
      const end = sampleClip(entry, entry.duration);
      for (const [channel, value] of Object.entries(end)) {
        expect(value, `${entry.id} → ${channel}`).toBeCloseTo(rest[channel] ?? 0, 1);
      }
    }
  });
});
