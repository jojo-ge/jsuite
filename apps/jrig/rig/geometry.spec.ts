import { describe, expect, it } from 'vitest';

import type { DocPath } from './document';

import { SEGMENT_ARITY } from './document';
import { samplePath, segmentsBounds } from './geometry';

const path = (segments: DocPath['segments'], closed = false): DocPath => ({ closed, segments });

describe('segmentsBounds', () => {
  it('measures plain coordinate segments as their hull', () => {
    const bounds = segmentsBounds(path([['M', 10, 20], ['L', 30, 5], ['C', 0, 0, 40, 60, 20, 20]], true));
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 60 });
  });

  it('is arc-aware: a full circle measures its diameter, not its chord', () => {
    // Two semicircular arcs whose endpoints are both on x=100 — a hull-only
    // measure (the old kraken bounds()) could never see the ±50 bulge.
    const circle = path([
      ['M', 100, 50],
      ['A', 50, 50, 0, 1, 0, 100, 150],
      ['A', 50, 50, 0, 1, 0, 100, 50],
    ], true);
    const bounds = segmentsBounds(circle);
    expect(bounds.minX).toBeCloseTo(50, 1);
    expect(bounds.maxX).toBeCloseTo(150, 1);
    expect(bounds.minY).toBeCloseTo(50, 1);
    expect(bounds.maxY).toBeCloseTo(150, 1);
  });

  it('measures a semicircle bulge', () => {
    const bounds = segmentsBounds(path([['M', 0, 0], ['A', 50, 50, 0, 0, 1, 100, 0]]));
    expect(bounds.maxX - bounds.minX).toBeCloseTo(100, 1);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(50, 1);
  });
});

describe('samplePath', () => {
  it('walks segment endpoints in order and closes closed paths', () => {
    const square = path([['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['L', 0, 10]], true);
    const points = samplePath(square);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 0, y: 0 });
    expect(points).toContainEqual({ x: 10, y: 10 });
  });

  it('samples curve interiors, not just endpoints', () => {
    const bump = path([['M', 0, 0], ['Q', 50, 100, 100, 0]]);
    const points = samplePath(bump);
    const apex = Math.max(...points.map(point => point.y));
    // A quadratic reaches half its control offset at t = 0.5.
    expect(apex).toBeCloseTo(50, 1);
  });
});

describe('SEGMENT_ARITY', () => {
  it('pins the command vocabulary of schema v1', () => {
    expect(SEGMENT_ARITY).toEqual({ M: 2, L: 2, C: 6, Q: 4, A: 7 });
  });
});
