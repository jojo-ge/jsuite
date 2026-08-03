// The canonical character/clip document format — a serialisable `ArtStyle`
// mirror, field-for-field, with exactly three deltas (see docs/PLAN.md §M2):
//   1. every SVG path string becomes a structured segment list (`DocPath`),
//   2. every paint becomes a bare role name (`"fill": "cap"` → `var(--rig-cap)`),
//   3. a `schema`/`id`/`notes` envelope is added, and layers get required ids.
// `compileCharacterDocument` (compiler.ts) maps a document back onto ArtStyle;
// the renderer never sees documents. Schema v1 is flat fills only — no
// shading/filter/rough blocks; those stay TS-authored until an
// `avatar-character/2` ever needs them.

import type { ArmRig } from './arm';
import type { Clip, FaceGeometry, Keyframe } from './core';
import type { ArtStyle } from './styles';

export const CHARACTER_SCHEMA = 'avatar-character/1';
export const CLIP_SCHEMA = 'avatar-clip/1';

/**
 * The 13 skin-contract roles every character can bind paint to — the keys of
 * every `Skin.colours` map, bare (the compiler adds the `--rig-` prefix).
 * `line` is deliberately NOT here: line ink stays near-black and only a
 * document's own palette can override it (the escape hatch, decision 10).
 */
export const SKIN_ROLES = [
  'skin',
  'skin-shade',
  'skin-deep',
  'shirt',
  'shirt-shade',
  'eye-white',
  'pupil',
  'brow',
  'mouth',
  'teeth',
  'tongue',
  'blush',
  'tear',
] as const;

export type SkinRole = typeof SKIN_ROLES[number];

export const LINE_ROLE = 'line';

/**
 * One SVG command as data: verbatim absolute coordinates, lossless for
 * M/L/C/Q/A so migration round-trips exactly. `closed: true` replaces `Z`.
 * The node editor derives anchors/handles from `C` segments and converts a
 * `Q`/`A` to cubics only when the artist touches that node.
 */
export type PathSegment
  = | ['M', number, number]
    | ['L', number, number]
    | ['C', number, number, number, number, number, number]
    | ['Q', number, number, number, number]
    | ['A', number, number, number, number, number, number, number];

export type SegmentCommand = PathSegment[0];

/** Coordinate count per command (`A` is rx ry rot largeArc sweep x y). */
export const SEGMENT_ARITY: Record<SegmentCommand, number> = {
  M: 2,
  L: 2,
  C: 6,
  Q: 4,
  A: 7,
};

export interface DocPath {
  closed: boolean;
  segments: PathSegment[];
}

/** A free-form art layer. `id` is document-only — the compiler drops it. */
export interface DocLayer {
  /** Unique within the document, so the editor, undo labels and Claude conversations can address it. */
  id: string;
  d: DocPath;
  /** Bare role: one of the 13 skin roles or a key of this document's palette. */
  fill?: string;
  /** Bare role: `line` or a key of this document's palette. */
  stroke?: string;
  width?: number;
  opacity?: number;
  /** Reflected about x=200 as well as drawn — author the left side only. */
  mirrored?: boolean;
  notes?: string;
}

export interface CharacterDocument {
  schema: typeof CHARACTER_SCHEMA;
  id: string;
  name: string;
  blurb: string;
  notes?: string;
  viewBox: { bust: string; rig: string };
  ink: { silhouette: number; feature: number; detail: number };
  /** Bare keys (`"cap": "#241d54"`) — the compiler prefixes `--rig-`. */
  palette?: Record<string, string>;
  head: {
    path: DocPath;
    behind?: DocLayer[];
    over?: DocLayer[];
    ear?: { path: DocPath; fold?: DocPath } | null;
    brow: { d: DocPath; width: number; cap?: 'round' | 'butt' | 'square' };
    nose?: DocPath | null;
    blush?: { cx: number; cy: number; rx: number; ry: number } | null;
  };
  face: FaceGeometry;
  pupil: ArtStyle['pupil'];
  torso: {
    neck?: { x: number; y: number; width: number; height: number; rx: number } | null;
    behind?: DocLayer[];
    shirt: DocPath;
    shade?: DocPath | null;
    detail?: DocLayer[];
  };
  arm: {
    /**
     * Full ArmRig params, embedded verbatim (decision 4). When set, the legacy
     * `edgeWidth`/`fillWidth`/`hand`/`crease`/`sleeve`/`cuff` fields must be
     * ABSENT (validator error — formalising the renderer's silent-ignore) and
     * the compiler fills ArtStyle's required legacy fields with house defaults.
     */
    rig?: ArmRig | null;
    shoulder?: { x: number; y: number } | null;
    pull?: number;
    upperFill: 'skin' | 'shirt';
    lowerFill: 'skin' | 'shirt';
    edgeWidth?: number;
    fillWidth?: number;
    sleeve?: { width: number; d: DocPath; seam: DocPath } | null;
    hand?: DocPath;
    crease?: DocPath | null;
    cuff?: DocPath | null;
    cap?: 'round' | 'square';
  };
}

export interface ClipDocument {
  schema: typeof CLIP_SCHEMA;
  id: string;
  name: string;
  notes?: string;
  duration: number;
  loop: boolean;
  layer: Clip['layer'];
  /** Fully expanded tracks — `handTracks`/`mirrored` were TS authoring sugar. */
  tracks: Record<string, Keyframe[]>;
}

export type RigDocument = CharacterDocument | ClipDocument;

export const isCharacterDocument = (doc: RigDocument): doc is CharacterDocument =>
  doc.schema === CHARACTER_SCHEMA;

/** `<id>.character.json` / `<id>.clip.json` — the one filename convention. */
export const documentFileName = (doc: RigDocument): string =>
  `${doc.id}.${isCharacterDocument(doc) ? 'character' : 'clip'}.json`;

// camelCase allowed: the built-in clip ids (`raiseHand`, `thumbsUp`) predate
// the format and ids ARE filenames.
export const DOC_NAME_RE = /^[a-z][a-zA-Z0-9-]*\.(character|clip)\.json$/;

export const DOC_ID_RE = /^[a-z][a-zA-Z0-9-]*$/;

/**
 * The one serialisation used everywhere — studio saves, the seeder, and
 * Claude-authored files must all diff identically: 2-space, trailing newline.
 */
export const serialiseDocument = (doc: RigDocument): string =>
  `${JSON.stringify(doc, null, 2)}\n`;
