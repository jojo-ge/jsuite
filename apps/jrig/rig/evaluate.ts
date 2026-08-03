// The one copy of the pose layer stack. The renderer's per-frame evaluate and
// the studio's edit pose both compose through here — before this module they
// were two hand-kept copies of `rest → base → emote×weight → overlay`, which
// was the most likely drift point in a merged studio (see docs/PLAN.md, M1).

import type { Clip, Pose } from './core';

import { applyPose, createRestPose, sampleClip } from './core';

export interface ClipAt {
  clip: Clip;
  /** Seconds into the clip. */
  time: number;
}

export interface EmoteAt extends ClipAt {
  /** Blend weight in [0, 1] — sparseness of the clip's tracks is the mask. */
  weight: number;
}

export interface ComposeInput {
  base?: ClipAt | null;
  emote?: EmoteAt | null;
  /** Applied last at full weight — the editor's scratch / manual pose. */
  overlay?: Partial<Pose> | null;
}

/** Builds `rest → base → emote×weight → overlay` into a fresh pose. */
export const composePose = ({ base, emote, overlay }: ComposeInput): Pose => {
  const pose = createRestPose();
  if (base) {
    applyPose(pose, sampleClip(base.clip, base.time));
  }
  if (emote) {
    applyPose(pose, sampleClip(emote.clip, emote.time), emote.weight);
  }
  if (overlay) {
    applyPose(pose, overlay);
  }
  return pose;
};

// --- emote fader ------------------------------------------------------------

export interface EmoteFaderOptions {
  /** Seconds to blend an emote in / out. */
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * The emote layer's state machine: play → fade in → (release | run out) →
 * fade out → done. Retriggering mid-emote keeps the current weight so the
 * blend never pops; a non-looping clip starts its fade-out `fadeOut` seconds
 * before its end so it lands back on the base layer exactly at `duration`.
 */
export const createEmoteFader = ({ fadeIn = 0.12, fadeOut = 0.22 }: EmoteFaderOptions = {}) => {
  let clip: Clip | null = null;
  let time = 0;
  let weight = 0;
  let releasing = false;

  return {
    /** The emote layer for `composePose`, or null when nothing is playing. */
    get active(): EmoteAt | null {
      return clip ? { clip, time, weight } : null;
    },
    play(next: Clip) {
      clip = next;
      time = 0;
      releasing = false;
    },
    /** Begin fading out early (a looping emote only ends this way). */
    release() {
      if (clip) {
        releasing = true;
      }
    },
    /**
     * Advance time and weight. Returns the id of a clip that just finished —
     * exactly once, on the frame its weight reaches zero — or null.
     */
    advance(dt: number): string | null {
      if (!clip) {
        return null;
      }
      time += dt;
      const remaining = clip.duration - time;
      if (releasing || (!clip.loop && remaining <= fadeOut)) {
        weight = Math.max(0, weight - dt / fadeOut);
      }
      else {
        weight = Math.min(1, weight + dt / fadeIn);
      }
      if (weight <= 0 && (releasing || time >= clip.duration)) {
        const finished = clip.id;
        clip = null;
        releasing = false;
        return finished;
      }
      return null;
    },
  };
};

export type EmoteFader = ReturnType<typeof createEmoteFader>;

// --- ambient layer ----------------------------------------------------------

export interface AmbientOptions {
  /** Injectable randomness so specs can pin the blink schedule. */
  random?: () => number;
}

const BLINK_S = 0.16;
const BLINK_CLOSE_FRACTION = 0.35;

/**
 * Breathing, sway and autonomous blinking, applied last so the character is
 * never completely still whatever is playing. Additive rather than absolute,
 * so it survives any pose the editor produces. Stateful: it owns its own
 * clock (advance every frame, even while paused-and-held, so a long hold
 * keeps breathing) and the blink schedule.
 */
export const createAmbient = ({ random = Math.random }: AmbientOptions = {}) => {
  let time = 0;
  let nextBlinkAt = 0;
  let blinkStartedAt = -1;

  const scheduleBlink = (from: number) => {
    nextBlinkAt = from + 2.2 + random() * 3.4;
  };
  scheduleBlink(0);

  return {
    /** Free-running clock, for effects that keep moving through a hold. */
    get time() {
      return time;
    },
    advance(dt: number) {
      time += dt;
    },
    apply(pose: Pose) {
      const t = time;
      const breath = Math.sin((t / 4.4) * Math.PI * 2);
      pose['chest.sy'] = (pose['chest.sy'] ?? 1) + breath * 0.012;
      pose['chest.y'] = (pose['chest.y'] ?? 0) + breath * 1.2;
      pose['root.x'] = (pose['root.x'] ?? 0) + Math.sin(t * 0.37) * 1.2 + Math.sin(t * 0.23) * 0.8;
      pose['root.rot'] = (pose['root.rot'] ?? 0) + Math.sin(t * 0.29) * 0.35;

      if (t >= nextBlinkAt && blinkStartedAt < 0) {
        blinkStartedAt = t;
      }
      if (blinkStartedAt >= 0) {
        const progress = (t - blinkStartedAt) / BLINK_S;
        if (progress >= 1) {
          blinkStartedAt = -1;
          scheduleBlink(t);
        }
        else {
          // Lids snap shut and drift back open — a symmetric curve reads mechanical.
          const shape = progress < BLINK_CLOSE_FRACTION
            ? progress / BLINK_CLOSE_FRACTION
            : 1 - (progress - BLINK_CLOSE_FRACTION) / (1 - BLINK_CLOSE_FRACTION);
          // Multiplicative, so a blink reads over a squint or a wide-eyed pose
          // without ever fighting the clip that authored it.
          const lid = 1 - Math.sin(shape * (Math.PI / 2)) * 0.96;
          const openL = pose['face.eyeOpenL'] ?? 1;
          const openR = pose['face.eyeOpenR'] ?? 1;
          if (openL > 0.25) {
            pose['face.eyeOpenL'] = openL * lid;
          }
          if (openR > 0.25) {
            pose['face.eyeOpenR'] = openR * lid;
          }
        }
      }
    },
  };
};

export type Ambient = ReturnType<typeof createAmbient>;
