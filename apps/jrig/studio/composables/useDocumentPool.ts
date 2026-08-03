// Read side of `.data/jrig/documents/`: list → compile → keep following disk.
//
// Documents are state, not source, so there is no HMR for them (decision 15) —
// an mtime poll is the one live-reload channel, and every consumer that draws a
// document needs the same loop. The gallery, the still page and the editor all
// had their own copy of it; this is that copy, once.
//
// The listing is cheap and the contents are not, so a poll only re-fetches
// bodies when the {name, mtime} stamp actually moves. Compilation is
// `rig/registry.ts` — validation errors drop a document from the output and
// land in `issues` rather than throwing, because one bad file on disk must not
// blank the page that is showing you the error.

import type { Ref, ShallowRef } from 'vue';

import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue';

import type { Clip } from '../../rig/core';
import type { ArtStyle } from '../../rig/styles';
import type { Issue } from '../../rig/validator';

import { compileDocuments } from '../../rig/registry';

export interface PoolFile {
  name: string;
  kind: 'character' | 'clip';
  mtimeMs: number;
}

type Fetcher = (url: string, opts?: Record<string, unknown>) => Promise<unknown>;

export interface DocumentPoolOptions {
  /** Injectable for specs; defaults to the app's $fetch. */
  fetcher?: Fetcher;
  pollMs?: number;
}

export interface DocumentPool {
  files: Ref<PoolFile[]>;
  styles: ShallowRef<ArtStyle[]>;
  clips: ShallowRef<Clip[]>;
  issues: Ref<Record<string, Issue[]>>;
  errorCount: Ref<number>;
  /** Fetch once, now. Safe to call repeatedly — it no-ops on an unchanged pool. */
  refresh: () => Promise<void>;
  /** Client only: an interval on the server would leak into the node process. */
  start: () => void;
  stop: () => void;
}

export function useDocumentPool({ fetcher, pollMs = 2000 }: DocumentPoolOptions = {}): DocumentPool {
  const request = fetcher ?? ((globalThis as { $fetch?: Fetcher }).$fetch as Fetcher);

  const files = ref<PoolFile[]>([]);
  const styles = shallowRef<ArtStyle[]>([]);
  const clips = shallowRef<Clip[]>([]);
  const issues = ref<Record<string, Issue[]>>({});

  const errorCount = computed(() =>
    Object.values(issues.value).flat().filter(issue => issue.level === 'error').length);

  let stamp = '';
  let timer: ReturnType<typeof setInterval> | null = null;

  const refresh = async () => {
    try {
      const list = await request('/api/rig/documents') as { documents: PoolFile[] };
      const next = list.documents.map(entry => `${entry.name}:${entry.mtimeMs}`).join('|');
      files.value = list.documents;
      if (next === stamp) {
        return;
      }
      stamp = next;
      const full = await request('/api/rig/documents', { query: { content: '1' } }) as {
        documents: (PoolFile & { content?: string })[];
      };
      const compiled = compileDocuments(
        full.documents.map(entry => ({ name: entry.name, content: entry.content ?? '' })),
      );
      styles.value = compiled.styles;
      clips.value = compiled.clips;
      issues.value = compiled.issues;
    }
    catch {
      // Dev server mid-restart. Keep the last good compile — a blank rig is a
      // worse answer than a stale one, and the next tick will catch up.
    }
  };

  const start = () => {
    void refresh();
    if (!timer) {
      timer = setInterval(() => void refresh(), pollMs);
    }
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  if (getCurrentScope()) {
    onScopeDispose(stop);
  }

  return { files, styles, clips, issues, errorCount, refresh, start, stop };
}
