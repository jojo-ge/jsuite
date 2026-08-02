import { describe, expect, it } from 'vitest';

import type { Point } from './arm';

import {
  ARM_MITTEN,
  ARM_NO_INK,
  ARM_RIGS,
  ARM_SAUSAGE,
  ARM_TAPERED,
  armGeometry,
  radiusAt,
  sampleCentreline,
  tubePath,
} from './arm';
import { createRestPose, JOINTS_BY_ID } from './core';

const numbers = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

const points = (path: string): Point[] => {
  const n = numbers(path);
  const out: Point[] = [];
  for (let i = 0; i < n.length; i += 2) {
    out.push({ x: n[i] as number, y: n[i + 1] as number });
  }
  return out;
};

const distanceToChain = ({ point, chain }: { point: Point; chain: Point[] }) =>
  Math.min(...chain.map(link => Math.hypot(link.x - point.x, link.y - point.y)));

describe('sampleCentreline', () => {
  const bent: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 60, y: 160 }];

  it('passes through every bone joint, whatever the smoothing', () => {
    for (const smooth of [0, 0.5, 1]) {
      const line = sampleCentreline({ points: bent, samples: 21, smooth });
      expect(line[0]).toEqual(bent[0]);
      expect(line[line.length - 1]?.x).toBeCloseTo(60);
      expect(line[line.length - 1]?.y).toBeCloseTo(160);
      // 21 samples over 2 segments puts a sample exactly on the elbow.
      expect(line[10]?.x).toBeCloseTo(0);
      expect(line[10]?.y).toBeCloseTo(100);
    }
  });

  it('rounds the corner off the elbow — that bend is the sausage seam', () => {
    const hinged = sampleCentreline({ points: bent, samples: 21, smooth: 0 });
    const curved = sampleCentreline({ points: bent, samples: 21, smooth: 1 });
    const cornerCut = (line: Point[]) => Math.hypot(
      (line[13] as Point).x - (bent[1] as Point).x,
      (line[13] as Point).y - (bent[1] as Point).y,
    );
    expect(cornerCut(curved)).toBeGreaterThan(cornerCut(hinged));
  });
});

describe('radiusAt', () => {
  const taper = [{ at: 0, r: 20 }, { at: 0.5, r: 10 }, { at: 1, r: 14 }];

  it('interpolates between stops and clamps outside them', () => {
    expect(radiusAt({ taper, at: -1 })).toBe(20);
    expect(radiusAt({ taper, at: 0.25 })).toBeCloseTo(15);
    expect(radiusAt({ taper, at: 0.75 })).toBeCloseTo(12);
    expect(radiusAt({ taper, at: 2 })).toBe(14);
  });
});

describe('tubePath', () => {
  const straight: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 100 }];

  it('closes, and stays within a radius of its centreline', () => {
    const path = tubePath({ points: straight, radii: [10, 10] });
    expect(path.endsWith('Z')).toBe(true);
    for (const point of points(path)) {
      expect(distanceToChain({ point, chain: straight })).toBeLessThanOrEqual(10.01);
    }
  });

  it('caps both ends, so a limb never ends in a flat edge', () => {
    const path = tubePath({ points: straight, radii: [10, 10] });
    const ys = points(path).map(point => point.y);
    expect(Math.min(...ys)).toBeCloseTo(-10, 0);
    expect(Math.max(...ys)).toBeCloseTo(110, 0);
  });

  it('varies its width along the chain — the thing a stroke cannot do', () => {
    const path = tubePath({ points: [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 0, y: 100 }], radii: [20, 14, 6] });
    const near = (y: number) => points(path)
      .filter(point => Math.abs(point.y - y) < 1)
      .map(point => Math.abs(point.x));
    expect(Math.max(...near(0))).toBeCloseTo(20, 0);
    expect(Math.max(...near(50))).toBeCloseTo(14, 0);
  });
});

describe('armGeometry', () => {
  const rest = createRestPose();

  it('draws one seamless group, against the old drawing’s one per bone', () => {
    expect(armGeometry({ pose: rest, side: 'l', rig: ARM_TAPERED }).groups).toHaveLength(1);
    expect(armGeometry({ pose: rest, side: 'l', rig: ARM_SAUSAGE }).groups.length).toBeGreaterThan(1);
  });

  it('hangs the limb off the shoulder and reaches the wrist', () => {
    const [shoulderX, shoulderY] = JOINTS_BY_ID.armLUp.pivot;
    const [wristX, wristY] = JOINTS_BY_ID.armLHand.pivot;
    const arm = armGeometry({ pose: rest, side: 'l', rig: ARM_TAPERED });
    const limb = points(arm.groups[0]?.[0] ?? '');
    expect(distanceToChain({ point: { x: shoulderX, y: shoulderY }, chain: limb })).toBeLessThan(26);
    expect(distanceToChain({ point: { x: wristX, y: wristY }, chain: limb })).toBeLessThan(20);
  });

  it('mirrors: the right arm is the left one reflected about the centre line', () => {
    const left = armGeometry({ pose: rest, side: 'l', rig: ARM_TAPERED });
    const right = armGeometry({ pose: rest, side: 'r', rig: ARM_TAPERED });
    const spread = (geometry: typeof left) => geometry.groups.flat().flatMap(shape => points(shape));
    const l = spread(left);
    const r = spread(right);
    expect(r).toHaveLength(l.length);
    // Reflection reverses the winding, so the two paths visit the same outline
    // in opposite order — every point still has to have a partner.
    const worst = Math.max(...l.map(point => distanceToChain({ point: { x: 400 - point.x, y: point.y }, chain: r })));
    expect(worst).toBeLessThan(0.2);
  });

  // Every matrix is identity at rest, so a pivot read from the *default*
  // skeleton comes back unmoved however far the arm has been placed — and the
  // hand is placed from pivots. Get this wrong and the forearm walks off on its
  // own, which looks exactly like a malformed hand rather than a missed
  // argument. Both halves are asserted: the hand follows, and it does not stay.
  it('carries the hand with the limb when the arm is pulled inboard', () => {
    const pull = 20;
    const hand = (by?: number) => {
      const arm = armGeometry({ pose: rest, side: 'l', rig: ARM_TAPERED, pull: by });
      const shape = [arm.palm, ...arm.lines.map(line => line.d)].flatMap(part => points(part));
      return {
        x: shape.reduce((sum, point) => sum + point.x, 0) / shape.length,
        y: shape.reduce((sum, point) => sum + point.y, 0) / shape.length,
      };
    };

    // The whole hand translates by exactly the pull, and by nothing else.
    expect(hand(pull).x - hand().x).toBeCloseTo(pull, 1);
    expect(hand(pull).y).toBeCloseTo(hand().y, 1);
  });

  it('gives every fingered hand a digit per finger plus a thumb', () => {
    const arm = armGeometry({ pose: rest, side: 'l', rig: ARM_TAPERED });
    // The limb, the palm, then one shape per digit. The sleeve is painted on
    // top rather than unioned in, so it is not one of these.
    expect(arm.groups[0]).toHaveLength(2 + 5);
    expect(arm.sleeve).toBeTruthy();
    expect(arm.lines).toHaveLength(5);
    expect(arm.lines.every(line => line.kind === 'digit')).toBe(true);
  });

  it('leaves a mitten with only the thumb, and no interior lines', () => {
    const arm = armGeometry({ pose: rest, side: 'l', rig: ARM_MITTEN });
    expect(arm.groups[0]).toHaveLength(1 + 1 + 1);
    expect(arm.lines).toHaveLength(0);
  });

  it('drops the hem line on a limb with no ink, rather than leaving one line', () => {
    const arm = armGeometry({ pose: rest, side: 'l', rig: ARM_NO_INK });
    expect(arm.sleeve).toBeTruthy();
    expect(arm.hem).toBeNull();
  });

  it('inks the sleeve hem only where the sleeve ends', () => {
    const arm = armGeometry({ pose: rest, side: 'l', rig: ARM_TAPERED });
    expect(arm.hem).toBeTruthy();
    const hem = points(arm.hem ?? '');
    const [shoulderX, shoulderY] = JOINTS_BY_ID.armLUp.pivot;
    const [elbowX, elbowY] = JOINTS_BY_ID.armLLow.pivot;
    const toShoulder = distanceToChain({ point: { x: shoulderX, y: shoulderY }, chain: hem });
    const toElbow = distanceToChain({ point: { x: elbowX, y: elbowY }, chain: hem });
    expect(toElbow).toBeLessThan(toShoulder);
  });

  it('stays finite through a fully folded arm', () => {
    const folded = { ...rest, 'armLUp.rot': 150, 'armLLow.rot': 205, 'armLHand.rot': -40, 'handLIndex1.rot': -90 };
    for (const rig of ARM_RIGS) {
      const arm = armGeometry({ pose: folded, side: 'l', rig });
      for (const shape of [...arm.groups.flat(), arm.sleeve, arm.hem].filter(Boolean) as string[]) {
        expect(numbers(shape).every(Number.isFinite), `${rig.id}`).toBe(true);
        expect(shape.length, `${rig.id}`).toBeGreaterThan(0);
      }
    }
  });
});
