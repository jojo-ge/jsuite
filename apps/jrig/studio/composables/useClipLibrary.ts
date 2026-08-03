// Clip CRUD + JSON round-trip + localStorage persistence, lifted from the
// ported RigEditor. In M7 the studio's clips panel replaces the editor but
// keeps running on this composable; in M3+ the JSON round-trip feeds the
// document save endpoint instead of the clipboard.

import type { Ref } from 'vue';

import { computed, ref, watch } from 'vue';

import type { Clip } from '../../rig/core';

import { BUILT_IN_CLIPS, cloneClips } from '../../rig/clips';

export interface ClipLibraryOptions {
  initialClipId?: string;
  /** localStorage key; omit to disable persistence. SSR-safe either way. */
  storageKey?: string;
  onStatus?: (message: string) => void;
}

export function useClipLibrary({ initialClipId, storageKey, onStatus }: ClipLibraryOptions = {}) {
  const clips: Ref<Clip[]> = ref(cloneClips());
  const activeClipId = ref<string>(initialClipId ?? clips.value[0]!.id);
  const activeClip = computed(() => clips.value.find(clip => clip.id === activeClipId.value) ?? clips.value[0]!);

  const status = (message: string) => onStatus?.(message);

  const addClip = () => {
    const id = `clip${clips.value.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
    clips.value.push({ id, name: 'New emote', duration: 2, loop: false, layer: 'emote', tracks: {} });
    activeClipId.value = id;
  };

  const duplicateClip = () => {
    const source = activeClip.value;
    const id = `${source.id}-copy-${Math.random().toString(36).slice(2, 5)}`;
    clips.value.push({
      ...source,
      id,
      name: `${source.name} copy`,
      tracks: Object.fromEntries(
        Object.entries(source.tracks).map(([channel, keys]) => [channel, keys.map(key => ({ ...key }))]),
      ),
    });
    activeClipId.value = id;
  };

  const deleteClip = () => {
    const index = clips.value.findIndex(clip => clip.id === activeClipId.value);
    if (clips.value.length <= 1 || index < 0) {
      return;
    }
    clips.value.splice(index, 1);
    activeClipId.value = clips.value[0]!.id;
  };

  /**
   * Put a clip into the library by id — how a clip document gets loaded. It
   * replaces rather than appends, so opening the same document twice gives you
   * one `wave`, not two, and re-opening is the way to throw away local edits.
   *
   * `select` is false for the silent reload the mtime poll triggers: the file
   * changing under you is not a reason to move you off the clip you are
   * actually editing.
   */
  const loadClip = (clip: Clip, select = true) => {
    const index = clips.value.findIndex(entry => entry.id === clip.id);
    if (index >= 0) {
      clips.value.splice(index, 1, clip);
    }
    else {
      clips.value.push(clip);
    }
    if (select) {
      activeClipId.value = clip.id;
    }
  };

  const resetLibrary = () => {
    clips.value = cloneClips(BUILT_IN_CLIPS);
    activeClipId.value = clips.value[0]!.id;
    status('Reset to the built-in clips');
  };

  const toJson = () => JSON.stringify(clips.value, null, 2);

  const fromJson = (text: string): boolean => {
    try {
      const parsed = JSON.parse(text) as Clip[];
      if (!Array.isArray(parsed) || parsed.some(clip => !clip.id || !clip.tracks)) {
        throw new Error('Not a clip array');
      }
      clips.value = parsed;
      activeClipId.value = parsed[0]?.id ?? '';
      status(`Imported ${parsed.length} clips`);
      return true;
    }
    catch (error) {
      status(`Import failed: ${(error as Error).message}`);
      return false;
    }
  };

  /** Load the persisted library. Call from onMounted — it touches window. */
  const restore = () => {
    if (!storageKey || typeof window === 'undefined') {
      return;
    }
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        clips.value = JSON.parse(saved) as Clip[];
        status('Restored your last session from local storage');
      }
      catch {
        status('Saved clips were unreadable — starting from the built-ins');
      }
    }
    if (!clips.value.some(clip => clip.id === activeClipId.value)) {
      activeClipId.value = clips.value[0]?.id ?? '';
    }
  };

  if (storageKey) {
    watch(clips, () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, JSON.stringify(clips.value));
      }
    }, { deep: true });
  }

  return {
    clips,
    activeClipId,
    activeClip,
    addClip,
    duplicateClip,
    deleteClip,
    loadClip,
    resetLibrary,
    toJson,
    fromJson,
    restore,
  };
}
