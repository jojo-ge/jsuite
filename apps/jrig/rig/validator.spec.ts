import { describe, expect, it } from 'vitest';

import type { CharacterDocument, ClipDocument } from './document';

import { artStyleToDocument, clipToDocument } from './migrate';
import { BUILT_IN_CLIPS } from './clips';
import { STYLES_BY_ID } from './styles';
import { validateCharacterDocument, validateClipDocument } from './validator';

const houseDoc = () => structuredClone(artStyleToDocument(STYLES_BY_ID.house!));
const hoodieDoc = () => structuredClone(artStyleToDocument(STYLES_BY_ID.hoodie!));
const waveDoc = () => structuredClone(clipToDocument(BUILT_IN_CLIPS.find(clip => clip.id === 'wave')!));

const errors = (issues: ReturnType<typeof validateCharacterDocument>) =>
  issues.filter(issue => issue.level === 'error');

const codes = (issues: ReturnType<typeof validateCharacterDocument>) =>
  errors(issues).map(issue => issue.code);

describe('validateCharacterDocument', () => {
  it('passes the migrated house and hoodie documents clean', () => {
    expect(errors(validateCharacterDocument(houseDoc()))).toEqual([]);
    expect(errors(validateCharacterDocument(hoodieDoc()))).toEqual([]);
  });

  it('rejects a wrong or missing schema outright', () => {
    expect(codes(validateCharacterDocument({ schema: 'avatar-character/9' }))).toContain('schema');
    expect(codes(validateCharacterDocument('nope'))).toContain('schema');
  });

  it('rejects raw colours, var() and url() where a role is required', () => {
    const doc = hoodieDoc();
    doc.head.over![0]!.fill = '#ffffff';
    doc.head.over![1]!.stroke = 'var(--rig-line)';
    const found = codes(validateCharacterDocument(doc));
    expect(found).toContain('paint-role');
    expect(found).toContain('stroke-role');
  });

  it('restricts strokes to line ∪ palette and fills to the 13 roles ∪ palette', () => {
    const doc = hoodieDoc();
    doc.head.over![0]!.fill = 'nonexistent-role';
    doc.torso.detail![1]!.stroke = 'skin';
    const found = codes(validateCharacterDocument(doc));
    expect(found).toContain('paint-role');
    expect(found).toContain('stroke-role');
  });

  it('enforces face symmetry about the mirror axis', () => {
    const doc = houseDoc();
    doc.face.mouth.cx = 210;
    doc.face.eye.l.cx = 170;
    expect(codes(validateCharacterDocument(doc))).toContain('face-symmetry');
  });

  it('enforces the ink grade', () => {
    const doc = houseDoc();
    doc.ink.detail = doc.ink.silhouette + 1;
    expect(codes(validateCharacterDocument(doc))).toContain('ink-grade');
  });

  it('catches the sleeve-nub trap: a shirt that tops out too low', () => {
    const doc = houseDoc();
    for (const segment of doc.torso.shirt.segments) {
      const coords = segment as unknown as (string | number)[];
      for (let i = 2; i < coords.length; i += 2) {
        coords[i] = Math.max(coords[i] as number, 300);
      }
    }
    expect(codes(validateCharacterDocument(doc))).toContain('shirt-top');
  });

  it('forbids legacy arm fields once a rig is set, and checks rig params', () => {
    const doc = houseDoc();
    doc.arm.rig = {
      id: 'x',
      name: 'x',
      blurb: '',
      taper: [{ at: 0.4, r: 20 }, { at: 0.2, r: 18 }],
      smooth: 2,
      ink: -1,
      hand: {} as never,
      creases: 'soft',
    };
    const found = codes(validateCharacterDocument(doc));
    expect(found).toContain('rig-xor-legacy');
    expect(found).toContain('rig-params');
  });

  it('enforces left-side-only authoring on mirrored art', () => {
    const doc = houseDoc();
    for (const segment of doc.arm.hand.segments) {
      const coords = segment as unknown as (string | number)[];
      for (let i = 1; i < coords.length; i += 2) {
        coords[i] = (coords[i] as number) + 200;
      }
    }
    expect(codes(validateCharacterDocument(doc))).toContain('left-side');
  });

  it('enforces closed fills and open strokes', () => {
    const doc = houseDoc();
    doc.head.path.closed = false;
    doc.head.brow.d.closed = true;
    const found = codes(validateCharacterDocument(doc));
    expect(found.filter(code => code === 'closed')).toHaveLength(2);
  });

  it('rejects malformed segments', () => {
    const doc = houseDoc();
    doc.head.path.segments.push(['C', 1, 2] as never);
    expect(codes(validateCharacterDocument(doc))).toContain('arity');
  });

  it('requires unique layer ids', () => {
    const doc = hoodieDoc();
    doc.torso.detail![1]!.id = doc.torso.detail![0]!.id;
    expect(codes(validateCharacterDocument(doc))).toContain('layer-ids');
  });

  it('pins schema v1 with warnings on shading/filter/rough, never errors', () => {
    const doc = houseDoc() as CharacterDocument & { shading?: unknown };
    doc.shading = { head: [] };
    const issues = validateCharacterDocument(doc);
    expect(errors(issues)).toEqual([]);
    expect(issues.some(issue => issue.code === 'unknown-key' && issue.level === 'warning')).toBe(true);
  });
});

describe('validateClipDocument', () => {
  it('passes every migrated built-in clip clean', () => {
    for (const clip of BUILT_IN_CLIPS) {
      expect(errors(validateClipDocument(clipToDocument(clip))), clip.id).toEqual([]);
    }
  });

  it('rejects channels the rig does not have', () => {
    const doc = waveDoc();
    doc.tracks['tail.rot'] = [{ t: 0, v: 1 }];
    expect(codes(validateClipDocument(doc))).toContain('clip-channel');
  });

  it('rejects unordered or out-of-range keys and bad easings', () => {
    const doc = waveDoc();
    const channel = Object.keys(doc.tracks)[0]!;
    doc.tracks[channel] = [
      { t: 0.5, v: 1 },
      { t: 0.1, v: 0, e: 'zigzag' as never },
      { t: doc.duration + 1, v: 0 },
    ];
    const found = codes(validateClipDocument(doc));
    expect(found).toContain('clip-keys');
    expect(found).toContain('clip-easing');
  });

  it('requires emotes to sample back to rest at t = duration', () => {
    const doc = waveDoc();
    const channel = Object.keys(doc.tracks)[0]!;
    const keys = doc.tracks[channel]!;
    keys[keys.length - 1] = { t: doc.duration, v: 999 };
    expect(codes(validateClipDocument(doc))).toContain('clip-rest');
  });

  it('flags empty tracks as warnings', () => {
    const doc = waveDoc() as ClipDocument;
    doc.tracks['head.rot'] = [];
    const issues = validateClipDocument(doc);
    expect(issues.some(issue => issue.code === 'clip-empty' && issue.level === 'warning')).toBe(true);
  });
});
