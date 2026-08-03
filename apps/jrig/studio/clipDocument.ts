// Turning the editor's live `Clip` back into the clip document it came from.
//
// `compileClipDocument` is lossy on purpose — a `Clip` is what the renderer
// needs, not what the file holds — so a naive open→save would quietly delete
// every field the runtime type has no slot for, `notes` above all. Saving
// therefore layers the regenerated fields over the document as it was read.
//
// Key order comes from the original object, so a document opened and saved
// without an edit re-serialises byte-identical; that is what `serialiseDocument`
// promises and what the pool spec enforces on disk.

import type { Clip } from '../rig/core';
import type { ClipDocument } from '../rig/document';

import { clipToDocument } from '../rig/migrate';

export const clipDocumentFrom = (clip: Clip, opened: unknown): ClipDocument => {
  const regenerated = clipToDocument(clip);
  const isSameDocument = typeof opened === 'object' && opened !== null
    && (opened as { id?: unknown }).id === regenerated.id;
  return isSameDocument
    ? { ...(opened as ClipDocument), ...regenerated }
    : regenerated;
};
