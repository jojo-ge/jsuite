// Path maths over `DocPath` segment lists. The arc-aware `segmentsBounds`
// supersedes the kraken spec's `bounds()` helper, which rejected `A` commands
// outright — here an arc contributes its true extent (centre-parameterised,
// densely sampled), so validator rules can measure any legal document path.
// Bézier bounds use the control-point hull: conservative, and identical to the
// behaviour every ported bbox rule was calibrated against.

import type { DocPath, PathSegment } from './document';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Point {
  x: number;
  y: number;
}

const ARC_SAMPLES = 64;

/**
 * Points along an elliptical arc, endpoints included — SVG F.6.5 endpoint →
 * centre conversion, then a dense sweep. Sub-pixel accurate at rig scale.
 */
const sampleArc = (
  x1: number,
  y1: number,
  [rxIn, ryIn, rotDeg, largeArc, sweep, x2, y2]: [number, number, number, number, number, number, number],
  samples = ARC_SAMPLES,
): Point[] => {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  }
  const phi = (rotDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(Math.max(dot / len, -1), 1));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) {
    dTheta -= 2 * Math.PI;
  }
  else if (sweep && dTheta < 0) {
    dTheta += 2 * Math.PI;
  }

  const points: Point[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const theta = theta1 + (dTheta * i) / samples;
    const ex = rx * Math.cos(theta);
    const ey = ry * Math.sin(theta);
    points.push({
      x: cosPhi * ex - sinPhi * ey + cx,
      y: sinPhi * ex + cosPhi * ey + cy,
    });
  }
  return points;
};

const CURVE_SAMPLES = 24;

const sampleCubic = (p0: Point, p1: Point, p2: Point, p3: Point, samples = CURVE_SAMPLES): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
};

const sampleQuadratic = (p0: Point, p1: Point, p2: Point, samples = CURVE_SAMPLES): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return out;
};

/**
 * The current point after each segment. Segments before the first M (illegal,
 * validator-caught) are measured from 0,0 rather than crashing.
 */
const segmentEnd = (segment: PathSegment): Point => {
  const coords = segment.slice(1) as number[];
  return { x: coords[coords.length - 2]!, y: coords[coords.length - 1]! };
};

/**
 * Points along a document path, in order — segment endpoints plus sampled
 * interiors for curves and arcs. Feeds bounds, snapping and hit-testing;
 * NEVER DOM measurement (the studio's snap targets must be pose maths).
 */
export const samplePath = (path: DocPath): Point[] => {
  const points: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let subpathStart: Point = cursor;
  for (const segment of path.segments) {
    switch (segment[0]) {
      case 'M':
        cursor = { x: segment[1], y: segment[2] };
        subpathStart = cursor;
        points.push(cursor);
        break;
      case 'L':
        cursor = { x: segment[1], y: segment[2] };
        points.push(cursor);
        break;
      case 'C':
        points.push(...sampleCubic(
          cursor,
          { x: segment[1], y: segment[2] },
          { x: segment[3], y: segment[4] },
          { x: segment[5], y: segment[6] },
        ).slice(1));
        cursor = segmentEnd(segment);
        break;
      case 'Q':
        points.push(...sampleQuadratic(
          cursor,
          { x: segment[1], y: segment[2] },
          { x: segment[3], y: segment[4] },
        ).slice(1));
        cursor = segmentEnd(segment);
        break;
      case 'A':
        points.push(...sampleArc(cursor.x, cursor.y, segment.slice(1) as [number, number, number, number, number, number, number]).slice(1));
        cursor = segmentEnd(segment);
        break;
    }
  }
  if (path.closed && points.length > 0) {
    points.push(subpathStart);
  }
  return points;
};

/**
 * Bounding box of a document path. Arcs contribute their true sampled extent;
 * bézier control points are included as-is (a conservative hull — the same
 * measure every ported silhouette rule was written against).
 */
export const segmentsBounds = (path: DocPath): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  let cursor: Point = { x: 0, y: 0 };
  for (const segment of path.segments) {
    if (segment[0] === 'A') {
      for (const point of sampleArc(cursor.x, cursor.y, segment.slice(1) as [number, number, number, number, number, number, number])) {
        take(point.x, point.y);
      }
    }
    else {
      const coords = segment.slice(1) as number[];
      for (let i = 0; i < coords.length; i += 2) {
        take(coords[i]!, coords[i + 1]!);
      }
    }
    cursor = segmentEnd(segment);
  }
  return { minX, minY, maxX, maxY };
};
