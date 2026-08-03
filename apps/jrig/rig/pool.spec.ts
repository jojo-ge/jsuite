// The gate on the live document pool. jsuite has no CI, so `pnpm --filter jrig
// test` is the only thing standing between a hand-edited (or Claude-edited)
// document and a broken studio — and the rest of the suite only ever sees
// documents it built in memory. This one reads what is actually on disk.
//
// Skips itself when `.data/jrig/documents/` is empty, which is the state of a
// fresh clone before the seeder has run.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CharacterDocument } from './document';

import { compileCharacterDocument } from './compiler';
import { CHARACTER_SCHEMA, DOC_NAME_RE, serialiseDocument } from './document';
import { validateDocument } from './validator';

// `@jsuite/data` resolves this off the workspace root; recomputing it here keeps
// the spec runnable under plain vitest, which is the rule for everything in rig/.
const POOL = join(import.meta.dirname, '..', '..', '..', '.data', 'jrig', 'documents');

const names = existsSync(POOL) ? readdirSync(POOL).filter(name => DOC_NAME_RE.test(name)).sort() : [];

describe.skipIf(names.length === 0)('the document pool on disk', () => {
  it.each(names)('%s parses, validates and round-trips its serialisation', (name) => {
    const raw = readFileSync(join(POOL, name), 'utf8');
    const doc = JSON.parse(raw) as { id?: string, schema?: string };

    // The filename stem IS the id — the studio, the registry and every save
    // address documents by it.
    expect(doc.id).toBe(name.replace(/\.(character|clip)\.json$/, ''));

    const errors = validateDocument(doc).filter(issue => issue.level === 'error');
    expect(errors, errors.map(issue => `${issue.path}: ${issue.message}`).join('\n')).toEqual([]);

    // 2-space + trailing newline, or a studio save silently rewrites the whole
    // file and every future diff is noise.
    expect(raw).toBe(serialiseDocument(doc as never));

    if (doc.schema === CHARACTER_SCHEMA) {
      expect(() => compileCharacterDocument(doc as unknown as CharacterDocument)).not.toThrow();
    }
  });
});
