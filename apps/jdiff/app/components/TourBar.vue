<script setup lang="ts">
import type { TourStop } from '~/utils/tour'

// The floating tour bar shared by the PR and branch pages: stays put while
// the reviewer scrolls, comments, and asks; only prev/next/esc move the tour
// along. The stop's path gets its own row so it is never truncated, plus a
// copy button so the reviewer can paste the path into their own session.
const props = defineProps<{
  stop: TourStop
  index: number
  count: number
  mode: 'overview' | 'detail' | 'chains'
}>()

const emit = defineEmits<{
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'end'): void
}>()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyPath() {
  await navigator.clipboard.writeText(props.stop.path)
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="tour-bar">
    <div class="tour-bar-head">
      <span class="tour-step">
        <template v-if="mode === 'detail'">detail </template>
        <template v-else-if="mode === 'chains'">chain </template>{{ index + 1 }}/{{ count }}
      </span>
      <span class="tour-bar-title">{{ stop.title }}</span>
      <button class="tour-x" title="end tour (esc)" @click="emit('end')">×</button>
    </div>
    <div class="tour-bar-loc">
      <span class="tour-bar-path" :title="stop.path">{{ stop.path }}<span class="tour-bar-line">:{{ stop.line }}</span></span>
      <button class="tour-copy" :class="{ done: copied }" title="copy file path" @click="copyPath">
        {{ copied ? 'copied' : 'copy path' }}
      </button>
    </div>
    <div class="tour-bar-note">{{ stop.note }}</div>
    <div class="tour-bar-actions">
      <span class="tour-keys">← → to navigate · esc to end</span>
      <button class="tour-nav" :disabled="index === 0" @click="emit('prev')">← prev</button>
      <button class="tour-nav primary" @click="emit('next')">
        {{ index === count - 1 ? 'finish ✓' : 'next →' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tour-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: min(680px, calc(100vw - 32px));
  z-index: 20;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  padding: 10px 14px;
  font-size: 13px;
}
.tour-bar-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.tour-step {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent);
  flex-shrink: 0;
}
.tour-bar-title { font-weight: 600; min-width: 0; }
.tour-x {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
}
.tour-x:hover { color: var(--red); }
/* The path row: the full path always shows, wrapping at any point rather
   than being cut off, with the copy button pinned to its right. */
.tour-bar-loc {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-top: 4px;
}
.tour-bar-path {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  min-width: 0;
  overflow-wrap: anywhere;
  user-select: all;
}
.tour-bar-line { color: var(--accent); }
.tour-copy {
  margin-left: auto;
  flex-shrink: 0;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
}
.tour-copy:hover { border-color: var(--accent); color: var(--text); }
.tour-copy.done { border-color: var(--green); color: var(--green); }
.tour-bar-note {
  margin-top: 6px;
  color: var(--muted);
  line-height: 1.5;
}
.tour-bar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
.tour-keys {
  margin-right: auto;
  color: var(--muted);
  font-size: 11px;
}
.tour-nav {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  padding: 3px 12px;
  cursor: pointer;
  font-size: 12px;
}
.tour-nav:hover:not(:disabled) { border-color: var(--accent); }
.tour-nav:disabled { opacity: 0.4; cursor: default; }
.tour-nav.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
