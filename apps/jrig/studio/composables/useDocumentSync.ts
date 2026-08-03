// Two-party concurrent editing over the save endpoint (docs/PLAN.md §M3): the
// studio in one seat, Claude editing `.data/jrig/documents/` files in the
// other. mtime is the fence — saves carry `baseMtimeMs` and 409 on staleness;
// a 2s poll notices external edits. Clean document + external edit → silent
// reload (the page toasts, and from M5a pushes an "External edit" history
// entry so cmd+z recovers the pre-reload state). Dirty + external edit →
// banner [Reload — discard mine] / [Keep mine]; keep-mine leaves the stale
// mtime so the NEXT save 409s and the banner upgrades to [Overwrite anyway].
// No three-way merge — history snapshots are the merge tool.

import { getCurrentScope, onScopeDispose, ref } from 'vue';

export interface SyncedDocument {
  name: string;
  content: string;
  mtimeMs: number;
}

export type SyncConflict = 'external' | 'stale-save' | null;

type Fetcher = (url: string, opts?: Record<string, unknown>) => Promise<unknown>;

export interface DocumentSyncDeps {
  /** Disk content arriving in the editor: initial open, silent reload, discard-mine. */
  onApplied: (doc: SyncedDocument, external: boolean) => void;
  onStatus?: (message: string) => void;
  /** Injectable for specs; defaults to the app's $fetch. */
  fetcher?: Fetcher;
  pollMs?: number;
}

const statusCodeOf = (error: unknown): number | null => {
  const e = error as { statusCode?: number, status?: number, response?: { status?: number } };
  return e?.statusCode ?? e?.status ?? e?.response?.status ?? null;
};

/** The 409 payload: the current disk version, straight off the error. */
export const conflictDataOf = (error: unknown): SyncedDocument | null => {
  const e = error as { data?: { data?: SyncedDocument }, response?: { _data?: { data?: SyncedDocument } } };
  return e?.data?.data ?? e?.response?._data?.data ?? (e?.data as unknown as SyncedDocument | undefined) ?? null;
};

export function useDocumentSync(deps: DocumentSyncDeps) {
  const fetcher = deps.fetcher ?? ((globalThis as { $fetch?: Fetcher }).$fetch as Fetcher);
  const pollMs = deps.pollMs ?? 2000;

  const name = ref<string | null>(null);
  const dirty = ref(false);
  const conflict = ref<SyncConflict>(null);
  let baseMtimeMs: number | null = null;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const applyDisk = async (external: boolean, message?: string) => {
    if (!name.value) {
      return;
    }
    const doc = await fetcher(`/api/rig/documents/${name.value}`) as SyncedDocument;
    baseMtimeMs = doc.mtimeMs;
    dirty.value = false;
    conflict.value = null;
    deps.onApplied(doc, external);
    if (message) {
      deps.onStatus?.(message);
    }
  };

  const poll = async () => {
    if (!name.value || busy) {
      return;
    }
    try {
      const list = await fetcher('/api/rig/documents') as { documents: { name: string, mtimeMs: number }[] };
      const entry = list.documents.find(candidate => candidate.name === name.value);
      if (!entry || entry.mtimeMs === baseMtimeMs) {
        return;
      }
      if (dirty.value) {
        if (!conflict.value) {
          conflict.value = 'external';
        }
        return;
      }
      await applyDisk(true, 'Reloaded — external edit');
    }
    catch {
      // Dev server mid-restart; the next tick will see it.
    }
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  // Call from the client only (onMounted / a user action) — an SSR call would
  // leak this interval into the server process.
  const open = async (docName: string) => {
    name.value = docName;
    conflict.value = null;
    await applyDisk(false);
    if (!timer) {
      timer = setInterval(() => void poll(), pollMs);
    }
  };

  /**
   * Point at a document WITHOUT reading it — for save-as, where the editor
   * already holds the content and pulling disk over it would be the opposite of
   * what was asked. The fence starts empty, so the first save creates the file
   * if it is new and 409s if it is not: you never silently overwrite a document
   * you did not load.
   */
  const adopt = (docName: string) => {
    name.value = docName;
    baseMtimeMs = null;
    conflict.value = null;
    if (!timer) {
      timer = setInterval(() => void poll(), pollMs);
    }
  };

  const save = async (content: string): Promise<'saved' | 'conflict' | 'error'> => {
    if (!name.value) {
      return 'error';
    }
    busy = true;
    try {
      const result = await fetcher(`/api/rig/documents/${name.value}`, {
        method: 'PUT',
        body: { content, ...(baseMtimeMs !== null ? { baseMtimeMs } : {}) },
      }) as { mtimeMs: number };
      baseMtimeMs = result.mtimeMs;
      dirty.value = false;
      conflict.value = null;
      deps.onStatus?.('Saved');
      return 'saved';
    }
    catch (error) {
      if (statusCodeOf(error) === 409) {
        conflict.value = 'stale-save';
        deps.onStatus?.('Save blocked — the file changed underneath');
        return 'conflict';
      }
      deps.onStatus?.(`Save failed: ${(error as Error).message}`);
      return 'error';
    }
    finally {
      busy = false;
    }
  };

  /** The banner's "Overwrite anyway" — only ever offered after a 409. */
  const overwrite = async (content: string) => {
    if (!name.value) {
      return;
    }
    busy = true;
    try {
      const result = await fetcher(`/api/rig/documents/${name.value}`, {
        method: 'PUT',
        body: { content, force: true },
      }) as { mtimeMs: number };
      baseMtimeMs = result.mtimeMs;
      dirty.value = false;
      conflict.value = null;
      deps.onStatus?.('Overwrote the external version');
    }
    finally {
      busy = false;
    }
  };

  /** The banner's "Reload — discard mine". */
  const discardMine = () => applyDisk(true, 'Reloaded — discarded local changes');

  /** The banner's "Keep mine": stale mtime stays, so the next save 409s. */
  const keepMine = () => {
    conflict.value = null;
  };

  const markDirty = () => {
    dirty.value = true;
  };

  if (getCurrentScope()) {
    onScopeDispose(stop);
  }

  return { name, dirty, conflict, open, adopt, save, overwrite, discardMine, keepMine, markDirty, stop };
}
