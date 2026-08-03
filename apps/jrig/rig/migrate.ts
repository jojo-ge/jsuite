// ArtStyle/Clip → document. A COMMITTED module, not a throwaway script: TS
// styles migrate on touch and the first-run seeder regenerates house/hoodie +
// the clip library from here, so the converter must survive. Styles that use
// features outside schema v1 (shading, filters, rough linework, non-role
// paints) are refused with a reason — they stay TS-authored.

import type { Clip } from './core';
import type { CharacterDocument, ClipDocument, DocLayer, DocPath, PathSegment, RigDocument, SegmentCommand } from './document';
import type { ArtStyle, StyleLayer } from './styles';

import { BUILT_IN_CLIPS } from './clips';
import { CHARACTER_SCHEMA, CLIP_SCHEMA, documentFileName, SEGMENT_ARITY, serialiseDocument } from './document';
import { STYLES_BY_ID } from './styles';

export class MigrationError extends Error {}

/**
 * Deep clone with JSON semantics — documents are JSON values by construction,
 * and JSON cannot represent -0 (some TS clip tracks author it), so migration
 * canonicalises through a stringify round trip rather than structuredClone.
 */
const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Absolute M/L/C/Q/A/Z parser, verbatim — no cubic conversion (the node editor
 * converts a Q/A only when the artist touches that node). Implicit command
 * repetition is honoured (`M` repeats as `L`, per SVG); relative or shorthand
 * commands (h/v/s/t and all lowercase) are refused — nothing in the rig uses
 * them, and keeping the parser strict keeps the format unambiguous.
 */
export const dToSegments = (d: string): DocPath => {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) ?? [];
  const segments: PathSegment[] = [];
  let closed = false;
  let index = 0;
  let command: SegmentCommand | null = null;

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (closed) {
      throw new MigrationError(`path continues after Z in "${d}"`);
    }
    if (/[A-Za-z]/.test(token)) {
      index += 1;
      if (token === 'Z' || token === 'z') {
        closed = true;
        continue;
      }
      if (!(token in SEGMENT_ARITY)) {
        throw new MigrationError(`unsupported path command "${token}" in "${d}"`);
      }
      command = token as SegmentCommand;
    }
    else if (command === null) {
      throw new MigrationError(`path data before any command in "${d}"`);
    }
    else if (command === 'M') {
      // An implicit repeat of M is a lineto, per the SVG grammar.
      command = 'L';
    }
    if (command === null) {
      continue;
    }
    const arity = SEGMENT_ARITY[command];
    const numbers = tokens.slice(index, index + arity).map(Number);
    if (numbers.length < arity || numbers.some(n => !Number.isFinite(n))) {
      throw new MigrationError(`command "${command}" needs ${arity} numbers in "${d}"`);
    }
    index += arity;
    segments.push([command, ...numbers] as PathSegment);
  }
  if (segments.length === 0) {
    throw new MigrationError(`empty path "${d}"`);
  }
  return { closed, segments };
};

const paintToRole = (paint: string, where: string): string => {
  const match = /^var\(--rig-([a-z0-9-]+)\)$/.exec(paint);
  if (!match) {
    throw new MigrationError(`${where}: paint "${paint}" is not a --rig- role (schema v1 is roles-only)`);
  }
  return match[1]!;
};

const layerToDoc = (layer: StyleLayer, id: string, where: string): DocLayer => {
  if (layer.filter !== undefined) {
    throw new MigrationError(`${where}: layer filters are outside schema v1`);
  }
  return {
    id,
    d: dToSegments(layer.d),
    ...(layer.fill !== undefined ? { fill: paintToRole(layer.fill, `${where}.fill`) } : {}),
    ...(layer.stroke !== undefined ? { stroke: paintToRole(layer.stroke, `${where}.stroke`) } : {}),
    ...(layer.width !== undefined ? { width: layer.width } : {}),
    ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {}),
    ...(layer.mirrored !== undefined ? { mirrored: layer.mirrored } : {}),
  };
};

const layersToDoc = (layers: StyleLayer[], slot: string): DocLayer[] =>
  layers.map((layer, index) => layerToDoc(layer, `${slot}-${index + 1}`, `${slot}[${index}]`));

/** Refuses styles outside schema v1 (shading/filter/rough, non-role paints). */
export const artStyleToDocument = (style: ArtStyle): CharacterDocument => {
  if (style.shading !== undefined) {
    throw new MigrationError(`${style.id}: shading is outside schema v1`);
  }
  if (style.filter !== undefined) {
    throw new MigrationError(`${style.id}: style filters are outside schema v1`);
  }
  if (style.rough !== undefined) {
    throw new MigrationError(`${style.id}: rough linework is outside schema v1`);
  }
  const { head, torso, arm } = style;

  return {
    schema: CHARACTER_SCHEMA,
    id: style.id,
    name: style.name,
    blurb: style.blurb,
    viewBox: { ...style.viewBox },
    ink: { ...style.ink },
    ...(style.palette !== undefined
      ? {
          palette: Object.fromEntries(Object.entries(style.palette).map(([key, value]) => {
            if (!key.startsWith('--rig-')) {
              throw new MigrationError(`${style.id}: palette key "${key}" is not --rig- prefixed`);
            }
            return [key.slice('--rig-'.length), value];
          })),
        }
      : {}),
    head: {
      path: dToSegments(head.path),
      ...(head.behind !== undefined ? { behind: layersToDoc(head.behind, 'behind') } : {}),
      ...(head.over !== undefined ? { over: layersToDoc(head.over, 'over') } : {}),
      ...(head.ear !== undefined
        ? {
            ear: head.ear === null
              ? null
              : {
                  path: dToSegments(head.ear.path),
                  ...(head.ear.fold !== undefined ? { fold: dToSegments(head.ear.fold) } : {}),
                },
          }
        : {}),
      brow: {
        d: dToSegments(head.brow.d),
        width: head.brow.width,
        ...(head.brow.cap !== undefined ? { cap: head.brow.cap } : {}),
      },
      ...(head.nose !== undefined ? { nose: head.nose === null ? null : dToSegments(head.nose) } : {}),
      ...(head.blush !== undefined ? { blush: head.blush === null ? null : { ...head.blush } } : {}),
    },
    face: jsonClone(style.face),
    pupil: jsonClone(style.pupil),
    torso: {
      ...(torso.neck !== undefined ? { neck: torso.neck === null ? null : { ...torso.neck } } : {}),
      ...(torso.behind !== undefined ? { behind: layersToDoc(torso.behind, 'torso-behind') } : {}),
      shirt: dToSegments(torso.shirt),
      ...(torso.shade !== undefined ? { shade: torso.shade === null ? null : dToSegments(torso.shade) } : {}),
      ...(torso.detail !== undefined ? { detail: layersToDoc(torso.detail, 'detail') } : {}),
    },
    arm: arm.rig
      ? {
          // Rig set ⇒ the legacy width/hand fields are dropped: the renderer
          // silently ignores them (kraken styles.ts gotcha), and the validator
          // formalises their absence. The compiler refills house defaults.
          rig: jsonClone(arm.rig),
          ...(arm.shoulder !== undefined ? { shoulder: arm.shoulder === null ? null : { ...arm.shoulder } } : {}),
          ...(arm.pull !== undefined ? { pull: arm.pull } : {}),
          upperFill: arm.upperFill,
          lowerFill: arm.lowerFill,
          ...(arm.cap !== undefined ? { cap: arm.cap } : {}),
        }
      : {
          ...(arm.shoulder !== undefined ? { shoulder: arm.shoulder === null ? null : { ...arm.shoulder } } : {}),
          ...(arm.pull !== undefined ? { pull: arm.pull } : {}),
          upperFill: arm.upperFill,
          lowerFill: arm.lowerFill,
          edgeWidth: arm.edgeWidth,
          fillWidth: arm.fillWidth,
          ...(arm.sleeve !== undefined
            ? {
                sleeve: arm.sleeve === null
                  ? null
                  : { width: arm.sleeve.width, d: dToSegments(arm.sleeve.d), seam: dToSegments(arm.sleeve.seam) },
              }
            : {}),
          hand: dToSegments(arm.hand),
          ...(arm.crease !== undefined ? { crease: arm.crease === null ? null : dToSegments(arm.crease) } : {}),
          ...(arm.cuff !== undefined ? { cuff: arm.cuff === null ? null : dToSegments(arm.cuff) } : {}),
          ...(arm.cap !== undefined ? { cap: arm.cap } : {}),
        },
  };
};

export const clipToDocument = (clip: Clip): ClipDocument => ({
  schema: CLIP_SCHEMA,
  id: clip.id,
  name: clip.name,
  duration: clip.duration,
  loop: clip.loop,
  layer: clip.layer,
  tracks: jsonClone(clip.tracks),
});

/**
 * Everything the first-run seeder writes into `.data/jrig/documents/`:
 * house + hoodie (the round-tripping proof pair, decision 7) and the whole
 * built-in clip library, one file per clip.
 */
export const buildSeedDocuments = (): { name: string; content: string }[] => {
  const docs: RigDocument[] = [
    artStyleToDocument(STYLES_BY_ID.house!),
    artStyleToDocument(STYLES_BY_ID.hoodie!),
    ...BUILT_IN_CLIPS.map(clipToDocument),
  ];
  return docs.map(doc => ({ name: documentFileName(doc), content: serialiseDocument(doc) }));
};
