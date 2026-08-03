import { describe, expect, it } from 'vitest';

import type { ArtStyle } from './styles';

import { JOINTS_BY_ID } from './core';
import { ART_STYLES, AVATAR_CHEST_Y, avatarViewBox, DEFAULT_ART_STYLE, STYLES_BY_ID } from './styles';

// Bounding box of a path whose commands all take plain x/y pairs (C, Q, L, M).
// Arc segments carry flags that would poison this, so nothing here feeds it one.
const bounds = (path: string) => {
  expect(path).not.toMatch(/a\s/i);
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

const viewBox = (value: string) => {
  const parts = value.trim().split(/\s+/).map(Number);
  expect(parts).toHaveLength(4);
  expect(parts.every(Number.isFinite)).toBe(true);
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, width, height, right: x + width, bottom: y + height };
};

const [SHOULDER_X, SHOULDER_Y] = JOINTS_BY_ID.armLUp.pivot;
const [WRIST_X, WRIST_Y] = JOINTS_BY_ID.armLHand.pivot;

const each = (assert: (style: ArtStyle) => void) => {
  for (const style of ART_STYLES) {
    assert(style);
  }
};

describe('the style registry', () => {
  it('has unique ids and includes the default', () => {
    expect(Object.keys(STYLES_BY_ID)).toHaveLength(ART_STYLES.length);
    expect(ART_STYLES).toContain(DEFAULT_ART_STYLE);
  });

  it('frames the bust inside the wider rig view box', () => {
    each((style) => {
      const bust = viewBox(style.viewBox.bust);
      const rig = viewBox(style.viewBox.rig);
      expect(rig.x, style.id).toBeLessThanOrEqual(bust.x);
      expect(rig.y, style.id).toBeLessThanOrEqual(bust.y);
      expect(rig.right, style.id).toBeGreaterThanOrEqual(bust.right);
      expect(rig.bottom, style.id).toBeGreaterThanOrEqual(bust.bottom);
    });
  });

  it('grades its ink from silhouette down to interior detail', () => {
    each((style) => {
      expect(style.ink.detail, style.id).toBeGreaterThan(0);
      expect(style.ink.silhouette, style.id).toBeGreaterThanOrEqual(style.ink.feature);
      expect(style.ink.feature, style.id).toBeGreaterThanOrEqual(style.ink.detail);
    });
  });
});

describe('the parametric face', () => {
  it('stays symmetric about the centre line, because half the art is mirrored', () => {
    each((style) => {
      const { l, r } = style.face.eye;
      expect(style.face.mouth.cx, style.id).toBe(200);
      expect(l.cx + r.cx, style.id).toBe(400);
      expect(l.cy, style.id).toBe(r.cy);
    });
  });

  it('keeps the eyes and mouth inside the head silhouette', () => {
    each((style) => {
      const head = bounds(style.head.path);
      const { eye, mouth } = style.face;
      expect(eye.l.cx - eye.width / 2, style.id).toBeGreaterThan(head.minX);
      expect(eye.r.cx + eye.width / 2, style.id).toBeLessThan(head.maxX);
      expect(eye.l.cy, style.id).toBeGreaterThan(head.minY);
      // The mouth opens downward from its origin, and `open` is a control offset
      // that the curve only reaches half of.
      expect(mouth.cy + mouth.open / 2, style.id).toBeLessThan(head.maxY);
    });
  });

  it('leaves white around every pupil — a pupil that fills the eye reads as alarmed', () => {
    each((style) => {
      expect(style.pupil.r * 2, style.id).toBeLessThan(style.face.eye.width);
    });
  });
});

describe('the silhouette rules', () => {
  // Both of these are the same failure the shoulder-pivot spec protects in the
  // house style, generalised: the sleeve is a capsule centred on the arm bone,
  // and the shirt has to swallow its cap whole.
  it('tops the shirt out above the shoulder pivot by more than the sleeve cap', () => {
    each((style) => {
      const shirt = bounds(style.torso.shirt);
      const cap = (style.arm.sleeve?.width ?? style.arm.edgeWidth) / 2;
      expect(shirt.minY, style.id).toBeLessThan(SHOULDER_Y - cap);
      expect(shirt.minX, style.id).toBeLessThan(SHOULDER_X);
      expect(shirt.maxX, style.id).toBeGreaterThan(400 - SHOULDER_X);
    });
  });

  // A style can move the shoulder joint outboard, and the limb *starts* at that
  // joint — so pushed past the shirt edge, the bare shoulder hangs outside the
  // garment it is meant to be inside.
  it('keeps a moved shoulder joint far enough in for the shirt to cover the limb root', () => {
    each((style) => {
      const { shoulder, rig } = style.arm;
      if (!shoulder || !rig) {
        return;
      }
      const root = rig.taper[0]?.r ?? 0;
      expect(shoulder.x - root, style.id).toBeGreaterThanOrEqual(bounds(style.torso.shirt).minX);
    });
  });

  it('cuts every sleeve wider than the arm outline it has to bury', () => {
    each((style) => {
      expect(style.arm.edgeWidth, style.id).toBeGreaterThan(style.arm.fillWidth);
      if (style.arm.sleeve) {
        expect(style.arm.sleeve.width, style.id).toBeGreaterThan(style.arm.edgeWidth);
      }
    });
  });

  it('hangs the hand off the wrist joint', () => {
    each((style) => {
      const hand = bounds(style.arm.hand);
      expect(hand.minX, style.id).toBeLessThan(WRIST_X);
      expect(hand.maxX, style.id).toBeGreaterThan(WRIST_X);
      expect(Math.abs(hand.minY - WRIST_Y), style.id).toBeLessThan(24);
    });
  });
});

// The round avatar cut-out. It is derived, not authored, so the guarantees have
// to hold for every frame it could ever be handed — these styles are the seed
// source for the documents the app actually renders, so they are the widest
// spread of bust frames available to test against.
describe('avatarViewBox', () => {
  const parse = (box: string) => {
    const [x, y, width, height] = box.trim().split(/\s+/).map(Number) as [number, number, number, number];
    return { x, y, width, height, right: x + width, bottom: y + height };
  };

  it('is square and centred on the mirror axis, so the circle is a circle', () => {
    each((style) => {
      const frame = parse(avatarViewBox(style.viewBox.bust));
      expect(frame.width, style.id).toBe(frame.height);
      expect((frame.x + frame.right) / 2, style.id).toBe(200);
    });
  });

  it('starts where the character says it starts and stops at the chest', () => {
    each((style) => {
      const bust = parse(style.viewBox.bust);
      const frame = parse(avatarViewBox(style.viewBox.bust));
      expect(frame.y, style.id).toBe(bust.y);
      expect(frame.bottom, style.id).toBe(AVATAR_CHEST_Y);
    });
  });

  it('keeps the hands out of shot — the whole reason the crop exists', () => {
    const [, wristY] = JOINTS_BY_ID.armLHand.pivot;
    each((style) => {
      expect(parse(avatarViewBox(style.viewBox.bust)).bottom, style.id).toBeLessThan(wristY);
    });
  });

  it('survives a bust frame that starts below the chest line', () => {
    const frame = parse(avatarViewBox(`0 ${AVATAR_CHEST_Y + 40} 300 300`));
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.width).toBe(frame.height);
  });
});
