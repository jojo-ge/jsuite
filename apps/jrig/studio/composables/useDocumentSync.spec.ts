// The concurrency contract, exercised against an in-memory "server":
// silent reload when clean, banner when dirty, keep-mine → 409 → overwrite.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentSync } from './useDocumentSync';

interface FakeFile {
  content: string;
  mtimeMs: number;
}

const makeServer = () => {
  const files = new Map<string, FakeFile>();
  let clock = 1000;
  const touch = (name: string, content: string) => {
    clock += 1;
    files.set(name, { content, mtimeMs: clock });
  };
  const fetcher = async (url: string, opts?: Record<string, unknown>) => {
    if (url === '/api/rig/documents') {
      return { documents: [...files.entries()].map(([name, file]) => ({ name, mtimeMs: file.mtimeMs })) };
    }
    const name = url.split('/').pop()!;
    const file = files.get(name);
    if (opts?.method === 'PUT') {
      const body = opts.body as { content: string, baseMtimeMs?: number, force?: boolean };
      if (file && body.force !== true && file.mtimeMs !== body.baseMtimeMs) {
        const error = new Error('conflict') as Error & { statusCode: number, data: { data: FakeFile & { name: string } } };
        error.statusCode = 409;
        error.data = { data: { name, ...file } };
        throw error;
      }
      touch(name, body.content);
      return { name, mtimeMs: files.get(name)!.mtimeMs };
    }
    if (!file) {
      throw Object.assign(new Error('missing'), { statusCode: 404 });
    }
    return { name, ...file };
  };
  return { files, touch, fetcher };
};

describe('useDocumentSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const server = makeServer();
    server.touch('wave.clip.json', '{"v":1}');
    const applied: [string, boolean][] = [];
    const statuses: string[] = [];
    const sync = useDocumentSync({
      fetcher: server.fetcher,
      pollMs: 2000,
      onApplied: (doc, external) => applied.push([doc.content, external]),
      onStatus: message => statuses.push(message),
    });
    return { server, sync, applied, statuses };
  };

  it('opens a document and saves through the fence', async () => {
    const { server, sync, applied } = setup();
    await sync.open('wave.clip.json');
    expect(applied).toEqual([['{"v":1}', false]]);

    sync.markDirty();
    expect(await sync.save('{"v":2}')).toBe('saved');
    expect(sync.dirty.value).toBe(false);
    expect(server.files.get('wave.clip.json')!.content).toBe('{"v":2}');

    // The save updated baseMtimeMs, so the next poll stays quiet.
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.conflict.value).toBeNull();
    expect(applied).toHaveLength(1);
  });

  it('silently reloads an external edit when clean', async () => {
    const { server, sync, applied, statuses } = setup();
    await sync.open('wave.clip.json');

    server.touch('wave.clip.json', '{"v":"claude"}');
    await vi.advanceTimersByTimeAsync(2000);

    expect(applied).toEqual([['{"v":1}', false], ['{"v":"claude"}', true]]);
    expect(statuses).toContain('Reloaded — external edit');
    expect(sync.conflict.value).toBeNull();
  });

  it('raises the banner when dirty, and keep-mine leads to 409 → overwrite', async () => {
    const { server, sync, statuses } = setup();
    await sync.open('wave.clip.json');
    sync.markDirty();

    server.touch('wave.clip.json', '{"v":"claude"}');
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.conflict.value).toBe('external');

    // Keep mine: banner clears, mtime stays stale…
    sync.keepMine();
    expect(sync.conflict.value).toBeNull();

    // …so the save 409s and upgrades to the overwrite banner.
    expect(await sync.save('{"v":"mine"}')).toBe('conflict');
    expect(sync.conflict.value).toBe('stale-save');
    expect(server.files.get('wave.clip.json')!.content).toBe('{"v":"claude"}');

    await sync.overwrite('{"v":"mine"}');
    expect(sync.conflict.value).toBeNull();
    expect(server.files.get('wave.clip.json')!.content).toBe('{"v":"mine"}');
    expect(statuses).toContain('Overwrote the external version');

    // Overwrite refreshed the fence: polling stays quiet.
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.conflict.value).toBeNull();
  });

  // `adopt` is save-as: the editor already holds the content, so reading disk
  // over it would be exactly wrong. The empty fence is what keeps it safe.
  it('adopt creates a document that does not exist yet', async () => {
    const { server, sync, applied } = setup();
    sync.adopt('newEmote.clip.json');

    expect(applied).toEqual([]);
    expect(await sync.save('{"v":"new"}')).toBe('saved');
    expect(server.files.get('newEmote.clip.json')!.content).toBe('{"v":"new"}');
  });

  it('adopt refuses to clobber a document it never loaded', async () => {
    const { server, sync } = setup();
    sync.adopt('wave.clip.json');

    expect(await sync.save('{"v":"mine"}')).toBe('conflict');
    expect(sync.conflict.value).toBe('stale-save');
    expect(server.files.get('wave.clip.json')!.content).toBe('{"v":1}');

    // …and the usual escalation is still the way through.
    await sync.overwrite('{"v":"mine"}');
    expect(server.files.get('wave.clip.json')!.content).toBe('{"v":"mine"}');
  });

  it('discard-mine takes the disk version and clears the dirty flag', async () => {
    const { server, sync, applied } = setup();
    await sync.open('wave.clip.json');
    sync.markDirty();
    server.touch('wave.clip.json', '{"v":"claude"}');
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.conflict.value).toBe('external');

    await sync.discardMine();
    expect(sync.dirty.value).toBe(false);
    expect(sync.conflict.value).toBeNull();
    expect(applied[applied.length - 1]).toEqual(['{"v":"claude"}', true]);
  });
});
