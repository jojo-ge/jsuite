// The M2 gate: migration → compilation must be a perfect round trip for every
// migratable flat style (compiler fidelity is risk #1 in docs/PLAN.md), and
// the seed pool the app boots from must validate cleanly and compile back to
// the exact TS sources it was derived from — the .data replacement for the
// original plan's committed-file pin.

import { describe, expect, it } from 'vitest';

import { BUILT_IN_CLIPS } from './clips';
import { compileCharacterDocument, compileClipDocument } from './compiler';
import { CLIP_SCHEMA } from './document';
import { artStyleToDocument, buildSeedDocuments, clipToDocument, dToSegments, MigrationError } from './migrate';
import { ART_STYLES, STYLES_BY_ID } from './styles';
import { validateCharacterDocument, validateClipDocument } from './validator';

/**
 * Replaces every SVG path string with its parsed numeric form, so equality is
 * asserted on numbers, never on string formatting (decision: paths are
 * "verbatim absolute commands as JSON arrays").
 */
const PATH_KEYS = new Set(['d', 'path', 'shirt', 'shade', 'nose', 'fold', 'seam', 'hand', 'crease', 'cuff']);

/** JSON-number semantics for both sides: documents cannot hold -0. */
const canon = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const normalise = (value: unknown, key?: string): unknown => {
  if (typeof value === 'string' && key !== undefined && PATH_KEYS.has(key)) {
    return dToSegments(value);
  }
  if (Array.isArray(value)) {
    return value.map(entry => normalise(entry));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v, k)]));
  }
  return value;
};

describe('dToSegments', () => {
  it('parses absolute M/L/C/Q/A/Z losslessly', () => {
    const parsed = dToSegments('M 200 64 C 238 64, 264 88, 264 132 L 100 100 Q 5 6 7 8 A 15 22 0 0 1 130 172 Z');
    expect(parsed.closed).toBe(true);
    expect(parsed.segments).toEqual([
      ['M', 200, 64],
      ['C', 238, 64, 264, 88, 264, 132],
      ['L', 100, 100],
      ['Q', 5, 6, 7, 8],
      ['A', 15, 22, 0, 0, 1, 130, 172],
    ]);
  });

  it('honours implicit command repetition, with M repeating as L', () => {
    expect(dToSegments('M 0 0 10 10 L 1 2 3 4').segments).toEqual([
      ['M', 0, 0],
      ['L', 10, 10],
      ['L', 1, 2],
      ['L', 3, 4],
    ]);
  });

  it('refuses relative and shorthand commands', () => {
    expect(() => dToSegments('M 0 0 l 10 10')).toThrow(MigrationError);
    expect(() => dToSegments('M 0 0 H 10')).toThrow(MigrationError);
  });
});

describe('character round trip', () => {
  const flat = ART_STYLES.filter(style => !style.shading && !style.filter && !style.rough);

  it('round-trips every migratable flat style through document form', () => {
    const migrated: string[] = [];
    const refused: string[] = [];
    for (const style of flat) {
      let doc;
      try {
        doc = artStyleToDocument(style);
      }
      catch (error) {
        expect(error, style.id).toBeInstanceOf(MigrationError);
        refused.push(`${style.id}: ${(error as Error).message}`);
        continue;
      }
      migrated.push(style.id);
      expect(normalise(compileCharacterDocument(doc)), style.id).toEqual(normalise(style));
    }
    // The proof pair must migrate (decision 7); anything refused must be for a
    // stated schema-v1 reason, pinned here so changes to the set are visible.
    expect(migrated).toContain('house');
    expect(migrated).toContain('hoodie');
    expect(refused).toEqual([
      'riso: behind[0].fill: paint "#e2504a" is not a --rig- role (schema v1 is roles-only)',
    ]);
  });

  it('refuses styles with shading/filter/rough, with a reason', () => {
    const shaded = ART_STYLES.find(style => style.shading);
    expect(shaded).toBeDefined();
    expect(() => artStyleToDocument(shaded!)).toThrow(/outside schema v1/);
  });
});

describe('clip round trip', () => {
  it('round-trips the entire built-in library', () => {
    for (const clip of BUILT_IN_CLIPS) {
      expect(canon(compileClipDocument(clipToDocument(clip))), clip.id).toEqual(canon(clip));
    }
  });
});

describe('the seed pool', () => {
  const seeds = buildSeedDocuments();

  it('is house + hoodie + the 10 built-in clips, one file each', () => {
    expect(seeds.map(seed => seed.name).sort()).toEqual([
      'house.character.json',
      'hoodie.character.json',
      ...BUILT_IN_CLIPS.map(clip => `${clip.id}.clip.json`),
    ].sort());
  });

  it('writes the mandated serialisation: 2-space, trailing newline', () => {
    for (const seed of seeds) {
      expect(seed.content.endsWith('}\n'), seed.name).toBe(true);
      expect(seed.content, seed.name).toContain('\n  "schema"');
    }
  });

  it('validates with zero errors', () => {
    for (const seed of seeds) {
      const parsed = JSON.parse(seed.content) as { schema: string };
      const issues = parsed.schema === CLIP_SCHEMA
        ? validateClipDocument(parsed)
        : validateCharacterDocument(parsed);
      expect(issues.filter(issue => issue.level === 'error'), seed.name).toEqual([]);
    }
  });

  it('pins: seeds compile back to the exact TS sources they came from', () => {
    const seed = (name: string) => JSON.parse(seeds.find(entry => entry.name === name)!.content);
    expect(normalise(compileCharacterDocument(seed('house.character.json'))))
      .toEqual(normalise(STYLES_BY_ID.house));
    expect(normalise(compileCharacterDocument(seed('hoodie.character.json'))))
      .toEqual(normalise(STYLES_BY_ID.hoodie));
    for (const clip of BUILT_IN_CLIPS) {
      expect(canon(compileClipDocument(seed(`${clip.id}.clip.json`))), clip.id).toEqual(canon(clip));
    }
  });
});
