// The built-in clip library. Every clip here was authored in the rig editor
// (/avatar-rig) and pasted back — that round trip is the whole point: these are
// data, not code, and nothing about them is privileged.
//
// Sign conventions, all in SVG space (y grows downward, positive rotation is
// clockwise / toward the viewer's right):
//   head.rot +      head tilts to the viewer's right     head.y +   head drops
//   browL.rot +     outer end of the brow drops          (sad inner-up look)
//   browR.rot -     mirror of the above
//   armR*.rot -     the viewer-right arm swings up       armL*.rot +  mirror
// Elbows fold well past 180°: full flexion sweeps the forearm up and over, so
// `armRLow.rot: -205` is a normal deep fold, not a broken joint.

import type { Clip, Digit, Easing, Keyframe } from './core';

import { DIGITS } from './core';

const k = (t: number, v: number, e?: Easing): Keyframe => (e ? { t, v, e } : { t, v });

// --- hands ----------------------------------------------------------------
// Ten bones per hand is too many to keyframe one channel at a time, and doing so
// would also be the wrong shape: a hand pose is a *grip*, not twenty numbers.
// So a clip says how far the digits are curled and how far they are fanned, and
// this expands that into tracks.

/** Degrees at fan = 1, in left-hand rotation terms. Mirrored for the right. */
const FAN_OFFSET: Record<Digit, number> = {
  Thumb: -18,
  Index: -6,
  Middle: 0,
  Ring: 7,
  Pinky: 15,
};

/**
 * The tip folds further than the knuckle — that is the difference between a
 * gripped fist and a flat fold.
 */
const DISTAL_BIAS = 1.2;

/**
 * A closed fist. Past roughly this the two bones together fold the fingertip
 * back through the palm and out the other side: the limb is drawn as a tube
 * offset from its own centreline, and no offset survives a bend tighter than its
 * own width. Curling *is* clamped by anatomy in 3D and has to be here too.
 */
const FIST = 78;

interface HandKey {
  t: number;
  /** Degrees toward the palm. Negative straightens past the resting curl. */
  curl?: number;
  /** Spreads the digits apart, 0..1. */
  fan?: number;
  /** Per-digit override — one straight index in a closed fist is a point. */
  digits?: Partial<Record<Digit, number>>;
  e?: Easing;
}

const handTracks = ({ side, keys }: { side: 'L' | 'R'; keys: HandKey[] }): Record<string, Keyframe[]> => {
  const sign = side === 'L' ? 1 : -1;
  const tracks: Record<string, Keyframe[]> = {};
  for (const digit of DIGITS) {
    tracks[`hand${side}${digit}1.rot`] = keys.map((key) => {
      const curl = key.digits?.[digit] ?? key.curl ?? 0;
      return k(key.t, sign * (FAN_OFFSET[digit] * (key.fan ?? 0) - curl), key.e);
    });
    tracks[`hand${side}${digit}2.rot`] = keys.map((key) => {
      const curl = key.digits?.[digit] ?? key.curl ?? 0;
      return k(key.t, sign * -curl * DISTAL_BIAS, key.e);
    });
  }
  return tracks;
};

/** Same track on both sides of the face. */
const mirrored = (
  left: string,
  right: string,
  keys: Keyframe[],
  flipSign = false,
): Record<string, Keyframe[]> => ({
  [left]: keys,
  [right]: flipSign ? keys.map(key => ({ ...key, v: -key.v })) : keys.map(key => ({ ...key })),
});

const IDLE: Clip = {
  id: 'idle',
  name: 'Idle',
  duration: 6,
  loop: true,
  layer: 'base',
  tracks: {
    'root.x': [k(0, 0), k(1.5, 2), k(3, 0), k(4.5, -2), k(6, 0)],
    'chest.rot': [k(0, 0), k(1.5, 0.7), k(3, 0), k(4.5, -0.7), k(6, 0)],
    'head.rot': [k(0, 0), k(1.5, -1.4), k(3, 0), k(4.5, 1.4), k(6, 0)],
    'head.y': [k(0, 0), k(1.5, 1.2), k(3, 0), k(4.5, 1.2), k(6, 0)],
    'armLUp.rot': [k(0, 0), k(3, 1.6), k(6, 0)],
    'armRUp.rot': [k(0, 0), k(3, -1.6), k(6, 0)],
    'face.pupilX': [k(0, 0), k(1.2, 0.18), k(2.2, 0.18), k(3.6, -0.15), k(4.6, -0.15), k(5.6, 0), k(6, 0)],
  },
};

// A conversational loop, not lipsync: the mouth shapes are deliberately out of
// phase with the width and curve tracks so the rhythm never reads as a metronome.
const TALKING: Clip = {
  id: 'talking',
  name: 'Talking',
  duration: 2.6,
  loop: true,
  layer: 'base',
  tracks: {
    'face.mouthOpen': [
      k(0, 0.12),
      k(0.13, 0.6),
      k(0.28, 0.2),
      k(0.45, 0.72),
      k(0.62, 0.16),
      k(0.8, 0.52),
      k(0.96, 0.24),
      k(1.15, 0.66),
      k(1.33, 0.18),
      k(1.5, 0.48),
      k(1.68, 0.3),
      k(1.86, 0.62),
      k(2.04, 0.2),
      k(2.22, 0.55),
      k(2.4, 0.22),
      k(2.6, 0.12),
    ],
    'face.mouthWide': [k(0, 1), k(0.3, 0.88), k(0.7, 1.12), k(1.1, 0.94), k(1.6, 1.08), k(2.1, 0.9), k(2.6, 1)],
    'face.mouthCurve': [k(0, 0.22), k(0.6, 0.32), k(1.4, 0.16), k(2.1, 0.3), k(2.6, 0.22)],
    'head.rot': [k(0, 0), k(0.5, 1.6), k(1.1, -1.2), k(1.7, 1), k(2.3, -1.6), k(2.6, 0)],
    'head.y': [k(0, 0), k(0.4, -1.5), k(1, 1), k(1.9, -1), k(2.6, 0)],
    'head.x': [k(0, 0), k(0.8, 1.5), k(1.8, -1.5), k(2.6, 0)],
    'chest.rot': [k(0, 0), k(0.9, 0.6), k(2, -0.6), k(2.6, 0)],
    'face.pupilX': [k(0, 0), k(0.7, 0.12), k(1.8, -0.12), k(2.6, 0)],
    ...mirrored('browL.y', 'browR.y', [k(0, 0), k(0.5, -3), k(1, 0), k(1.9, 0), k(2.2, -2), k(2.6, 0)]),
  },
};

const LAUGH: Clip = {
  id: 'laugh',
  name: 'Laugh',
  duration: 2,
  loop: false,
  layer: 'emote',
  tracks: {
    'head.y': [k(0, 0), k(0.14, -3), k(0.35, 5), k(0.55, 2), k(0.8, 5), k(1, 2), k(1.25, 4), k(1.5, 1), k(2, 0)],
    'head.rot': [k(0, 0), k(0.2, -2), k(0.5, 2), k(0.85, -1.5), k(1.2, 1.5), k(2, 0)],
    'head.sy': [k(0, 1), k(0.35, 0.97), k(0.6, 1), k(0.9, 0.97), k(2, 1)],
    'root.y': [k(0, 0), k(0.3, -6), k(0.5, 0), k(0.75, -5), k(0.95, 0), k(1.2, -3), k(1.45, 0), k(2, 0)],
    'chest.rot': [k(0, 0), k(0.35, 2.5), k(0.65, -2), k(0.95, 2), k(1.25, -1.2), k(2, 0)],
    'face.mouthOpen': [
      k(0, 0.1),
      k(0.16, 0.9),
      k(0.36, 0.62),
      k(0.58, 0.92),
      k(0.8, 0.6),
      k(1.02, 0.85),
      k(1.24, 0.55),
      k(1.45, 0.7),
      k(1.7, 0.3),
      k(2, 0),
    ],
    'face.mouthWide': [k(0, 1), k(0.18, 1.28), k(1.4, 1.22), k(2, 1)],
    'face.mouthCurve': [k(0, 0.22), k(0.18, 0.85), k(1.45, 0.85), k(1.8, 0.35), k(2, 0.22)],
    'face.blush': [k(0, 0), k(0.3, 0.5), k(1.4, 0.4), k(2, 0)],
    ...mirrored('face.eyeOpenL', 'face.eyeOpenR', [k(0, 1), k(0.16, 0.12), k(1.4, 0.1), k(1.75, 0.6), k(2, 1)]),
    ...mirrored('face.eyeCurveL', 'face.eyeCurveR', [k(0, 0), k(0.16, 0.9), k(1.4, 0.9), k(1.8, 0.2), k(2, 0)]),
    ...mirrored('browL.y', 'browR.y', [k(0, 0), k(0.16, -6), k(1.4, -5), k(2, 0)]),
    ...mirrored('browL.rot', 'browR.rot', [k(0, 0), k(0.16, -6), k(1.4, -5), k(2, 0)], true),
    // Hand up beside the chin, elbow flared out. Arm-layer only, so the rest of
    // the emote still reads if a skin has no arms in frame.
    'armRUp.rot': [k(0, 0), k(0.3, -118), k(0.55, -127), k(0.95, -122), k(1.3, -127), k(1.9, 0)],
    'armRLow.rot': [k(0, 0), k(0.3, -112), k(0.55, -124), k(0.95, -118), k(1.3, -124), k(1.9, 0)],
    'armRHand.rot': [k(0, 0), k(0.4, 14), k(1.3, 8), k(1.9, 0)],
  },
};

const CRY: Clip = {
  id: 'cry',
  name: 'Cry',
  duration: 2.8,
  loop: false,
  layer: 'emote',
  tracks: {
    'head.y': [k(0, 0), k(0.4, 8), k(0.6, 7), k(0.9, 9), k(1.15, 7), k(1.5, 9), k(1.8, 7.5), k(2.1, 9), k(2.5, 4), k(2.8, 0)],
    'head.rot': [k(0, 0), k(0.4, 3), k(1.2, 2), k(1.9, 3.5), k(2.8, 0)],
    'neck.rot': [k(0, 0), k(0.4, 2), k(2.8, 0)],
    'chest.rot': [k(0, 0), k(0.4, 2), k(1, 1), k(1.7, 2.5), k(2.8, 0)],
    // The shudder that makes it read as sobbing rather than sulking.
    'root.y': [k(0, 0), k(0.4, 3), k(0.75, 1), k(1.05, 3), k(1.35, 1), k(1.65, 3), k(1.95, 1), k(2.3, 2), k(2.8, 0)],
    'torso.sy': [k(0, 1), k(0.5, 0.985), k(0.8, 1), k(1.2, 0.985), k(1.6, 1), k(2.8, 1)],
    'face.mouthCurve': [k(0, 0.22), k(0.3, -0.85), k(2.2, -0.8), k(2.6, -0.3), k(2.8, 0.22)],
    'face.mouthOpen': [k(0, 0), k(0.35, 0.3), k(0.8, 0.2), k(1.3, 0.34), k(1.8, 0.18), k(2.2, 0.3), k(2.8, 0)],
    'face.mouthWide': [k(0, 1), k(0.3, 0.82), k(2.2, 0.85), k(2.8, 1)],
    'face.tear': [k(0, 0), k(0.35, 0), k(0.7, 1), k(2.3, 1), k(2.7, 0)],
    'face.blush': [k(0, 0), k(0.6, 0.35), k(2.2, 0.3), k(2.8, 0)],
    'face.pupilY': [k(0, 0), k(0.4, 0.35), k(2.4, 0.3), k(2.8, 0)],
    'face.browSad': [k(0, 0), k(0.3, 1), k(2.2, 1), k(2.8, 0)],
    ...mirrored('face.eyeOpenL', 'face.eyeOpenR', [k(0, 1), k(0.3, 0.14), k(2.2, 0.1), k(2.6, 0.5), k(2.8, 1)]),
    ...mirrored('face.eyeCurveL', 'face.eyeCurveR', [k(0, 0), k(0.3, -0.8), k(2.2, -0.85), k(2.6, -0.2), k(2.8, 0)]),
    ...mirrored('browL.y', 'browR.y', [k(0, 0), k(0.3, -2), k(2.2, -2), k(2.8, 0)]),
    ...mirrored('browL.rot', 'browR.rot', [k(0, 0), k(0.3, 14), k(2.2, 13), k(2.8, 0)], true),
    // Viewer-left hand comes up to dab at the eye, elbow out.
    'armLUp.rot': [k(0, 0), k(0.35, 122), k(0.6, 158), k(1, 153), k(1.4, 158), k(1.8, 153), k(2.1, 158), k(2.5, 70), k(2.8, 0)],
    'armLLow.rot': [k(0, 0), k(0.35, 50), k(0.6, 62), k(1, 57), k(1.4, 62), k(1.8, 57), k(2.1, 62), k(2.5, 28), k(2.8, 0)],
    'armLHand.rot': [k(0, 0), k(0.6, -10), k(2.2, -8), k(2.8, 0)],
  },
};

const FACEPALM: Clip = {
  id: 'facepalm',
  name: 'Facepalm',
  duration: 2.6,
  loop: false,
  layer: 'emote',
  tracks: {
    // Overshoots slightly at 0.45 then settles — the palm lands, it doesn't glide.
    'armRUp.rot': [k(0, 0), k(0.2, -62), k(0.45, -156), k(0.62, -167), k(1.9, -165), k(2.25, -82), k(2.6, 0)],
    'armRLow.rot': [k(0, 0), k(0.2, -26), k(0.45, -47), k(0.62, -41), k(1.9, -42), k(2.25, -21), k(2.6, 0)],
    'armRHand.rot': [k(0, 0), k(0.3, 14), k(0.62, 29), k(1.9, 27), k(2.6, 0)],
    'head.rot': [k(0, 0), k(0.35, -2), k(0.7, 5), k(1.9, 6), k(2.6, 0)],
    'head.y': [k(0, 0), k(0.35, -2), k(0.68, 7), k(1.5, 9), k(1.9, 8), k(2.6, 0)],
    'neck.rot': [k(0, 0), k(0.7, 2), k(2.6, 0)],
    'chest.rot': [k(0, 0), k(0.75, 3), k(1.9, 2.5), k(2.6, 0)],
    'root.y': [k(0, 0), k(0.75, 3), k(1.6, 4), k(2.6, 0)],
    // The sigh: chest fills on the way up, empties under the palm.
    'torso.sy': [k(0, 1), k(0.5, 1.015), k(1.1, 0.985), k(1.9, 0.995), k(2.6, 1)],
    'face.mouthCurve': [k(0, 0.22), k(0.3, -0.1), k(0.65, -0.45), k(1.9, -0.4), k(2.6, 0.22)],
    'face.mouthOpen': [k(0, 0), k(0.3, 0.18), k(0.65, 0.1), k(1.2, 0.16), k(1.9, 0.06), k(2.6, 0)],
    'face.mouthWide': [k(0, 1), k(0.65, 0.9), k(1.9, 0.92), k(2.6, 1)],
    ...mirrored('face.eyeOpenL', 'face.eyeOpenR', [k(0, 1), k(0.2, 1.1), k(0.62, 0.08), k(1.9, 0.08), k(2.25, 0.7), k(2.6, 1)]),
    ...mirrored('face.eyeCurveL', 'face.eyeCurveR', [k(0, 0), k(0.62, -0.3), k(1.9, -0.3), k(2.6, 0)]),
    ...mirrored('browL.y', 'browR.y', [k(0, 0), k(0.2, -4), k(0.6, 3), k(1.9, 3), k(2.6, 0)]),
    ...mirrored('browL.rot', 'browR.rot', [k(0, 0), k(0.6, 10), k(1.9, 9), k(2.6, 0)], true),
  },
};

// Proves the arm chain in the opposite direction to the facepalm, and that an
// emote can be almost entirely arms: the face barely moves here.
const RAISE_HAND: Clip = {
  id: 'raiseHand',
  name: 'Raise hand',
  duration: 2.2,
  loop: false,
  layer: 'emote',
  tracks: {
    'armRUp.rot': [k(0, 0), k(0.2, -94), k(0.42, -160), k(0.55, -152), k(0.8, -155), k(1.6, -155), k(1.95, -74), k(2.2, 0)],
    'armRLow.rot': [k(0, 0), k(0.2, -6), k(0.42, -13), k(0.62, -3), k(0.85, -15), k(1.1, -3), k(1.35, -15), k(1.6, -7), k(1.95, -3), k(2.2, 0)],
    'armRHand.rot': [k(0, 0), k(0.3, -6), k(0.6, 8), k(0.9, -10), k(1.2, 8), k(1.45, -8), k(1.7, 4), k(2.2, 0)],
    'head.rot': [k(0, 0), k(0.5, -3), k(1.6, -2), k(2.2, 0)],
    'head.y': [k(0, 0), k(0.45, -2), k(1.6, -1), k(2.2, 0)],
    'chest.rot': [k(0, 0), k(0.45, -2.5), k(1.6, -2), k(2.2, 0)],
    'root.y': [k(0, 0), k(0.4, -3), k(1.6, -2), k(2.2, 0)],
    'face.mouthCurve': [k(0, 0.22), k(0.4, 0.55), k(1.6, 0.5), k(2.2, 0.22)],
    'face.mouthOpen': [k(0, 0), k(0.4, 0.22), k(1.6, 0.18), k(2.2, 0)],
    'face.pupilY': [k(0, 0), k(0.5, -0.2), k(1.6, -0.15), k(2.2, 0)],
    ...mirrored('face.eyeOpenL', 'face.eyeOpenR', [k(0, 1), k(0.35, 1.15), k(1.6, 1.1), k(2.2, 1)]),
    ...mirrored('browL.y', 'browR.y', [k(0, 0), k(0.35, -6), k(1.6, -5), k(2.2, 0)]),
  },
};

// The clips below exist to exercise the digits. Everything above them predates
// the hand rig and still plays unchanged — a hand with no keyframes on it just
// sits at its resting curl, which is the whole promise of the layer mask.

const WAVE: Clip = {
  id: 'wave',
  name: 'Wave',
  duration: 2.6,
  loop: false,
  layer: 'emote',
  tracks: {
    // The shoulder girdle goes first and the hand goes last: a wave that starts
    // at the elbow reads as a puppet.
    'armRClav.rot': [k(0, 0), k(0.22, -7), k(2, -6), k(2.6, 0)],
    'armRUp.rot': [k(0, 0), k(0.3, -122), k(0.52, -150), k(0.72, -145), k(2, -146), k(2.3, -68), k(2.6, 0)],
    'armRLow.rot': [k(0, 0), k(0.3, -28), k(0.55, -46), k(2, -43), k(2.6, 0)],
    'armRHand.rot': [
      k(0, 0),
      k(0.55, 4),
      k(0.8, 24),
      k(1.05, -18),
      k(1.3, 24),
      k(1.55, -18),
      k(1.8, 16),
      k(2.05, 0),
      k(2.6, 0),
    ],
    'head.rot': [k(0, 0), k(0.5, -3), k(2, -2.5), k(2.6, 0)],
    'chest.rot': [k(0, 0), k(0.5, -2), k(2, -1.5), k(2.6, 0)],
    'face.mouthCurve': [k(0, 0.22), k(0.4, 0.6), k(2, 0.55), k(2.6, 0.22)],
    'face.mouthOpen': [k(0, 0), k(0.4, 0.26), k(2, 0.2), k(2.6, 0)],
    ...mirrored('browL.y', 'browR.y', [k(0, 0), k(0.4, -5), k(2, -4), k(2.6, 0)]),
    // Open, spread, and just alive enough at the fingertips to not look starched.
    ...handTracks({
      side: 'R',
      keys: [
        { t: 0, curl: 0, fan: 0 },
        { t: 0.5, curl: -16, fan: 1 },
        { t: 1.2, curl: -10, fan: 0.85 },
        { t: 1.8, curl: -16, fan: 1 },
        { t: 2.3, curl: -6, fan: 0.4 },
        { t: 2.6, curl: 0, fan: 0 },
      ],
    }),
  },
};

const POINT: Clip = {
  id: 'point',
  name: 'Point',
  duration: 2.4,
  loop: false,
  layer: 'emote',
  tracks: {
    'armRClav.rot': [k(0, 0), k(0.25, -4), k(1.9, -4), k(2.4, 0)],
    'armRUp.rot': [k(0, 0), k(0.24, -88), k(0.44, -102), k(0.6, -98), k(1.9, -99), k(2.15, -46), k(2.4, 0)],
    'armRLow.rot': [k(0, 0), k(0.24, -42), k(0.44, -60), k(1.9, -57), k(2.4, 0)],
    'armRHand.rot': [k(0, 0), k(0.44, -18), k(1.9, -15), k(2.4, 0)],
    'head.rot': [k(0, 0), k(0.5, -2.5), k(1.9, -2), k(2.4, 0)],
    'face.pupilX': [k(0, 0), k(0.5, 0.4), k(1.9, 0.35), k(2.4, 0)],
    'face.mouthCurve': [k(0, 0.22), k(0.4, 0.4), k(1.9, 0.38), k(2.4, 0.22)],
    ...mirrored('browL.y', 'browR.y', [k(0, 0), k(0.4, -4), k(1.9, -3), k(2.4, 0)]),
    // The whole gesture is one straight finger inside a closed hand.
    ...handTracks({
      side: 'R',
      keys: [
        { t: 0, curl: 0 },
        { t: 0.42, curl: FIST, digits: { Index: -20, Thumb: 40 } },
        { t: 1.9, curl: FIST - 4, digits: { Index: -18, Thumb: 38 } },
        { t: 2.4, curl: 0 },
      ],
    }),
  },
};

const THUMBS_UP: Clip = {
  id: 'thumbsUp',
  name: 'Thumbs up',
  duration: 2.4,
  loop: false,
  layer: 'emote',
  tracks: {
    'armRClav.rot': [k(0, 0), k(0.25, -5), k(1.9, -5), k(2.4, 0)],
    // The forearm folds up to vertical and the hand just carries on along it —
    // the thumb points up because the *arm* does, not because the wrist rolls.
    'armRUp.rot': [k(0, 0), k(0.26, -36), k(0.46, -50), k(0.62, -46), k(1.9, -47), k(2.15, -22), k(2.4, 0)],
    'armRLow.rot': [k(0, 0), k(0.26, -96), k(0.46, -124), k(0.62, -117), k(1.9, -118), k(2.4, 0)],
    'armRHand.rot': [k(0, 0), k(0.5, -8), k(1.9, -8), k(2.4, 0)],
    'head.rot': [k(0, 0), k(0.55, 2.5), k(1.9, 2), k(2.4, 0)],
    'head.y': [k(0, 0), k(0.4, -2), k(1.9, -1.5), k(2.4, 0)],
    'face.mouthCurve': [k(0, 0.22), k(0.45, 0.7), k(1.9, 0.65), k(2.4, 0.22)],
    'face.mouthOpen': [k(0, 0), k(0.45, 0.2), k(1.9, 0.16), k(2.4, 0)],
    ...mirrored('face.eyeOpenL', 'face.eyeOpenR', [k(0, 1), k(0.45, 0.75), k(1.9, 0.8), k(2.4, 1)]),
    ...mirrored('face.eyeCurveL', 'face.eyeCurveR', [k(0, 0), k(0.45, 0.6), k(1.9, 0.55), k(2.4, 0)]),
    ...handTracks({
      side: 'R',
      keys: [
        { t: 0, curl: 0 },
        { t: 0.46, curl: FIST, digits: { Thumb: -30 }, e: 'back' },
        { t: 1.9, curl: FIST - 4, digits: { Thumb: -28 } },
        { t: 2.4, curl: 0 },
      ],
    }),
  },
};

const SHRUG: Clip = {
  id: 'shrug',
  name: 'Shrug',
  duration: 2.6,
  loop: false,
  layer: 'emote',
  tracks: {
    // Both clavicles ride up. This is the clip the shoulder joint was added for:
    // without it a shrug is two arms moving past a torso that never reacts.
    'armLClav.rot': [k(0, 0), k(0.35, 13), k(0.55, 16), k(1.8, 15), k(2.2, 2), k(2.6, 0)],
    'armRClav.rot': [k(0, 0), k(0.35, -13), k(0.55, -16), k(1.8, -15), k(2.2, -2), k(2.6, 0)],
    'armLUp.rot': [k(0, 0), k(0.35, 34), k(0.6, 42), k(1.8, 40), k(2.6, 0)],
    'armRUp.rot': [k(0, 0), k(0.35, -34), k(0.6, -42), k(1.8, -40), k(2.6, 0)],
    'armLLow.rot': [k(0, 0), k(0.35, -58), k(0.6, -76), k(1.8, -74), k(2.6, 0)],
    'armRLow.rot': [k(0, 0), k(0.35, 58), k(0.6, 76), k(1.8, 74), k(2.6, 0)],
    'armLHand.rot': [k(0, 0), k(0.6, -26), k(1.8, -24), k(2.6, 0)],
    'armRHand.rot': [k(0, 0), k(0.6, 26), k(1.8, 24), k(2.6, 0)],
    'neck.y': [k(0, 0), k(0.55, 4), k(1.8, 4), k(2.6, 0)],
    'head.y': [k(0, 0), k(0.55, 3), k(1.8, 3), k(2.6, 0)],
    'head.rot': [k(0, 0), k(0.7, 3), k(1.8, 2.5), k(2.6, 0)],
    'face.mouthCurve': [k(0, 0.22), k(0.5, -0.1), k(1.8, -0.05), k(2.6, 0.22)],
    'face.mouthWide': [k(0, 1), k(0.5, 1.12), k(1.8, 1.1), k(2.6, 1)],
    ...mirrored('browL.y', 'browR.y', [k(0, 0), k(0.45, -7), k(1.8, -6), k(2.6, 0)]),
    ...mirrored('browL.rot', 'browR.rot', [k(0, 0), k(0.45, 8), k(1.8, 7), k(2.6, 0)], true),
    // Both palms open and turn up. Hands do the talking here, not the face.
    ...handTracks({
      side: 'L',
      keys: [{ t: 0, curl: 0 }, { t: 0.6, curl: -18, fan: 0.9 }, { t: 1.8, curl: -16, fan: 0.85 }, { t: 2.6, curl: 0 }],
    }),
    ...handTracks({
      side: 'R',
      keys: [{ t: 0, curl: 0 }, { t: 0.6, curl: -18, fan: 0.9 }, { t: 1.8, curl: -16, fan: 0.85 }, { t: 2.6, curl: 0 }],
    }),
  },
};

export const BUILT_IN_CLIPS: Clip[] = [
  IDLE,
  TALKING,
  LAUGH,
  CRY,
  FACEPALM,
  RAISE_HAND,
  WAVE,
  POINT,
  THUMBS_UP,
  SHRUG,
];

export const cloneClips = (clips: Clip[] = BUILT_IN_CLIPS): Clip[] =>
  clips.map(clip => ({
    ...clip,
    tracks: Object.fromEntries(
      Object.entries(clip.tracks).map(([channel, keys]) => [channel, keys.map(key => ({ ...key }))]),
    ),
  }));
