// The read loop, against an in-memory "server": compile on open, re-fetch only
// when an mtime moves, survive a bad file, survive a dead server.

import { describe, expect, it, vi } from 'vitest';

import { buildSeedDocuments } from '../../rig/migrate';
import { useDocumentPool } from './useDocumentPool';

const makeServer = (seed = buildSeedDocuments()) => {
  const files = new Map(seed.map(doc => [doc.name, { content: doc.content, mtimeMs: 1000 }]));
  let clock = 1000;
  let listCalls = 0;
  let contentCalls = 0;

  const touch = (name: string, content: string) => {
    clock += 1;
    files.set(name, { content, mtimeMs: clock });
  };

  const fetcher = vi.fn(async (url: string, opts?: Record<string, unknown>) => {
    if (url !== '/api/rig/documents') {
      throw new Error(`unexpected ${url}`);
    }
    const withContent = Boolean((opts?.query as { content?: string } | undefined)?.content);
    withContent ? (contentCalls += 1) : (listCalls += 1);
    return {
      documents: [...files.entries()].map(([name, file]) => ({
        name,
        kind: name.endsWith('.clip.json') ? 'clip' : 'character',
        mtimeMs: file.mtimeMs,
        ...(withContent ? { content: file.content } : {}),
      })),
    };
  });

  return { files, touch, fetcher, calls: () => ({ listCalls, contentCalls }) };
};

describe('useDocumentPool', () => {
  it('compiles the pool into styles and clips', async () => {
    const server = makeServer();
    const pool = useDocumentPool({ fetcher: server.fetcher });

    await pool.refresh();

    expect(pool.styles.value.map(style => style.id).sort()).toEqual(['hoodie', 'house']);
    expect(pool.clips.value.length).toBe(10);
    expect(pool.errorCount.value).toBe(0);
    expect(pool.files.value.length).toBe(12);
  });

  it('only re-reads bodies when an mtime actually moves', async () => {
    const server = makeServer();
    const pool = useDocumentPool({ fetcher: server.fetcher });

    await pool.refresh();
    await pool.refresh();
    await pool.refresh();
    expect(server.calls().contentCalls).toBe(1);

    const doc = JSON.parse(server.files.get('wave.clip.json')!.content) as { name: string };
    doc.name = 'Waggle';
    server.touch('wave.clip.json', `${JSON.stringify(doc, null, 2)}\n`);

    await pool.refresh();
    expect(server.calls().contentCalls).toBe(2);
    expect(pool.clips.value.find(clip => clip.id === 'wave')?.name).toBe('Waggle');
  });

  it('drops an invalid document and reports it instead of blanking the pool', async () => {
    const server = makeServer();
    const pool = useDocumentPool({ fetcher: server.fetcher });
    await pool.refresh();

    const broken = JSON.parse(server.files.get('hoodie.character.json')!.content) as { ink: unknown };
    broken.ink = { silhouette: 1, feature: 4, detail: 9 }; // ungraded — an error
    server.touch('hoodie.character.json', `${JSON.stringify(broken, null, 2)}\n`);
    await pool.refresh();

    expect(pool.styles.value.map(style => style.id)).toEqual(['house']);
    expect(pool.errorCount.value).toBeGreaterThan(0);
    expect(pool.issues.value['hoodie.character.json']?.some(issue => issue.code === 'ink-grade')).toBe(true);
  });

  it('keeps the last good compile when the server goes away', async () => {
    const server = makeServer();
    const pool = useDocumentPool({ fetcher: server.fetcher });
    await pool.refresh();
    const before = pool.styles.value;

    server.fetcher.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(pool.refresh()).resolves.toBeUndefined();

    expect(pool.styles.value).toBe(before);
  });
});
