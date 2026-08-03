// The runtime bridge between `.data/jrig/documents/` and the renderer.
// Framework-free pure functions: the app fetches document files from
// `/api/rig/documents` and this module parses → validates → compiles them.
// Documents are the ONLY thing the app renders — there is no merge with the TS
// styles any more, and `rig/styles.ts` survives purely as what the seeder
// migrates from. There is no import.meta.glob and no HMR here either:
// documents are state, not source (decision 15), and the 2s mtime poll is the
// one live-reload channel.

import type { Clip } from './core';
import type { Issue } from './validator';
import type { ArtStyle } from './styles';

import { compileCharacterDocument, compileClipDocument } from './compiler';
import { CLIP_SCHEMA } from './document';
import { validateCharacterDocument, validateClipDocument } from './validator';

export interface RigDocumentFile {
  name: string;
  kind: 'character' | 'clip';
  mtimeMs: number;
  content?: string;
}

export interface CompiledDocuments {
  styles: ArtStyle[];
  clips: Clip[];
  /** Per-file issues (validation errors block compilation; warnings don't). */
  issues: Record<string, Issue[]>;
}

export const compileDocuments = (files: { name: string; content: string }[]): CompiledDocuments => {
  const out: CompiledDocuments = { styles: [], clips: [], issues: {} };
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    }
    catch (error) {
      out.issues[file.name] = [{ level: 'error', code: 'json', path: '', message: (error as Error).message }];
      continue;
    }
    const isClip = typeof parsed === 'object' && parsed !== null && (parsed as { schema?: unknown }).schema === CLIP_SCHEMA;
    const issues = isClip ? validateClipDocument(parsed) : validateCharacterDocument(parsed);
    if (issues.length > 0) {
      out.issues[file.name] = issues;
    }
    if (issues.some(issue => issue.level === 'error')) {
      continue;
    }
    if (isClip) {
      out.clips.push(compileClipDocument(parsed as Parameters<typeof compileClipDocument>[0]));
    }
    else {
      out.styles.push(compileCharacterDocument(parsed as Parameters<typeof compileCharacterDocument>[0]));
    }
  }
  return out;
};
