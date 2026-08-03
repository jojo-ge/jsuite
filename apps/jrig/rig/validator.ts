// Mechanical document validation — every rule the kraken specs enforced on TS
// styles/clips, formalised over documents (sources cited in docs/PLAN.md §M2).
// Consumed live by the studio (chips in the sync bar), by the save endpoint,
// and by a vitest suite over everything in `.data/jrig/`. The validator is the
// BACKSTOP for direct file edits: the canvas clamps at input, but Claude edits
// files and never meets the canvas. AI style review is advisory; these rules
// are not.

import type { Clip } from './core';
import type { CharacterDocument, ClipDocument, DocLayer, DocPath } from './document';

import { EASING_IDS, JOINTS_BY_ID, REST_POSE, sampleClip } from './core';
import { CHARACTER_SCHEMA, CLIP_SCHEMA, DOC_ID_RE, LINE_ROLE, SEGMENT_ARITY, SKIN_ROLES } from './document';
import { segmentsBounds } from './geometry';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

const [SHOULDER_X, SHOULDER_Y] = JOINTS_BY_ID.armLUp.pivot;
const [WRIST_X, WRIST_Y] = JOINTS_BY_ID.armLHand.pivot;

/** Matches the ported core spec's `toBeCloseTo(…, 1)` tolerance. */
const REST_TOLERANCE = 0.051;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface Ctx {
  issues: Issue[];
}

const err = (ctx: Ctx, code: string, path: string, message: string) =>
  ctx.issues.push({ level: 'error', code, path, message });

const warn = (ctx: Ctx, code: string, path: string, message: string) =>
  ctx.issues.push({ level: 'warning', code, path, message });

// --- paths ------------------------------------------------------------------

/** Structural check; returns the path if usable for geometric rules. */
const checkPath = (ctx: Ctx, value: unknown, path: string, mustClose: boolean | null): DocPath | null => {
  if (!isRecord(value) || typeof value.closed !== 'boolean' || !Array.isArray(value.segments)) {
    err(ctx, 'path-shape', path, 'a path is {closed: boolean, segments: [...]}');
    return null;
  }
  if (value.segments.length === 0) {
    err(ctx, 'path-shape', path, 'a path needs at least one segment');
    return null;
  }
  let ok = true;
  value.segments.forEach((segment, index) => {
    if (!Array.isArray(segment) || typeof segment[0] !== 'string' || !(segment[0] in SEGMENT_ARITY)) {
      err(ctx, 'arity', `${path}.segments[${index}]`, 'segment must be ["M"|"L"|"C"|"Q"|"A", ...numbers]');
      ok = false;
      return;
    }
    const arity = SEGMENT_ARITY[segment[0] as keyof typeof SEGMENT_ARITY];
    const numbers = segment.slice(1);
    if (numbers.length !== arity || numbers.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
      err(ctx, 'arity', `${path}.segments[${index}]`, `"${segment[0]}" takes exactly ${arity} finite numbers`);
      ok = false;
    }
    if (segment[0] === 'A' && ok) {
      const [largeArc, sweep] = [segment[4], segment[5]];
      if ((largeArc !== 0 && largeArc !== 1) || (sweep !== 0 && sweep !== 1)) {
        err(ctx, 'arity', `${path}.segments[${index}]`, 'arc flags must be 0 or 1');
        ok = false;
      }
    }
  });
  if (!ok) {
    return null;
  }
  if ((value.segments[0] as unknown[])[0] !== 'M') {
    err(ctx, 'path-shape', path, 'a path must start with an M segment');
    return null;
  }
  if (mustClose === true && !value.closed) {
    err(ctx, 'closed', path, 'filled shapes must be closed');
  }
  if (mustClose === false && value.closed) {
    err(ctx, 'closed', path, 'stroked lines must stay open');
  }
  return value as unknown as DocPath;
};

const leftSideOnly = (ctx: Ctx, docPath: DocPath | null, path: string) => {
  if (docPath && segmentsBounds(docPath).maxX > 200) {
    err(ctx, 'left-side', path, 'authored once, mirrored right: keep every x ≤ 200');
  }
};

// --- misc helpers -----------------------------------------------------------

const finite = (ctx: Ctx, value: unknown, path: string): value is number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    err(ctx, 'numbers', path, 'must be a finite number');
    return false;
  }
  return true;
};

const parseViewBox = (ctx: Ctx, value: unknown, path: string) => {
  if (typeof value !== 'string') {
    err(ctx, 'viewbox', path, 'must be an SVG viewBox string');
    return null;
  }
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
    err(ctx, 'viewbox', path, 'must be four finite numbers');
    return null;
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, right: x + width, bottom: y + height };
};

const checkUnknownKeys = (ctx: Ctx, value: Record<string, unknown>, allowed: string[], path: string) => {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) {
      continue;
    }
    const pinned = ['shading', 'filter', 'rough'].includes(key)
      ? ' — the shading family stays out of schema v1 (grows in avatar-character/2 if ever needed)'
      : '';
    warn(ctx, 'unknown-key', path ? `${path}.${key}` : key, `unknown key "${key}"${pinned}`);
  }
};

// --- characters -------------------------------------------------------------

export const validateCharacterDocument = (input: unknown): Issue[] => {
  const ctx: Ctx = { issues: [] };
  if (!isRecord(input)) {
    err(ctx, 'schema', '', 'document must be a JSON object');
    return ctx.issues;
  }
  const doc = input as Partial<CharacterDocument> & Record<string, unknown>;

  if (doc.schema !== CHARACTER_SCHEMA) {
    err(ctx, 'schema', 'schema', `must be "${CHARACTER_SCHEMA}"`);
    return ctx.issues;
  }
  if (typeof doc.id !== 'string' || !DOC_ID_RE.test(doc.id)) {
    err(ctx, 'id', 'id', 'must be a [a-z][a-zA-Z0-9-]* slug — the id IS the filename stem');
  }
  if (typeof doc.name !== 'string' || doc.name.length === 0) {
    err(ctx, 'id', 'name', 'must be a non-empty string');
  }
  if (typeof doc.blurb !== 'string') {
    err(ctx, 'id', 'blurb', 'must be a string');
  }

  checkUnknownKeys(ctx, doc, ['schema', 'id', 'name', 'blurb', 'notes', 'viewBox', 'ink', 'palette', 'head', 'face', 'pupil', 'torso', 'arm'], '');

  // Palette + roles. Fill roles: 13 skin roles ∪ palette keys. Stroke roles:
  // `line` ∪ palette keys — the near-black line is only overridable by a
  // palette that owns it explicitly (decision 10's escape hatch).
  const paletteKeys: string[] = [];
  if (doc.palette !== undefined) {
    if (!isRecord(doc.palette)) {
      err(ctx, 'paint-role', 'palette', 'must be an object of bare role → colour');
    }
    else {
      for (const [key, value] of Object.entries(doc.palette)) {
        if (!/^[a-z][a-z0-9-]*$/.test(key)) {
          err(ctx, 'paint-role', `palette.${key}`, 'palette keys are bare lowercase slugs (no --rig- prefix)');
        }
        if (typeof value !== 'string' || value.includes('var(') || value.includes('url(')) {
          err(ctx, 'paint-role', `palette.${key}`, 'palette values are plain colour strings');
        }
        paletteKeys.push(key);
      }
    }
  }
  const fillRoles = new Set<string>([...SKIN_ROLES, ...paletteKeys]);
  const strokeRoles = new Set<string>([LINE_ROLE, ...paletteKeys]);

  const layerIds = new Set<string>();
  const checkLayers = (layers: unknown, slot: string) => {
    if (layers === undefined) {
      return;
    }
    if (!Array.isArray(layers)) {
      err(ctx, 'path-shape', slot, 'must be an array of layers');
      return;
    }
    layers.forEach((layer, index) => {
      const at = `${slot}[${index}]`;
      if (!isRecord(layer)) {
        err(ctx, 'path-shape', at, 'must be a layer object');
        return;
      }
      checkUnknownKeys(ctx, layer, ['id', 'd', 'fill', 'stroke', 'width', 'opacity', 'mirrored', 'notes'], at);
      if (typeof layer.id !== 'string' || layer.id.length === 0) {
        err(ctx, 'layer-ids', `${at}.id`, 'every layer needs a unique id');
      }
      else if (layerIds.has(layer.id)) {
        err(ctx, 'layer-ids', `${at}.id`, `duplicate layer id "${layer.id}"`);
      }
      else {
        layerIds.add(layer.id);
      }
      const hasFill = layer.fill !== undefined;
      const d = checkPath(ctx, layer.d, `${at}.d`, hasFill ? true : null);
      if (hasFill && (typeof layer.fill !== 'string' || !fillRoles.has(layer.fill))) {
        err(ctx, 'paint-role', `${at}.fill`, `fill must be one of the 13 skin roles or a palette key — got ${JSON.stringify(layer.fill)}`);
      }
      if (layer.stroke !== undefined && (typeof layer.stroke !== 'string' || !strokeRoles.has(layer.stroke))) {
        err(ctx, 'stroke-role', `${at}.stroke`, `stroke must be "line" or a palette key — got ${JSON.stringify(layer.stroke)}`);
      }
      for (const field of ['fill', 'stroke'] as const) {
        const value = layer[field];
        if (typeof value === 'string' && /[#(]/.test(value)) {
          err(ctx, 'paint-role', `${at}.${field}`, 'raw colours / var() / url() are not allowed — bind a role');
        }
      }
      if ((layer as unknown as DocLayer).mirrored === true) {
        leftSideOnly(ctx, d, `${at}.d`);
      }
    });
  };

  // viewBox: the wider rig frame must contain the bust frame.
  if (!isRecord(doc.viewBox)) {
    err(ctx, 'viewbox', 'viewBox', 'must be {bust, rig}');
  }
  else {
    const bust = parseViewBox(ctx, doc.viewBox.bust, 'viewBox.bust');
    const rig = parseViewBox(ctx, doc.viewBox.rig, 'viewBox.rig');
    if (bust && rig && (rig.x > bust.x || rig.y > bust.y || rig.right < bust.right || rig.bottom < bust.bottom)) {
      err(ctx, 'viewbox', 'viewBox', 'the rig frame must contain the bust frame');
    }
  }

  // Ink grades from silhouette down to interior detail.
  if (!isRecord(doc.ink) || !finite(ctx, doc.ink.silhouette, 'ink.silhouette') || !finite(ctx, doc.ink.feature, 'ink.feature') || !finite(ctx, doc.ink.detail, 'ink.detail')) {
    // reported above
  }
  else if (!(doc.ink.detail > 0) || doc.ink.silhouette < doc.ink.feature || doc.ink.feature < doc.ink.detail) {
    err(ctx, 'ink-grade', 'ink', 'ink must grade silhouette ≥ feature ≥ detail > 0');
  }

  // Head.
  let headBounds: ReturnType<typeof segmentsBounds> | null = null;
  if (!isRecord(doc.head)) {
    err(ctx, 'path-shape', 'head', 'missing head');
  }
  else {
    checkUnknownKeys(ctx, doc.head, ['path', 'behind', 'over', 'ear', 'brow', 'nose', 'blush'], 'head');
    const headPath = checkPath(ctx, doc.head.path, 'head.path', true);
    if (headPath) {
      headBounds = segmentsBounds(headPath);
      if (Math.abs((headBounds.minX + headBounds.maxX) / 2 - 200) > 8) {
        warn(ctx, 'symmetry', 'head.path', 'head silhouette is noticeably off-centre from x=200');
      }
    }
    checkLayers(doc.head.behind, 'head.behind');
    checkLayers(doc.head.over, 'head.over');
    if (doc.head.ear !== undefined && doc.head.ear !== null) {
      if (!isRecord(doc.head.ear)) {
        err(ctx, 'path-shape', 'head.ear', 'must be {path, fold?} or null');
      }
      else {
        leftSideOnly(ctx, checkPath(ctx, doc.head.ear.path, 'head.ear.path', true), 'head.ear.path');
        if (doc.head.ear.fold !== undefined) {
          leftSideOnly(ctx, checkPath(ctx, doc.head.ear.fold, 'head.ear.fold', false), 'head.ear.fold');
        }
      }
    }
    if (!isRecord(doc.head.brow)) {
      err(ctx, 'path-shape', 'head.brow', 'missing brow');
    }
    else {
      checkPath(ctx, doc.head.brow.d, 'head.brow.d', false);
      finite(ctx, doc.head.brow.width, 'head.brow.width');
    }
    if (doc.head.nose !== undefined && doc.head.nose !== null) {
      checkPath(ctx, doc.head.nose, 'head.nose', false);
    }
  }

  // Parametric face: symmetric about the mirror axis, inside the head, with
  // white left around the pupil.
  if (!isRecord(doc.face) || !isRecord(doc.face.mouth) || !isRecord(doc.face.eye)
    || !isRecord((doc.face.eye as Record<string, unknown>).l) || !isRecord((doc.face.eye as Record<string, unknown>).r)) {
    err(ctx, 'face-symmetry', 'face', 'missing face geometry');
  }
  else {
    const face = doc.face;
    if (face.mouth.cx !== 200) {
      err(ctx, 'face-symmetry', 'face.mouth.cx', 'the mouth sits on the mirror axis: cx must be 200');
    }
    if (face.eye.l.cx + face.eye.r.cx !== 400) {
      err(ctx, 'face-symmetry', 'face.eye', 'eyes must mirror about x=200 (l.cx + r.cx === 400)');
    }
    if (face.eye.l.cy !== face.eye.r.cy) {
      err(ctx, 'face-symmetry', 'face.eye', 'both eyes must sit at the same height');
    }
    if (headBounds) {
      const { eye, mouth } = face;
      if (eye.l.cx - eye.width / 2 <= headBounds.minX
        || eye.r.cx + eye.width / 2 >= headBounds.maxX
        || eye.l.cy <= headBounds.minY
        || mouth.cy + mouth.open / 2 >= headBounds.maxY) {
        err(ctx, 'face-in-head', 'face', 'eyes and mouth must sit inside the head silhouette');
      }
    }
    if (isRecord(doc.pupil) && typeof doc.pupil.r === 'number' && doc.pupil.r * 2 >= face.eye.width) {
      err(ctx, 'pupil', 'pupil.r', 'leave white around the pupil: 2r must be < eye.width');
    }
  }

  // Torso + the silhouette rules.
  let shirtBounds: ReturnType<typeof segmentsBounds> | null = null;
  if (!isRecord(doc.torso)) {
    err(ctx, 'path-shape', 'torso', 'missing torso');
  }
  else {
    checkUnknownKeys(ctx, doc.torso, ['neck', 'behind', 'shirt', 'shade', 'detail'], 'torso');
    const shirt = checkPath(ctx, doc.torso.shirt, 'torso.shirt', true);
    if (shirt) {
      shirtBounds = segmentsBounds(shirt);
      if (Math.abs((shirtBounds.minX + shirtBounds.maxX) / 2 - 200) > 8) {
        warn(ctx, 'symmetry', 'torso.shirt', 'shirt silhouette is noticeably off-centre from x=200');
      }
    }
    if (doc.torso.shade !== undefined && doc.torso.shade !== null) {
      checkPath(ctx, doc.torso.shade, 'torso.shade', true);
    }
    checkLayers(doc.torso.behind, 'torso.behind');
    checkLayers(doc.torso.detail, 'torso.detail');
  }

  // Arm: rig xor legacy, sane rig params, and the sleeve-nub / hand rules.
  if (!isRecord(doc.arm)) {
    err(ctx, 'path-shape', 'arm', 'missing arm');
  }
  else {
    const arm = doc.arm;
    checkUnknownKeys(ctx, arm, ['rig', 'shoulder', 'pull', 'upperFill', 'lowerFill', 'edgeWidth', 'fillWidth', 'sleeve', 'hand', 'crease', 'cuff', 'cap'], 'arm');
    if (arm.upperFill !== 'skin' && arm.upperFill !== 'shirt') {
      err(ctx, 'paint-role', 'arm.upperFill', 'must be "skin" or "shirt"');
    }
    if (arm.lowerFill !== 'skin' && arm.lowerFill !== 'shirt') {
      err(ctx, 'paint-role', 'arm.lowerFill', 'must be "skin" or "shirt"');
    }

    const rig = arm.rig ?? null;
    if (rig !== null) {
      // Rig set ⇒ legacy fields absent (the renderer would silently ignore
      // them — kraken styles.ts:174–181 formalised).
      for (const field of ['edgeWidth', 'fillWidth', 'sleeve', 'hand', 'crease', 'cuff'] as const) {
        if (arm[field] !== undefined) {
          err(ctx, 'rig-xor-legacy', `arm.${field}`, `arm.rig is set — "${field}" would be silently ignored; remove it`);
        }
      }
      if (!isRecord(rig) || !Array.isArray(rig.taper) || rig.taper.length === 0) {
        err(ctx, 'rig-params', 'arm.rig.taper', 'a rig needs at least one taper stop');
      }
      else {
        let lastAt = -Infinity;
        rig.taper.forEach((stop: unknown, index: number) => {
          if (!isRecord(stop) || typeof stop.at !== 'number' || typeof stop.r !== 'number'
            || !Number.isFinite(stop.at) || !Number.isFinite(stop.r)
            || stop.at < 0 || stop.at > 1 || stop.r <= 0 || stop.at < lastAt) {
            err(ctx, 'rig-params', `arm.rig.taper[${index}]`, 'taper stops are {at: 0..1 ascending, r > 0}');
          }
          else {
            lastAt = stop.at;
          }
        });
        if (typeof rig.smooth !== 'number' || rig.smooth < 0 || rig.smooth > 1) {
          err(ctx, 'rig-params', 'arm.rig.smooth', 'smooth is 0..1');
        }
        if (typeof rig.ink !== 'number' || rig.ink < 0) {
          err(ctx, 'rig-params', 'arm.rig.ink', 'ink is ≥ 0');
        }
        // Moved shoulder: the limb root must stay under the shirt.
        const shoulder = arm.shoulder ?? null;
        const root = isRecord(rig.taper[0]) ? (rig.taper[0] as { r: number }).r : 0;
        if (shoulder && shirtBounds && isRecord(shoulder)
          && typeof shoulder.x === 'number' && shoulder.x - root < shirtBounds.minX) {
          err(ctx, 'shoulder-cover', 'arm.shoulder', 'moved shoulder minus the taper root must stay inside the shirt (shoulder.x − taper[0].r ≥ shirt.minX)');
        }
      }
    }
    else {
      if (!finite(ctx, arm.edgeWidth, 'arm.edgeWidth') || !finite(ctx, arm.fillWidth, 'arm.fillWidth')) {
        // reported above
      }
      else if (arm.edgeWidth <= arm.fillWidth) {
        err(ctx, 'sleeve-width', 'arm', 'edgeWidth must exceed fillWidth — the ink capsule buries the fill');
      }
      if (arm.sleeve !== undefined && arm.sleeve !== null) {
        if (!isRecord(arm.sleeve)) {
          err(ctx, 'path-shape', 'arm.sleeve', 'must be {width, d, seam} or null');
        }
        else {
          if (typeof arm.sleeve.width === 'number' && typeof arm.edgeWidth === 'number' && arm.sleeve.width <= arm.edgeWidth) {
            err(ctx, 'sleeve-width', 'arm.sleeve.width', 'the sleeve must be wider than the arm outline it buries');
          }
          leftSideOnly(ctx, checkPath(ctx, arm.sleeve.d, 'arm.sleeve.d', false), 'arm.sleeve.d');
          leftSideOnly(ctx, checkPath(ctx, arm.sleeve.seam, 'arm.sleeve.seam', false), 'arm.sleeve.seam');
        }
      }
      const hand = checkPath(ctx, arm.hand, 'arm.hand', true);
      leftSideOnly(ctx, hand, 'arm.hand');
      if (hand) {
        const bounds = segmentsBounds(hand);
        if (bounds.minX >= WRIST_X || bounds.maxX <= WRIST_X || Math.abs(bounds.minY - WRIST_Y) >= 24) {
          err(ctx, 'hand-wrist', 'arm.hand', `the hand must straddle the wrist pivot (${WRIST_X},${WRIST_Y})`);
        }
      }
      if (arm.crease !== undefined && arm.crease !== null) {
        leftSideOnly(ctx, checkPath(ctx, arm.crease, 'arm.crease', false), 'arm.crease');
      }
      if (arm.cuff !== undefined && arm.cuff !== null) {
        leftSideOnly(ctx, checkPath(ctx, arm.cuff, 'arm.cuff', false), 'arm.cuff');
      }
    }

    // The sleeve-nub trap (kraken styles.spec:100): the shirt must swallow the
    // sleeve/arm cap above the shoulder pivot and straddle both shoulder x's.
    if (shirtBounds) {
      const sleeveWidth = isRecord(arm.sleeve) && typeof arm.sleeve.width === 'number' ? arm.sleeve.width : undefined;
      const cap = rig !== null && isRecord(rig) && Array.isArray(rig.taper) && isRecord(rig.taper[0])
        ? (rig.taper[0] as { r: number }).r
        : (sleeveWidth ?? (typeof arm.edgeWidth === 'number' ? arm.edgeWidth : 0)) / 2;
      if (shirtBounds.minY >= SHOULDER_Y - cap) {
        err(ctx, 'shirt-top', 'torso.shirt', `the shirt must top out above y=${SHOULDER_Y - cap} or the sleeve cap pokes out over the shoulder`);
      }
      if (shirtBounds.minX >= SHOULDER_X || shirtBounds.maxX <= 400 - SHOULDER_X) {
        err(ctx, 'shirt-top', 'torso.shirt', 'the shirt must straddle both shoulder pivots');
      }
    }
  }

  return ctx.issues;
};

// --- clips ------------------------------------------------------------------

export const validateClipDocument = (input: unknown): Issue[] => {
  const ctx: Ctx = { issues: [] };
  if (!isRecord(input)) {
    err(ctx, 'clip-schema', '', 'document must be a JSON object');
    return ctx.issues;
  }
  const doc = input as Partial<ClipDocument> & Record<string, unknown>;
  if (doc.schema !== CLIP_SCHEMA) {
    err(ctx, 'clip-schema', 'schema', `must be "${CLIP_SCHEMA}"`);
    return ctx.issues;
  }
  checkUnknownKeys(ctx, doc, ['schema', 'id', 'name', 'notes', 'duration', 'loop', 'layer', 'tracks'], '');
  if (typeof doc.id !== 'string' || !DOC_ID_RE.test(doc.id)) {
    err(ctx, 'clip-schema', 'id', 'must be a [a-z][a-zA-Z0-9-]* slug — the id IS the filename stem');
  }
  if (typeof doc.name !== 'string' || doc.name.length === 0) {
    err(ctx, 'clip-schema', 'name', 'must be a non-empty string');
  }
  if (typeof doc.duration !== 'number' || !Number.isFinite(doc.duration) || doc.duration <= 0) {
    err(ctx, 'clip-schema', 'duration', 'must be a finite number of seconds > 0');
  }
  if (typeof doc.loop !== 'boolean') {
    err(ctx, 'clip-schema', 'loop', 'must be a boolean');
  }
  if (doc.layer !== 'base' && doc.layer !== 'emote') {
    err(ctx, 'clip-schema', 'layer', 'must be "base" or "emote"');
  }
  if (!isRecord(doc.tracks)) {
    err(ctx, 'clip-schema', 'tracks', 'must be an object of channel → keyframes');
    return ctx.issues;
  }

  let sane = ctx.issues.length === 0;
  for (const [channel, keys] of Object.entries(doc.tracks)) {
    const at = `tracks.${channel}`;
    if (REST_POSE[channel] === undefined) {
      err(ctx, 'clip-channel', at, `"${channel}" is not a rig channel`);
      sane = false;
      continue;
    }
    if (!Array.isArray(keys)) {
      err(ctx, 'clip-keys', at, 'a track is an array of {t, v, e?}');
      sane = false;
      continue;
    }
    if (keys.length === 0) {
      warn(ctx, 'clip-empty', at, 'empty track — delete it');
      continue;
    }
    let lastT = -Infinity;
    keys.forEach((key, index) => {
      const keyAt = `${at}[${index}]`;
      if (!isRecord(key) || typeof key.t !== 'number' || typeof key.v !== 'number'
        || !Number.isFinite(key.t) || !Number.isFinite(key.v)) {
        err(ctx, 'clip-keys', keyAt, 'keyframes are {t, v} with finite numbers');
        sane = false;
        return;
      }
      if (typeof doc.duration === 'number' && (key.t < 0 || key.t > doc.duration)) {
        err(ctx, 'clip-keys', keyAt, `t must sit inside [0, ${doc.duration}]`);
        sane = false;
      }
      if (key.t < lastT) {
        err(ctx, 'clip-keys', keyAt, 'keyframes must be in time order');
        sane = false;
      }
      lastT = key.t;
      if (key.e !== undefined && !EASING_IDS.includes(key.e as typeof EASING_IDS[number])) {
        err(ctx, 'clip-easing', `${keyAt}.e`, `easing must be one of ${EASING_IDS.join(', ')}`);
        sane = false;
      }
    });
  }

  // Emotes must sample back to rest at t = duration, or they can't hand back
  // to the base loop (core.spec:308).
  if (sane && doc.layer === 'emote') {
    const end = sampleClip(doc as unknown as Clip, doc.duration!);
    for (const [channel, value] of Object.entries(end)) {
      const rest = REST_POSE[channel] ?? 0;
      if (value !== undefined && Math.abs(value - rest) > REST_TOLERANCE) {
        err(ctx, 'clip-rest', `tracks.${channel}`, `an emote must return to rest at t=duration (ends at ${value}, rest is ${rest})`);
      }
    }
  }

  return ctx.issues;
};

export const validateDocument = (input: unknown): Issue[] => {
  if (isRecord(input) && input.schema === CLIP_SCHEMA) {
    return validateClipDocument(input);
  }
  return validateCharacterDocument(input);
};
