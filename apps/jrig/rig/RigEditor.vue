<script lang="ts" setup>
// Keyframe editor for the avatar rig. Dev tooling, not product UI: it is
// deliberately self-contained (own controls, own styles, no external UI kit,
// no i18n) so it can live on an unauthenticated page and be iterated on fast.
// Since M1 its logic lives in the studio composables (transport / keying /
// library / rig-drag) — this file is the wiring and the markup, and it retires
// in M7 when the studio's Animate mode reaches parity.
//
// The clip is the single source of truth. Scrubbing samples it, dragging a bone
// writes back into it, and "Copy JSON" produces exactly what
// `clips.ts` holds — so anything authored here can be pasted into the
// built-in library verbatim.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { ChannelId, ChannelSpec, Easing, JointId, Pose } from './core';

import { useClipKeying } from '../studio/composables/useClipKeying';
import { useClipLibrary } from '../studio/composables/useClipLibrary';
import { useDocumentPool } from '../studio/composables/useDocumentPool';
import { useDocumentSync } from '../studio/composables/useDocumentSync';
import { clipDocumentFrom } from '../studio/clipDocument';
import { usePointerDrag } from '../studio/composables/usePointerDrag';
import { useRigDrag } from '../studio/composables/useRigDrag';
import { roundTime, useTransport } from '../studio/composables/useTransport';
import AvatarRig from './AvatarRig.vue';
import { compileClipDocument } from './compiler';
import {
  ALL_CHANNELS,
  channelLabel,
  CHANNELS_BY_ID,
  DEPTH_CHANNELS,
  EASING_IDS,
  FACE_CHANNELS,
  JOINTS_BY_ID,
  SKELETON,
  sortTrack,
} from './core';
import { documentFileName, serialiseDocument } from './document';
import { composePose } from './evaluate';
import { validateClipDocument } from './validator';

interface Props {
  /** Character id to draw against; falls back to the last one you picked. */
  character?: string;
  /** Clip document to open on mount, e.g. `wave.clip.json`. */
  clipDocument?: string;
}

const props = defineProps<Props>();

const CHANNEL_ORDER = new Map(ALL_CHANNELS.map((channel, index) => [channel.id, index]));

const status = ref('');
const flagDirty = (message: string) => {
  status.value = message;
};

// --- stores ---------------------------------------------------------------

const library = useClipLibrary({ initialClipId: 'facepalm', storageKey: 'jrig-clips-v1', onStatus: flagDirty });
const { clips, activeClipId, activeClip, addClip, duplicateClip, deleteClip } = library;

// --- documents ------------------------------------------------------------
//
// The editor authors clips, but it draws a character, and both are documents in
// `.data/jrig/documents/`. The pool is the read side (polled, so a file Claude
// edits shows up here within 2s); `docSync` is the write side for the one clip
// document currently linked, with the same mtime fence the raw browser uses.

const CHARACTER_KEY = 'jrig-editor-character-v1';

const pool = useDocumentPool();

// Documents only — `rig/styles.ts` is the seeder's source, not something this
// editor can draw. With an empty pool there is nothing to author against, and
// the stage says so rather than falling back to TS art.
const characters = computed(() => [...pool.styles.value].sort((a, b) => a.name.localeCompare(b.name)));
const characterId = ref('');
const art = computed(() =>
  characters.value.find(style => style.id === characterId.value) ?? characters.value[0] ?? null);

const clipDocumentNames = computed(() =>
  pool.files.value.filter(file => file.kind === 'clip').map(file => file.name));

watch(characterId, (id) => {
  if (typeof window !== 'undefined' && id) {
    window.localStorage.setItem(CHARACTER_KEY, id);
  }
});

// Whatever the pool actually has, once it has compiled — a remembered id whose
// document has since been deleted must not leave the stage blank.
watch([characters, characterId], ([list, id]) => {
  if (list.length > 0 && !list.some(style => style.id === id)) {
    characterId.value = list[0]!.id;
  }
});

// The document as it was read, so a save preserves the fields a `Clip` has no
// slot for — see `studio/clipDocument.ts`.
let openedRaw: unknown = null;
let diskJson = '';

const activeClipDocument = computed(() => clipDocumentFrom(activeClip.value, openedRaw));
const activeClipName = computed(() => documentFileName(activeClipDocument.value));
const activeClipErrors = computed(() =>
  validateClipDocument(activeClipDocument.value).filter(issue => issue.level === 'error'));

const docSync = useDocumentSync({
  onApplied: (doc, external) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(doc.content);
    }
    catch (error) {
      flagDirty(`${doc.name} is not valid JSON: ${(error as Error).message}`);
      return;
    }
    const errors = validateClipDocument(parsed).filter(issue => issue.level === 'error');
    if (errors.length > 0) {
      flagDirty(`${doc.name} — ${errors[0]!.path}: ${errors[0]!.message}`);
      return;
    }
    openedRaw = parsed;
    diskJson = doc.content;
    // Only an explicit open moves you; a poll-driven reload updates in place.
    library.loadClip(compileClipDocument(parsed as never), !external);
  },
  onStatus: flagDirty,
});

// Dirty is what stops the poll silently reloading over your work, so it has to
// track real divergence — not "the user touched something". Comparing the
// serialised form means undoing an edit by hand makes the document clean again.
watch(activeClipDocument, () => {
  if (docSync.name.value === activeClipName.value && serialiseDocument(activeClipDocument.value) !== diskJson) {
    docSync.markDirty();
  }
}, { deep: true });

const openClipDocument = async (name: string) => {
  if (name) {
    await docSync.open(name);
  }
};

const writeActiveClip = async (force: boolean) => {
  const content = serialiseDocument(activeClipDocument.value);
  // Save-as: adopt leaves the fence empty, so this creates a new document and
  // 409s on an existing one you never loaded, rather than silently clobbering.
  if (docSync.name.value !== activeClipName.value) {
    docSync.adopt(activeClipName.value);
  }
  const result = force ? await docSync.overwrite(content) : await docSync.save(content);
  if (docSync.conflict.value === null) {
    diskJson = content;
    openedRaw = JSON.parse(content);
    void pool.refresh();
  }
  return result;
};

const saveActiveClip = () => void writeActiveClip(false);
const overwriteActiveClip = () => void writeActiveClip(true);
const discardMine = () => void docSync.discardMine();

const baseState = ref<'idle' | 'talking' | null>(null);
const autoKey = ref(true);
// On by default so the character breathes and blinks while you author. Drags
// cache their pivot at the start, so the sway never makes handles jitter.
const ambient = ref(true);
// Bones, pivots and handles. Off hides the whole overlay, so dragging a joint
// on the stage goes with it — pick joints from the inspector chips instead.
const showRig = ref(true);
const speed = ref(1);
const rigPreview = ref(false);
const selectedJoint = ref<JointId | null>('armRUp');
const jsonDraft = ref('');
const showJson = ref(false);

const avatarRef = ref<InstanceType<typeof AvatarRig> | null>(null);
const timelineRef = ref<HTMLElement | null>(null);
const timelineWidth = ref(900);

const transport = useTransport({
  duration: () => activeClip.value.duration,
  loop: () => activeClip.value.loop,
  speed: () => speed.value,
  onJump: () => {
    scratch.value = {};
  },
});
const { playhead, playing, setPlaying, scrubTo } = transport;

const keying = useClipKeying({
  activeClip: () => activeClip.value,
  playhead: () => playhead.value,
  autoKey: () => autoKey.value,
  editPose: () => editPose.value,
  onStatus: flagDirty,
});
const {
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
} = keying;

const baseClip = computed(() => (baseState.value ? clips.value.find(clip => clip.id === baseState.value) : null));

// The same layer stack the rig runs, so what you author is what you get.
const editPose = computed<Partial<Pose>>(() => composePose({
  base: baseClip.value ? { clip: baseClip.value, time: playhead.value } : null,
  emote: { clip: activeClip.value, time: playhead.value, weight: 1 },
  overlay: scratch.value,
}));

const resetLibrary = () => {
  library.resetLibrary();
  scrubTo(0);
};

// --- playback -------------------------------------------------------------

/** True end-to-end check: hands the clip to the rig's own layer blending. */
const playInRig = () => {
  setPlaying(false);
  rigPreview.value = true;
  void nextTick(() => avatarRef.value?.play(activeClipId.value));
};

// --- stage dragging -------------------------------------------------------

let scratchBeforeDrag: Partial<Pose> = {};

const rigDrag = useRigDrag({
  svgEl: () => (avatarRef.value?.$el ?? null) as SVGSVGElement | null,
  frames: () => avatarRef.value?.frames(),
  channelValue,
  setChannel: (channel, value) => setChannel(channel, value, false),
  onStart: (jointId) => {
    selectedJoint.value = jointId;
    setPlaying(false);
    rigPreview.value = false;
    scratchBeforeDrag = { ...scratch.value };
  },
  onEnd: () => {
    if (autoKey.value) {
      commitScratch();
    }
  },
  onCancel: () => {
    scratch.value = scratchBeforeDrag;
  },
});
const onJointPointerDown = rigDrag.onJointPointerDown;

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

const timelineDrag = usePointerDrag();

const onRulerPointerDown = (event: PointerEvent) => {
  setPlaying(false);
  rigPreview.value = false;
  scrubTo(timeFromEvent(event));
  timelineDrag.start(event, { onMove: moveEvent => scrubTo(timeFromEvent(moveEvent)) }, { threshold: 0 });
};

const onKeyPointerDown = (channel: ChannelId, t: number, event: PointerEvent) => {
  event.stopPropagation();
  setPlaying(false);
  selectedKey.value = { channel, t };
  scrubTo(t);
  let from = t;
  timelineDrag.start(event, {
    onMove: (moveEvent) => {
      const next = roundTime(Math.min(Math.max(timeFromEvent(moveEvent), 0), activeClip.value.duration));
      const track = activeClip.value.tracks[channel] ?? [];
      const key = track.find(entry => Math.abs(entry.t - from) < 0.001);
      if (!key || next === from) {
        return;
      }
      key.t = next;
      activeClip.value.tracks[channel] = sortTrack(track);
      from = next;
      selectedKey.value = { channel, t: next };
      playhead.value = next;
    },
  }, { threshold: 0 });
};

// --- JSON round trip ------------------------------------------------------

const exportJson = () => {
  jsonDraft.value = library.toJson();
  showJson.value = true;
  void navigator.clipboard?.writeText(jsonDraft.value).then(
    () => flagDirty('Copied the clip library to the clipboard'),
    () => flagDirty('Clipboard blocked — copy from the panel below'),
  );
};

const importJson = () => {
  if (library.fromJson(jsonDraft.value)) {
    scrubTo(0);
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

// --- shortcuts + lifecycle ------------------------------------------------

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
  library.restore();
  // Client only — the pool's interval would leak into the node process on SSR.
  pool.start();
  characterId.value = props.character ?? window.localStorage.getItem(CHARACTER_KEY) ?? '';
  if (props.clipDocument) {
    void openClipDocument(props.clipDocument);
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
});

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

    <!-- Documents: which character the rig draws, and which clip document the
         timeline is linked to. Both read `.data/jrig/documents/` live. -->
    <header class="bar bar--docs">
      <div class="bar-group">
        <label class="field">Character
          <select v-model="characterId" class="input input--wide">
            <option
              v-for="character in characters"
              :key="character.id"
              :value="character.id"
            >
              {{ character.name }}
            </option>
          </select>
        </label>
      </div>
      <div class="bar-group">
        <label class="field">Open clip
          <select class="input input--wide" :value="docSync.name.value ?? ''" @change="openClipDocument(($event.target as HTMLSelectElement).value)">
            <option value="">
              — pick a document —
            </option>
            <option v-for="name in clipDocumentNames" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </label>
        <button class="btn" @click="saveActiveClip">
          Save → {{ activeClipName }}
        </button>
        <span v-if="docSync.dirty.value" class="chip chip--dirty">unsaved</span>
        <span v-if="activeClipErrors.length" class="chip chip--error">
          {{ activeClipErrors.length }} error{{ activeClipErrors.length > 1 ? 's' : '' }}:
          {{ activeClipErrors[0]!.path }} {{ activeClipErrors[0]!.message }}
        </span>
        <span v-if="pool.errorCount.value" class="chip chip--error">
          {{ pool.errorCount.value }} document error{{ pool.errorCount.value > 1 ? 's' : '' }} in the pool
        </span>
      </div>
    </header>

    <!-- The M3 concurrency story, in the editor's own chrome: you and Claude
         both write these files, and mtime is the only fence. -->
    <div v-if="docSync.conflict.value" class="banner">
      <span v-if="docSync.conflict.value === 'external'">
        <strong>{{ docSync.name.value }}</strong> changed on disk while you had unsaved edits.
      </span>
      <span v-else>
        <strong>{{ docSync.name.value }}</strong> changed underneath your save — nothing was written.
      </span>
      <button class="btn btn--sm" @click="discardMine">
        Reload — discard mine
      </button>
      <button v-if="docSync.conflict.value === 'external'" class="btn btn--sm" @click="docSync.keepMine">
        Keep mine
      </button>
      <button v-else class="btn btn--sm btn--danger" @click="overwriteActiveClip">
        Overwrite anyway
      </button>
    </div>

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
        <!-- `art` is whichever character is picked above. It only changes what
             you are looking at: one skeleton, so a pose authored here plays on
             every other character too. -->
        <AvatarRig
          v-if="art"
          ref="avatarRef"
          class="stage-avatar"
          :art="art"
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
        <p v-if="!art" class="empty">
          No character documents in <code>.data/jrig/documents/</code> — the editor draws
          documents only. The server seeds house + hoodie on first boot.
        </p>
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
.bar--docs { justify-content: flex-start; gap: 10px 28px; }
.empty { max-width: 46ch; margin: 48px auto; color: var(--muted); text-align: center; }

/* Read-only status, unlike the joint chips this borrows its look from. */
.chip--dirty,
.chip--error { cursor: default; }
.chip--dirty { border-color: var(--warn); color: var(--warn); }
.chip--error { max-width: 46ch; overflow: hidden; border-color: #ef4444; color: #fca5a5; text-overflow: ellipsis; white-space: nowrap; }

.banner {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  color: #fde68a;
  background: #2a2113;
  border: 1px solid var(--warn);
  border-radius: 10px;
}

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
.input--wide { min-width: 180px; }

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
