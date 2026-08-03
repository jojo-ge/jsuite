// The keying layer, lifted from the ported RigEditor: a `scratch` pose that
// streams during gestures, auto-key commits at gesture end, and every
// key/track mutation on the active clip. The composed stage pose comes in
// late-bound via deps so this file owns keys, not the layer stack.

import type { Ref } from 'vue';

import { computed, ref } from 'vue';

import type { ChannelId, Clip, Easing, Pose } from '../../rig/core';

import { channelLabel, CHANNELS_BY_ID, createRestPose, putKeyframe } from '../../rig/core';
import { roundTime } from './useTransport';

export interface ClipKeyingDeps {
  activeClip: () => Clip;
  playhead: () => number;
  autoKey: () => boolean;
  /** The fully composed pose the stage shows (rest → base → clip → scratch). */
  editPose: () => Partial<Pose>;
  onStatus?: (message: string) => void;
}

export interface KeySelection {
  channel: ChannelId;
  t: number;
}

export function useClipKeying(deps: ClipKeyingDeps) {
  const scratch: Ref<Partial<Pose>> = ref({});
  const selectedKey: Ref<KeySelection | null> = ref(null);

  const status = (message: string) => deps.onStatus?.(message);

  const channelValue = (channel: ChannelId): number =>
    deps.editPose()[channel] ?? CHANNELS_BY_ID[channel]?.rest ?? 0;

  const writeKey = (channel: ChannelId, t: number, v: number) => {
    const clip = deps.activeClip();
    const existing = clip.tracks[channel] ?? [];
    const previous = existing.find(key => Math.abs(key.t - t) < 0.001);
    clip.tracks[channel] = putKeyframe(existing, t, v, previous?.e);
    selectedKey.value = { channel, t };
  };

  const commitScratch = () => {
    const entries = Object.entries(scratch.value);
    if (entries.length === 0) {
      return;
    }
    for (const [channel, v] of entries) {
      if (v !== undefined) {
        writeKey(channel, roundTime(deps.playhead()), v);
      }
    }
    scratch.value = {};
    status(`Keyed ${entries.length} channel${entries.length === 1 ? '' : 's'} at ${deps.playhead().toFixed(2)}s`);
  };

  const setChannel = (channel: ChannelId, v: number, commit = true) => {
    scratch.value = { ...scratch.value, [channel]: v };
    if (commit && deps.autoKey()) {
      commitScratch();
    }
  };

  /** Sliders stream through `scratch` while dragging and key once on release. */
  const onSliderCommit = () => {
    if (deps.autoKey()) {
      commitScratch();
    }
  };

  /** Keys every channel that currently differs from the rest pose. */
  const keyWholePose = () => {
    const rest = createRestPose();
    const pose = deps.editPose();
    let count = 0;
    for (const channel of Object.keys(pose)) {
      const v = pose[channel];
      if (v === undefined || Math.abs(v - (rest[channel] ?? 0)) < 0.0001) {
        continue;
      }
      writeKey(channel, roundTime(deps.playhead()), v);
      count += 1;
    }
    scratch.value = {};
    status(`Keyed full pose (${count} channels) at ${deps.playhead().toFixed(2)}s`);
  };

  const deleteKey = (channel: ChannelId, t: number) => {
    const clip = deps.activeClip();
    const next = (clip.tracks[channel] ?? []).filter(key => Math.abs(key.t - t) > 0.001);
    if (next.length === 0) {
      delete clip.tracks[channel];
    }
    else {
      clip.tracks[channel] = next;
    }
    selectedKey.value = null;
    status(`Deleted key on ${channelLabel(channel)}`);
  };

  const clearTrack = (channel: ChannelId) => {
    delete deps.activeClip().tracks[channel];
    selectedKey.value = null;
    status(`Cleared ${channelLabel(channel)}`);
  };

  const isSelectedKey = (channel: ChannelId, t: number) =>
    selectedKey.value?.channel === channel && Math.abs(selectedKey.value.t - t) < 0.001;

  const findSelectedKey = () => {
    const selection = selectedKey.value;
    if (!selection) {
      return null;
    }
    const track = deps.activeClip().tracks[selection.channel];
    return track?.find(entry => Math.abs(entry.t - selection.t) < 0.001) ?? null;
  };

  const selectedKeyEasing = computed<Easing>(() => findSelectedKey()?.e ?? 'ease');

  const setKeyEasing = (easing: Easing) => {
    const key = findSelectedKey();
    if (key) {
      key.e = easing;
    }
  };

  const isKeyed = (channel: ChannelId) =>
    (deps.activeClip().tracks[channel] ?? []).some(key => Math.abs(key.t - deps.playhead()) < 0.02);

  const isAnimated = (channel: ChannelId) => (deps.activeClip().tracks[channel] ?? []).length > 0;

  const resetChannel = (channel: ChannelId) => {
    setChannel(channel, CHANNELS_BY_ID[channel]?.rest ?? 0);
  };

  return {
    scratch,
    selectedKey,
    channelValue,
    writeKey,
    commitScratch,
    setChannel,
    onSliderCommit,
    keyWholePose,
    deleteKey,
    clearTrack,
    isSelectedKey,
    selectedKeyEasing,
    setKeyEasing,
    isKeyed,
    isAnimated,
    resetChannel,
  };
}
