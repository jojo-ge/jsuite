// Document files on disk. Everything lives FLAT in `.data/jrig/documents/`
// (suite convention via @jsuite/data — never inside the app); the
// `.character.json` / `.clip.json` suffix carries the kind, so no subfolders.
// Names are whitelisted and resolved strictly inside the documents dir.

import { appDataFile } from '@jsuite/data';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { DOC_NAME_RE } from '../../rig/document';

export interface RigDocumentStat {
  name: string;
  kind: 'character' | 'clip';
  mtimeMs: number;
}

export const rigDocumentsDir = () => dirname(appDataFile('jrig', 'documents', '.keep'));

export const isRigDocumentName = (name: string) => DOC_NAME_RE.test(name);

const rigDocumentPath = (name: string) => {
  if (!isRigDocumentName(name)) {
    throw new Error(`invalid document name "${name}"`);
  }
  return join(rigDocumentsDir(), name);
};

export const listRigDocuments = async (): Promise<RigDocumentStat[]> => {
  const dir = rigDocumentsDir();
  await mkdir(dir, { recursive: true });
  const names = (await readdir(dir)).filter(isRigDocumentName).sort();
  return Promise.all(names.map(async name => ({
    name,
    kind: (name.endsWith('.character.json') ? 'character' : 'clip') as RigDocumentStat['kind'],
    mtimeMs: (await stat(join(dir, name))).mtimeMs,
  })));
};

export const readRigDocument = async (name: string) => {
  const path = rigDocumentPath(name);
  try {
    const [content, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { name, content, mtimeMs: stats.mtimeMs };
  }
  catch {
    return null;
  }
};

export const writeRigDocument = async (name: string, content: string) => {
  const path = rigDocumentPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return { name, mtimeMs: (await stat(path)).mtimeMs };
};
