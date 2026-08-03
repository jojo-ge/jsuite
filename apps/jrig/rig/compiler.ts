// Document → ArtStyle. Pure, and the ONLY consumer-facing direction: the
// renderer keeps consuming `ArtStyle` untouched (zero renderer changes — the
// whole point of the mirror-format decision). The inverse lives in migrate.ts;
// `normalise(compile(migrate(style)))` must deep-equal `normalise(style)` for
// every flat TS style, and the specs pin that.

import type { Clip } from './core';
import type { CharacterDocument, ClipDocument, DocLayer, DocPath } from './document';
import type { ArtStyle, StyleLayer } from './styles';

import { STYLES_BY_ID } from './styles';

/** Segment list back to an SVG path string. Formatting is irrelevant — every
 * equality check parses to numeric form — so this stays dead simple. */
export const segmentsToD = (path: DocPath): string => {
  const body = path.segments
    .map(segment => `${segment[0]} ${(segment.slice(1) as number[]).join(' ')}`)
    .join(' ');
  return path.closed ? `${body} Z` : body;
};

const rolePaint = (role: string): string => `var(--rig-${role})`;

const compileLayer = (layer: DocLayer): StyleLayer => ({
  d: segmentsToD(layer.d),
  ...(layer.fill !== undefined ? { fill: rolePaint(layer.fill) } : {}),
  ...(layer.stroke !== undefined ? { stroke: rolePaint(layer.stroke) } : {}),
  ...(layer.width !== undefined ? { width: layer.width } : {}),
  ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {}),
  ...(layer.mirrored !== undefined ? { mirrored: layer.mirrored } : {}),
});

const compileLayers = (layers: DocLayer[]): StyleLayer[] => layers.map(compileLayer);

export const compileCharacterDocument = (doc: CharacterDocument): ArtStyle => {
  const { head, torso, arm } = doc;

  // A rigged arm owns its own widths and hand, but ArtStyle's legacy fields are
  // required — fill them with the house defaults the renderer will ignore
  // (exactly what the TS arm variants did with `{ ...HOUSE.arm, rig }`).
  const houseArm = STYLES_BY_ID.house!.arm;

  return {
    id: doc.id,
    name: doc.name,
    blurb: doc.blurb,
    viewBox: { ...doc.viewBox },
    ink: { ...doc.ink },
    ...(doc.palette !== undefined
      ? { palette: Object.fromEntries(Object.entries(doc.palette).map(([key, value]) => [`--rig-${key}`, value])) }
      : {}),
    head: {
      path: segmentsToD(head.path),
      ...(head.behind !== undefined ? { behind: compileLayers(head.behind) } : {}),
      ...(head.over !== undefined ? { over: compileLayers(head.over) } : {}),
      ...(head.ear !== undefined
        ? {
            ear: head.ear === null
              ? null
              : {
                  path: segmentsToD(head.ear.path),
                  ...(head.ear.fold !== undefined ? { fold: segmentsToD(head.ear.fold) } : {}),
                },
          }
        : {}),
      brow: {
        d: segmentsToD(head.brow.d),
        width: head.brow.width,
        ...(head.brow.cap !== undefined ? { cap: head.brow.cap } : {}),
      },
      ...(head.nose !== undefined ? { nose: head.nose === null ? null : segmentsToD(head.nose) } : {}),
      ...(head.blush !== undefined ? { blush: head.blush === null ? null : { ...head.blush } } : {}),
    },
    face: structuredClone(doc.face),
    pupil: structuredClone(doc.pupil),
    torso: {
      ...(torso.neck !== undefined ? { neck: torso.neck === null ? null : { ...torso.neck } } : {}),
      ...(torso.behind !== undefined ? { behind: compileLayers(torso.behind) } : {}),
      shirt: segmentsToD(torso.shirt),
      ...(torso.shade !== undefined ? { shade: torso.shade === null ? null : segmentsToD(torso.shade) } : {}),
      ...(torso.detail !== undefined ? { detail: compileLayers(torso.detail) } : {}),
    },
    arm: arm.rig
      ? {
          rig: structuredClone(arm.rig),
          ...(arm.shoulder !== undefined ? { shoulder: arm.shoulder === null ? null : { ...arm.shoulder } } : {}),
          ...(arm.pull !== undefined ? { pull: arm.pull } : {}),
          upperFill: arm.upperFill,
          lowerFill: arm.lowerFill,
          edgeWidth: houseArm.edgeWidth,
          fillWidth: houseArm.fillWidth,
          ...(houseArm.sleeve !== undefined ? { sleeve: structuredClone(houseArm.sleeve) } : {}),
          hand: houseArm.hand,
          ...(houseArm.crease !== undefined ? { crease: houseArm.crease } : {}),
          ...(arm.cap !== undefined ? { cap: arm.cap } : {}),
        }
      : {
          ...(arm.shoulder !== undefined ? { shoulder: arm.shoulder === null ? null : { ...arm.shoulder } } : {}),
          ...(arm.pull !== undefined ? { pull: arm.pull } : {}),
          upperFill: arm.upperFill,
          lowerFill: arm.lowerFill,
          edgeWidth: arm.edgeWidth!,
          fillWidth: arm.fillWidth!,
          ...(arm.sleeve !== undefined
            ? {
                sleeve: arm.sleeve === null
                  ? null
                  : { width: arm.sleeve.width, d: segmentsToD(arm.sleeve.d), seam: segmentsToD(arm.sleeve.seam) },
              }
            : {}),
          hand: segmentsToD(arm.hand!),
          ...(arm.crease !== undefined ? { crease: arm.crease === null ? null : segmentsToD(arm.crease) } : {}),
          ...(arm.cuff !== undefined ? { cuff: arm.cuff === null ? null : segmentsToD(arm.cuff) } : {}),
          ...(arm.cap !== undefined ? { cap: arm.cap } : {}),
        },
  };
};

export const compileClipDocument = (doc: ClipDocument): Clip => ({
  id: doc.id,
  name: doc.name,
  duration: doc.duration,
  loop: doc.loop,
  layer: doc.layer,
  tracks: structuredClone(doc.tracks),
});
