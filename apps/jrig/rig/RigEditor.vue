<script lang="ts" setup>
// Keyframe editor for the avatar rig. Dev tooling, not product UI: it is
// deliberately self-contained (own controls, own styles, no KUI primitives, no
// i18n) so it can be dropped on an unauthenticated page and iterated on fast.
//
// The clip is the single source of truth. Scrubbing samples it, dragging a bone
// writes back into it, and "Copy JSON" produces exactly what
// `clips.ts` holds — so anything authored here can be pasted into the
// built-in library verbatim.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { ChannelId, ChannelSpec, Clip, Easing, JointId, Pose } from './core';

import { BUILT_IN_CLIPS, cloneClips } from './clips';
import {
  ALL_CHANNELS,
  applyPose,
  channelLabel,
  CHANNELS_BY_ID,
  createRestPose,
  DEPTH_CHANNELS,
  EASING_IDS,
  FACE_CHANNELS,
  JOINTS_BY_ID,
  putKeyframe,
  sampleClip,
  SKELETON,
  sortTrack,
} from './core';
import AvatarRig from './AvatarRig.vue';

const STORAGE_KEY = 'jrig-clips-v1';
const CHANNEL_ORDER = new Map(ALL_CHANNELS.map((channel, index) => [channel.id, index]));

const clips = ref<Clip[]>(cloneClips());
const activeClipId = ref<string>('facepalm');
const playhead = ref(0);
const playing = ref(false);
const rigPreview = ref(false);
const baseState = ref<'idle' | 'talking' | null>(null);
const autoKey = ref(true);
// On by default so the character breathes and blinks while you author. Drags
// cache their pivot at the start, so the sway never makes handles jitter.
const ambient = ref(true);
// Bones, pivots and handles. Off hides the whole overlay, so dragging a joint
// on the stage goes with it — pick joints from the inspector chips instead.
const showRig = ref(true);
const speed = ref(1);
const selectedJoint = ref<JointId | null>('armRUp');
const selectedKey = ref<{ channel: ChannelId; t: number } | null>(null);
const scratch = ref<Partial<Pose>>({});
const jsonDraft = ref('');
const showJson = ref(false);
const status = ref('');

const avatarRef = ref<InstanceType<typeof AvatarRig> | null>(null);
const timelineRef = ref<HTMLElement | null>(null);
const timelineWidth = ref(900);

const activeClip = computed(() => clips.value.find(clip => clip.id === activeClipId.value) ?? clips.value[0]!);
const baseClip = computed(() => (baseState.value ? clips.value.find(clip => clip.id === baseState.value) : null));

// The same layer stack the rig runs, so what you author is what you get.
const editPose = computed<Partial<Pose>>(() => {
  const pose = createRestPose();
  if (baseClip.value) {
    applyPose(pose, sampleClip(baseClip.value, playhead.value));
  }
  applyPose(pose, sampleClip(activeClip.value, playhead.value));
  applyPose(pose, scratch.value);
  return pose;
});

const channelValue = (channel: ChannelId): number =>
  editPose.value[channel] ?? CHANNELS_BY_ID[channel]?.rest ?? 0;

// --- clip mutation --------------------------------------------------------

const roundTime = (t: number) => Math.round(t * 1000) / 1000;
const roundValue = (v: number) => Math.round(v * 100) / 100;

const flagDirty = (message: string) => {
  status.value = message;
};

const writeKey = (channel: ChannelId, t: number, v: number) => {
  const clip = activeClip.value;
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
      writeKey(channel, roundTime(playhead.value), v);
    }
  }
  scratch.value = {};
  flagDirty(`Keyed ${entries.length} channel${entries.length === 1 ? '' : 's'} at ${playhead.value.toFixed(2)}s`);
};

const setChannel = (channel: ChannelId, v: number, commit = true) => {
  scratch.value = { ...scratch.value, [channel]: v };
  if (commit && autoKey.value) {
    commitScratch();
  }
};

/** Sliders stream through `scratch` while dragging and key once on release. */
const onSliderCommit = () => {
  if (autoKey.value) {
    commitScratch();
  }
};

/** Keys every channel that currently differs from the rest pose. */
const keyWholePose = () => {
  const rest = createRestPose();
  const pose = editPose.value;
  let count = 0;
  for (const channel of Object.keys(pose)) {
    const v = pose[channel];
    if (v === undefined || Math.abs(v - (rest[channel] ?? 0)) < 0.0001) {
      continue;
    }
    writeKey(channel, roundTime(playhead.value), v);
    count += 1;
  }
  scratch.value = {};
  flagDirty(`Keyed full pose (${count} channels) at ${playhead.value.toFixed(2)}s`);
};

const deleteKey = (channel: ChannelId, t: number) => {
  const clip = activeClip.value;
  const next = (clip.tracks[channel] ?? []).filter(key => Math.abs(key.t - t) > 0.001);
  if (next.length === 0) {
    delete clip.tracks[channel];
  }
  else {
    clip.tracks[channel] = next;
  }
  selectedKey.value = null;
  flagDirty(`Deleted key on ${channelLabel(channel)}`);
};

const clearTrack = (channel: ChannelId) => {
  delete activeClip.value.tracks[channel];
  selectedKey.value = null;
  flagDirty(`Cleared ${channelLabel(channel)}`);
};

const isSelectedKey = (channel: ChannelId, t: number) =>
  selectedKey.value?.channel === channel && Math.abs(selectedKey.value.t - t) < 0.001;

const findSelectedKey = () => {
  const selection = selectedKey.value;
  if (!selection) {
    return null;
  }
  const track = activeClip.value.tracks[selection.channel];
  return track?.find(entry => Math.abs(entry.t - selection.t) < 0.001) ?? null;
};

const selectedKeyEasing = computed<Easing>(() => findSelectedKey()?.e ?? 'ease');

const setKeyEasing = (easing: Easing) => {
  const key = findSelectedKey();
  if (key) {
    key.e = easing;
  }
};

// --- clip library ---------------------------------------------------------

const addClip = () => {
  const id = `clip${clips.value.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
  clips.value.push({ id, name: 'New emote', duration: 2, loop: false, layer: 'emote', tracks: {} });
  activeClipId.value = id;
  playhead.value = 0;
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
  playhead.value = 0;
};

const resetLibrary = () => {
  clips.value = cloneClips(BUILT_IN_CLIPS);
  activeClipId.value = clips.value[0]!.id;
  playhead.value = 0;
  scratch.value = {};
  flagDirty('Reset to the built-in clips');
};

// --- playback -------------------------------------------------------------

let rafId: number | null = null;
let lastFrameAt = 0;

const tick = (now: number) => {
  const dt = Math.min((now - lastFrameAt) / 1000, 0.05) * speed.value;
  lastFrameAt = now;
  const next = playhead.value + dt;
  const duration = activeClip.value.duration;
  playhead.value = next > duration ? (activeClip.value.loop ? next % duration : duration) : next;
  if (!activeClip.value.loop && playhead.value >= duration) {
    playing.value = false;
    return;
  }
  rafId = requestAnimationFrame(tick);
};

const setPlaying = (next: boolean) => {
  playing.value = next;
  if (next) {
    scratch.value = {};
    if (playhead.value >= activeClip.value.duration) {
      playhead.value = 0;
    }
    lastFrameAt = performance.now();
    rafId = requestAnimationFrame(tick);
    return;
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
};

/** True end-to-end check: hands the clip to the rig's own layer blending. */
const playInRig = () => {
  setPlaying(false);
  rigPreview.value = true;
  void nextTick(() => avatarRef.value?.play(activeClipId.value));
};

const scrubTo = (t: number) => {
  scratch.value = {};
  playhead.value = Math.min(Math.max(roundTime(t), 0), activeClip.value.duration);
};

// --- stage dragging -------------------------------------------------------

const svgEl = () => (avatarRef.value?.$el ?? null) as SVGSVGElement | null;

const toViewBox = (event: PointerEvent) => {
  const svg = svgEl();
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm) {
    return null;
  }
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(ctm.inverse());
};

interface DragState {
  joint: JointId;
  mode: 'rotate' | 'translate';
  startAngle: number;
  startRot: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  pivotX: number;
  pivotY: number;
  parentRot: number;
}

let drag: DragState | null = null;

const shortestDelta = (delta: number) => {
  let d = delta;
  while (d > 180) {
    d -= 360;
  }
  while (d < -180) {
    d += 360;
  }
  return d;
};

const onDragMove = (event: PointerEvent) => {
  if (!drag) {
    return;
  }
  const point = toViewBox(event);
  if (!point) {
    return;
  }
  const joint = JOINTS_BY_ID[drag.joint];
  if (drag.mode === 'rotate') {
    if (!joint.channels.includes('rot')) {
      return;
    }
    // World rotation composes additively, so an angle delta measured in view-box
    // space is the same delta the local channel needs — whatever the parent is
    // doing. Rotating a joint cannot move its own pivot, so the pivot cached at
    // drag start stays valid and the ambient sway can't make the drag jitter.
    const now = Math.atan2(point.y - drag.pivotY, point.x - drag.pivotX) * (180 / Math.PI);
    const delta = shortestDelta(now - drag.startAngle);
    setChannel(`${drag.joint}.rot`, roundValue(drag.startRot + delta), false);
    return;
  }
  // Translation is authored in the joint's own frame, so dragging follows the
  // pointer even when an ancestor is rotated.
  const dx = point.x - drag.originX;
  const dy = point.y - drag.originY;
  const rad = (-drag.parentRot * Math.PI) / 180;
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
  if (joint.channels.includes('x')) {
    setChannel(`${drag.joint}.x`, roundValue(drag.startX + localX), false);
  }
  if (joint.channels.includes('y')) {
    setChannel(`${drag.joint}.y`, roundValue(drag.startY + localY), false);
  }
};

const onDragEnd = () => {
  window.removeEventListener('pointermove', onDragMove);
  if (autoKey.value) {
    commitScratch();
  }
  drag = null;
};

const onJointPointerDown = (jointId: JointId, event: PointerEvent) => {
  selectedJoint.value = jointId;
  setPlaying(false);
  rigPreview.value = false;
  const frames = avatarRef.value?.frames();
  const point = toViewBox(event);
  if (!frames || !point) {
    return;
  }
  const frame = frames[jointId];
  drag = {
    joint: jointId,
    mode: event.shiftKey || event.altKey ? 'translate' : 'rotate',
    startAngle: Math.atan2(point.y - frame.y, point.x - frame.x) * (180 / Math.PI),
    startRot: channelValue(`${jointId}.rot`),
    startX: channelValue(`${jointId}.x`),
    startY: channelValue(`${jointId}.y`),
    originX: point.x,
    originY: point.y,
    pivotX: frame.x,
    pivotY: frame.y,
    parentRot: frame.parentRot,
  };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd, { once: true });
};

// --- timeline -------------------------------------------------------------

const pxPerSecond = computed(() => timelineWidth.value / Math.max(activeClip.value.duration, 0.1));

const trackRows = computed(() =>
  Object.entries(activeClip.value.tracks)
    .filter(([, keys]) => keys.length > 0)
    .sort(([a], [b]) => (CHANNEL_ORDER.get(a) ?? 999) - (CHANNEL_ORDER.get(b) ?? 999)),
);

const rulerTicks = computed(() => {
  const duration = activeClip.value.duration;
  const stepSize = duration > 4 ? 0.5 : 0.25;
  const out: number[] = [];
  for (let t = 0; t <= duration + 0.0001; t += stepSize) {
    out.push(roundTime(t));
  }
  return out;
});

const timeFromEvent = (event: PointerEvent) => {
  const rect = timelineRef.value?.getBoundingClientRect();
  if (!rect) {
    return 0;
  }
  return ((event.clientX - rect.left) / rect.width) * activeClip.value.duration;
};

const onRulerPointerDown = (event: PointerEvent) => {
  setPlaying(false);
  rigPreview.value = false;
  scrubTo(timeFromEvent(event));
  const move = (moveEvent: PointerEvent) => scrubTo(timeFromEvent(moveEvent));
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
};

let keyDrag: { channel: ChannelId; from: number } | null = null;

const onKeyPointerDown = (channel: ChannelId, t: number, event: PointerEvent) => {
  event.stopPropagation();
  setPlaying(false);
  selectedKey.value = { channel, t };
  scrubTo(t);
  keyDrag = { channel, from: t };
  const move = (moveEvent: PointerEvent) => {
    if (!keyDrag) {
      return;
    }
    const next = roundTime(Math.min(Math.max(timeFromEvent(moveEvent), 0), activeClip.value.duration));
    const track = activeClip.value.tracks[keyDrag.channel] ?? [];
    const key = track.find(entry => Math.abs(entry.t - keyDrag!.from) < 0.001);
    if (!key || next === keyDrag.from) {
      return;
    }
    key.t = next;
    activeClip.value.tracks[keyDrag.channel] = sortTrack(track);
    keyDrag.from = next;
    selectedKey.value = { channel: keyDrag.channel, t: next };
    playhead.value = next;
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => {
    window.removeEventListener('pointermove', move);
    keyDrag = null;
  }, { once: true });
};

// --- JSON round trip ------------------------------------------------------

const exportJson = () => {
  jsonDraft.value = JSON.stringify(clips.value, null, 2);
  showJson.value = true;
  void navigator.clipboard?.writeText(jsonDraft.value).then(
    () => flagDirty('Copied the clip library to the clipboard'),
    () => flagDirty('Clipboard blocked — copy from the panel below'),
  );
};

const importJson = () => {
  try {
    const parsed = JSON.parse(jsonDraft.value) as Clip[];
    if (!Array.isArray(parsed) || parsed.some(clip => !clip.id || !clip.tracks)) {
      throw new Error('Not a clip array');
    }
    clips.value = parsed;
    activeClipId.value = parsed[0]?.id ?? '';
    playhead.value = 0;
    flagDirty(`Imported ${parsed.length} clips`);
  }
  catch (error) {
    flagDirty(`Import failed: ${(error as Error).message}`);
  }
};

// --- inspector ------------------------------------------------------------

const jointGroups = computed(() => ({
  body: SKELETON.filter(joint => joint.group === 'body'),
  arms: SKELETON.filter(joint => joint.group === 'arms'),
  hands: SKELETON.filter(joint => joint.group === 'hands'),
  face: SKELETON.filter(joint => joint.group === 'face'),
}));

const jointChannels = computed<ChannelSpec[]>(() => {
  const joint = selectedJoint.value ? JOINTS_BY_ID[selectedJoint.value] : null;
  if (!joint) {
    return [];
  }
  return joint.channels
    .map(channel => CHANNELS_BY_ID[`${joint.id}.${channel}`])
    .filter((spec): spec is ChannelSpec => Boolean(spec));
});

const isKeyed = (channel: ChannelId) =>
  (activeClip.value.tracks[channel] ?? []).some(key => Math.abs(key.t - playhead.value) < 0.02);

const isAnimated = (channel: ChannelId) => (activeClip.value.tracks[channel] ?? []).length > 0;

const resetChannel = (channel: ChannelId) => {
  setChannel(channel, CHANNELS_BY_ID[channel]?.rest ?? 0);
};

// --- shortcuts + persistence ---------------------------------------------

const onKeyDown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    setPlaying(!playing.value);
  }
  else if (event.key === 'k') {
    commitScratch();
  }
  else if (event.key === 'K') {
    keyWholePose();
  }
  else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedKey.value) {
    deleteKey(selectedKey.value.channel, selectedKey.value.t);
  }
  else if (event.key === 'ArrowRight') {
    scrubTo(playhead.value + (event.shiftKey ? 0.1 : 1 / 30));
  }
  else if (event.key === 'ArrowLeft') {
    scrubTo(playhead.value - (event.shiftKey ? 0.1 : 1 / 30));
  }
};

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      clips.value = JSON.parse(saved) as Clip[];
      flagDirty('Restored your last session from local storage');
    }
    catch {
      flagDirty('Saved clips were unreadable — starting from the built-ins');
    }
  }
  if (!clips.value.some(clip => clip.id === activeClipId.value)) {
    activeClipId.value = clips.value[0]?.id ?? '';
  }
  window.addEventListener('keydown', onKeyDown);
  if (timelineRef.value) {
    resizeObserver = new ResizeObserver(([entry]) => {
      timelineWidth.value = entry?.contentRect.width ?? 900;
    });
    resizeObserver.observe(timelineRef.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  resizeObserver?.disconnect();
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
});

watch(clips, () => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clips.value));
}, { deep: true });

watch(activeClipId, () => {
  playhead.value = 0;
  scratch.value = {};
  selectedKey.value = null;
  rigPreview.value = false;
});
</script>

<template>
  <div class="editor">
    <header class="bar">
      <div class="bar-group">
        <button class="btn btn--primary" @click="setPlaying(!playing)">
          {{ playing ? '❚❚ Pause' : '▶ Play' }}
        </button>
        <button class="btn" @click="playInRig">
          ⧉ Play in rig
        </button>
        <button class="btn" @click="scrubTo(0)">
          ⏮ Start
        </button>
        <span class="readout">{{ playhead.toFixed(2) }}s / {{ activeClip.duration.toFixed(2) }}s</span>
      </div>
      <div class="bar-group">
        <label class="field">Base
          <select v-model="baseState" class="input">
            <option :value="null">none</option>
            <option value="idle">idle</option>
            <option value="talking">talking</option>
          </select>
        </label>
        <label class="field">Speed
          <input
            v-model.number="speed"
            class="input input--num"
            type="number"
            min="0.1"
            max="3"
            step="0.1"
          >
        </label>
        <label class="toggle"><input v-model="autoKey" type="checkbox"> Auto-key</label>
        <label class="toggle"><input v-model="ambient" type="checkbox"> Ambient</label>
        <label class="toggle"><input v-model="showRig" type="checkbox"> Skeleton</label>
      </div>
      <div class="bar-group">
        <button class="btn" @click="commitScratch">
          Key <kbd>K</kbd>
        </button>
        <button class="btn" @click="keyWholePose">
          Key pose <kbd>⇧K</kbd>
        </button>
        <button class="btn" @click="exportJson">
          Copy JSON
        </button>
        <button class="btn" @click="showJson = !showJson">
          {{ showJson ? 'Hide' : 'Import' }}
        </button>
        <button class="btn btn--danger" @click="resetLibrary">
          Reset
        </button>
      </div>
    </header>

    <div class="body">
      <aside class="panel panel--clips">
        <h2 class="panel-title">
          Clips
        </h2>
        <ul class="clip-list">
          <li v-for="clip in clips" :key="clip.id">
            <button
              class="clip"
              :class="{ 'clip--active': clip.id === activeClipId }"
              @click="activeClipId = clip.id"
            >
              <span class="clip-name">{{ clip.name }}</span>
              <span class="clip-meta">{{ clip.layer }} · {{ clip.duration }}s</span>
            </button>
          </li>
        </ul>
        <div class="panel-actions">
          <button class="btn btn--sm" @click="addClip">
            + New
          </button>
          <button class="btn btn--sm" @click="duplicateClip">
            Duplicate
          </button>
          <button class="btn btn--sm btn--danger" @click="deleteClip">
            Delete
          </button>
        </div>

        <h2 class="panel-title">
          Clip settings
        </h2>
        <label class="field field--stack">Name
          <input
            v-model="activeClip.name"
            class="input"
            type="text"
          >
        </label>
        <label class="field field--stack">Duration (s)
          <input
            v-model.number="activeClip.duration"
            class="input"
            type="number"
            min="0.2"
            max="12"
            step="0.1"
          >
        </label>
        <label class="field field--stack">Layer
          <select v-model="activeClip.layer" class="input">
            <option value="base">base</option>
            <option value="emote">emote</option>
          </select>
        </label>
        <label class="toggle"><input v-model="activeClip.loop" type="checkbox"> Loop</label>
      </aside>

      <section class="stage">
        <!-- No `art`: the editor authors against whatever the rig ships as its
             default, so a pose is never tuned to a drawing nobody sees. -->
        <AvatarRig
          ref="avatarRef"
          class="stage-avatar"
          frame="rig"
          :pose="rigPreview ? null : editPose"
          :pose-mode="rigPreview ? 'auto' : 'manual'"
          :base="rigPreview ? baseState : null"
          :clips="clips"
          :ambient="ambient"
          :speed="speed"
          :show-rig="showRig"
          :selected-joint="selectedJoint"
          name="Rig preview"
          @joint-pointer-down="onJointPointerDown"
          @emote-end="rigPreview = false"
        />
        <p class="hint">
          Drag a pivot to rotate · <kbd>Shift</kbd>-drag to translate · <kbd>Space</kbd> play ·
          <kbd>←</kbd>/<kbd>→</kbd> step a frame
        </p>
        <p class="status">
          {{ status }}
        </p>
      </section>

      <aside class="panel panel--inspect">
        <h2 class="panel-title">
          Joints
        </h2>
        <div
          v-for="(group, name) in jointGroups"
          :key="name"
          class="joint-group"
        >
          <span class="group-label">{{ name }}</span>
          <div class="joint-chips">
            <button
              v-for="joint in group"
              :key="joint.id"
              class="chip"
              :class="{ 'chip--active': joint.id === selectedJoint }"
              @click="selectedJoint = joint.id"
            >
              {{ joint.label }}
            </button>
          </div>
        </div>

        <h2 v-if="selectedJoint" class="panel-title">
          {{ JOINTS_BY_ID[selectedJoint].label }}
        </h2>
        <div
          v-for="spec in jointChannels"
          :key="spec.id"
          class="channel"
          :class="{ 'channel--animated': isAnimated(spec.id) }"
        >
          <div class="channel-head">
            <span class="channel-name">{{ spec.label }}</span>
            <button
              class="key-dot"
              :class="{ 'key-dot--on': isKeyed(spec.id) }"
              title="Key this channel at the playhead"
              @click="writeKey(spec.id, roundTime(playhead), channelValue(spec.id))"
            >
              ◆
            </button>
            <button
              class="mini"
              title="Reset to rest"
              @click="resetChannel(spec.id)"
            >
              ⟲
            </button>
          </div>
          <div class="channel-row">
            <input
              class="slider"
              type="range"
              :min="spec.min"
              :max="spec.max"
              :step="spec.step"
              :value="channelValue(spec.id)"
              @input="setChannel(spec.id, Number(($event.target as HTMLInputElement).value), false)"
              @change="onSliderCommit"
            >
            <input
              class="input input--num"
              type="number"
              :step="spec.step"
              :value="channelValue(spec.id)"
              @change="setChannel(spec.id, Number(($event.target as HTMLInputElement).value))"
            >
          </div>
        </div>

        <h2 class="panel-title">
          Face
        </h2>
        <div
          v-for="spec in FACE_CHANNELS"
          :key="spec.id"
          class="channel"
          :class="{ 'channel--animated': isAnimated(spec.id) }"
        >
          <div class="channel-head">
            <span class="channel-name">{{ spec.label }}</span>
            <button
              class="key-dot"
              :class="{ 'key-dot--on': isKeyed(spec.id) }"
              @click="writeKey(spec.id, roundTime(playhead), channelValue(spec.id))"
            >
              ◆
            </button>
            <button class="mini" @click="resetChannel(spec.id)">
              ⟲
            </button>
          </div>
          <div class="channel-row">
            <input
              class="slider"
              type="range"
              :min="spec.min"
              :max="spec.max"
              :step="spec.step"
              :value="channelValue(spec.id)"
              @input="setChannel(spec.id, Number(($event.target as HTMLInputElement).value), false)"
              @change="onSliderCommit"
            >
            <input
              class="input input--num"
              type="number"
              :step="spec.step"
              :value="channelValue(spec.id)"
              @change="setChannel(spec.id, Number(($event.target as HTMLInputElement).value))"
            >
          </div>
        </div>

        <h2 class="panel-title">
          Draw order
        </h2>
        <label
          v-for="spec in DEPTH_CHANNELS"
          :key="spec.id"
          class="toggle"
        >
          <input
            type="checkbox"
            :checked="channelValue(spec.id) >= 0.5"
            @change="setChannel(spec.id, ($event.target as HTMLInputElement).checked ? 1 : 0)"
          >
          {{ spec.label }}
          <button
            class="key-dot"
            :class="{ 'key-dot--on': isKeyed(spec.id) }"
            @click.prevent="writeKey(spec.id, roundTime(playhead), channelValue(spec.id))"
          >◆</button>
        </label>
      </aside>
    </div>

    <section class="timeline">
      <div class="timeline-head">
        <h2 class="panel-title">
          Timeline · {{ trackRows.length }} tracks
        </h2>
        <div v-if="selectedKey" class="key-inspect">
          <span>{{ channelLabel(selectedKey.channel) }} @ {{ selectedKey.t.toFixed(2) }}s</span>
          <select
            class="input"
            :value="selectedKeyEasing"
            @change="setKeyEasing(($event.target as HTMLSelectElement).value as Easing)"
          >
            <option
              v-for="easing in EASING_IDS"
              :key="easing"
              :value="easing"
            >
              {{ easing }}
            </option>
          </select>
          <button class="btn btn--sm btn--danger" @click="deleteKey(selectedKey.channel, selectedKey.t)">
            Delete key
          </button>
        </div>
      </div>

      <div class="track-area">
        <div class="row">
          <span class="row-label" />
          <div
            ref="timelineRef"
            class="ruler"
            @pointerdown="onRulerPointerDown"
          >
            <span
              v-for="mark in rulerTicks"
              :key="mark"
              class="tick"
              :style="{ left: `${mark * pxPerSecond}px` }"
            >{{ mark.toFixed(2) }}</span>
          </div>
          <span class="row-tail" />
        </div>

        <div class="rows">
          <div
            v-for="[channel, keys] in trackRows"
            :key="channel"
            class="row"
          >
            <span class="row-label" :title="channel">{{ channelLabel(channel) }}</span>
            <div class="row-track">
              <button
                v-for="key in keys"
                :key="`${channel}-${key.t}`"
                class="kf"
                :class="{
                  'kf--selected': isSelectedKey(channel, key.t),
                  'kf--hold': key.e === 'hold',
                }"
                :style="{ left: `${key.t * pxPerSecond}px` }"
                :title="`${key.v} @ ${key.t}s (${key.e ?? 'ease'})`"
                @pointerdown="onKeyPointerDown(channel, key.t, $event)"
              >
                ◆
              </button>
            </div>
            <button
              class="row-tail row-clear"
              title="Clear track"
              @click="clearTrack(channel)"
            >
              ✕
            </button>
          </div>
          <p v-if="trackRows.length === 0" class="empty">
            No keys yet. Scrub to a time, pose the rig, and it keys as you go.
          </p>
        </div>

        <div class="playhead" :style="{ left: `calc(168px + ${playhead * pxPerSecond}px)` }" />
      </div>
    </section>

    <section v-if="showJson" class="json">
      <textarea
        v-model="jsonDraft"
        class="json-area"
        spellcheck="false"
        placeholder="Paste a clip library here, then press Import"
      />
      <div class="panel-actions">
        <button class="btn btn--sm" @click="importJson">
          Import
        </button>
        <button class="btn btn--sm" @click="exportJson">
          Refresh from editor
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.editor {
  --ink: #e7e9ee;
  --muted: #8c93a3;
  --panel: #171a21;
  --panel-2: #1f232c;
  --edge: #2b303b;
  --accent: #38bdf8;
  --warn: #f59e0b;

  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100vh;
  padding: 12px;
  background: #0d0f14;
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
}

.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--panel);
  border: 1px solid var(--edge);
  border-radius: 10px;
}
.bar-group { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

.btn {
  padding: 6px 11px;
  color: var(--ink);
  background: var(--panel-2);
  border: 1px solid var(--edge);
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
}
.btn:hover { border-color: var(--accent); }
.btn--primary { background: #0b3e57; border-color: var(--accent); }
.btn--danger:hover { border-color: #ef4444; color: #fca5a5; }
.btn--sm { padding: 4px 8px; font-size: 12px; }

.readout { color: var(--muted); font-variant-numeric: tabular-nums; }
.field { display: flex; gap: 6px; align-items: center; color: var(--muted); }
.field--stack { flex-direction: column; align-items: stretch; margin-bottom: 8px; }
.toggle { display: flex; gap: 6px; align-items: center; color: var(--muted); cursor: pointer; }

.input {
  padding: 5px 7px;
  color: var(--ink);
  background: #10131a;
  border: 1px solid var(--edge);
  border-radius: 6px;
  font: inherit;
}
.input--num { width: 74px; font-variant-numeric: tabular-nums; }

.body {
  display: grid;
  grid-template-columns: 220px minmax(320px, 1fr) 300px;
  gap: 10px;
  align-items: start;
}
@media (width <= 1100px) {
  .body { grid-template-columns: 1fr; }
}

.panel {
  max-height: 68vh;
  padding: 10px;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--edge);
  border-radius: 10px;
}
.panel-title {
  margin: 12px 0 6px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.panel-title:first-child { margin-top: 0; }
.panel-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

.clip-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.clip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 8px;
  color: var(--ink);
  text-align: left;
  background: var(--panel-2);
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
}
.clip--active { border-color: var(--accent); background: #0b3e57; }
.clip-meta { color: var(--muted); font-size: 11px; }

.stage {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  padding: 12px;
  background:
    radial-gradient(circle at 50% 30%, #232a38 0%, #12151c 70%);
  border: 1px solid var(--edge);
  border-radius: 10px;
}
.stage-avatar { width: min(100%, 460px); touch-action: none; }
.hint { margin: 0; color: var(--muted); font-size: 12px; text-align: center; }
.status { min-height: 16px; margin: 0; color: var(--warn); font-size: 12px; }

.joint-group { margin-bottom: 8px; }
.group-label { color: var(--muted); font-size: 11px; text-transform: uppercase; }
.joint-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.chip {
  padding: 3px 7px;
  color: var(--ink);
  background: var(--panel-2);
  border: 1px solid var(--edge);
  border-radius: 20px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.chip--active { border-color: var(--warn); color: var(--warn); }

.channel { padding: 5px 0; border-bottom: 1px solid #21252e; }
.channel--animated .channel-name { color: var(--accent); }
.channel-head { display: flex; gap: 6px; align-items: center; }
.channel-name { flex: 1; color: var(--ink); font-size: 12px; }
.channel-row { display: flex; gap: 6px; align-items: center; margin-top: 3px; }
.slider { flex: 1; min-width: 0; accent-color: var(--accent); }
.key-dot {
  padding: 0 3px;
  color: #4b525f;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
}
.key-dot--on { color: var(--warn); }
.mini {
  padding: 0 3px;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
}

.timeline {
  padding: 10px;
  background: var(--panel);
  border: 1px solid var(--edge);
  border-radius: 10px;
}
.timeline-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
.key-inspect { display: flex; gap: 8px; align-items: center; color: var(--muted); }

/* The ruler sits in a `.row`, so it shares the label gutter with every track —
   one shared coordinate space for ticks, keyframes and the playhead. */
.track-area { position: relative; margin-top: 6px; }
.ruler {
  position: relative;
  flex: 1;
  height: 22px;
  background: #10131a;
  border: 1px solid var(--edge);
  border-radius: 6px;
  cursor: col-resize;
}
.row-tail {
  flex: none;
  width: 18px;
  padding: 0;
  color: var(--muted);
  background: none;
  border: none;
  font: inherit;
  font-size: 12px;
}
.row-clear { cursor: pointer; }
.tick {
  position: absolute;
  top: 3px;
  color: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  transform: translateX(-50%);
  pointer-events: none;
}
.rows { max-height: 240px; overflow-y: auto; }
.row { display: flex; gap: 8px; align-items: center; height: 22px; }
.row-label {
  flex: none;
  width: 160px;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.row-track { position: relative; flex: 1; height: 100%; border-bottom: 1px solid #1b1f27; }
.kf {
  position: absolute;
  top: 2px;
  padding: 0;
  color: var(--accent);
  background: none;
  border: none;
  cursor: grab;
  font-size: 14px;
  line-height: 1;
  transform: translateX(-50%);
}
.kf--selected { color: var(--warn); text-shadow: 0 0 6px currentcolor; }
.kf--hold { color: #a78bfa; }
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--warn);
  pointer-events: none;
}
.empty { padding: 12px 0; color: var(--muted); }

.json { padding: 10px; background: var(--panel); border: 1px solid var(--edge); border-radius: 10px; }
.json-area {
  width: 100%;
  height: 200px;
  padding: 8px;
  color: var(--ink);
  background: #10131a;
  border: 1px solid var(--edge);
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

kbd {
  padding: 1px 4px;
  background: #262b35;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
</style>
