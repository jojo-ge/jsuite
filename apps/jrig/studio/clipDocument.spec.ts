// Opening a clip document in the editor and saving it back must not cost you
// anything that was in the file.

import { describe, expect, it } from 'vitest';

import type { ClipDocument } from '../rig/document';

import { compileClipDocument } from '../rig/compiler';
import { serialiseDocument } from '../rig/document';
import { buildSeedDocuments } from '../rig/migrate';
import { clipDocumentFrom } from './clipDocument';

const seedClips = buildSeedDocuments().filter(doc => doc.name.endsWith('.clip.json'));

describe('clipDocumentFrom', () => {
  it.each(seedClips.map(doc => doc.name))('%s survives open → save untouched', (name) => {
    const raw = seedClips.find(doc => doc.name === name)!.content;
    const opened = JSON.parse(raw) as ClipDocument;
    const saved = clipDocumentFrom(compileClipDocument(opened), opened);
    expect(serialiseDocument(saved)).toBe(raw);
  });

  it('keeps fields the runtime Clip has no slot for', () => {
    const opened = {
      ...JSON.parse(seedClips[0]!.content) as ClipDocument,
      notes: 'why this clip eases the way it does',
    };
    const saved = clipDocumentFrom(compileClipDocument(opened), opened);
    expect(saved.notes).toBe('why this clip eases the way it does');
  });

  it('carries edits over the document it was opened from', () => {
    const opened = JSON.parse(seedClips[0]!.content) as ClipDocument;
    const edited = { ...compileClipDocument(opened), name: 'Renamed', duration: 4 };
    const saved = clipDocumentFrom(edited, opened);
    expect(saved.name).toBe('Renamed');
    expect(saved.duration).toBe(4);
  });

  it('ignores the opened document when the clip is a different one', () => {
    const opened = { ...JSON.parse(seedClips[0]!.content) as ClipDocument, notes: 'not mine' };
    const other = { ...compileClipDocument(opened), id: 'somethingElse' };
    const saved = clipDocumentFrom(other, opened);
    expect(saved.id).toBe('somethingElse');
    expect(saved.notes).toBeUndefined();
  });
});
