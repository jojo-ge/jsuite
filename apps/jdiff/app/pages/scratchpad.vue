<script setup lang="ts">
type Tab = 'final' | 'cockpit' | 'rail' | 'brief' | 'margin' | 'checklist'

useHead({ title: 'scratchpad' })

// ?v=<tab> and ?guidance=off make variants linkable.
const route = useRoute()
const initial = String(route.query.v ?? '')
const tab = ref<Tab>(
  initial === 'cockpit' || initial === 'rail' || initial === 'brief' || initial === 'margin' || initial === 'checklist'
    ? initial
    : 'final',
)
const guidance = ref(route.query.guidance !== 'off')

const tabs: { id: Tab; label: string; thesis: string }[] = [
  {
    id: 'final',
    label: 'final',
    thesis: 'the converged design — briefing entry, checklist-first sidebar with the production nav modes, full comment + ask features, tour from the top.',
  },
  {
    id: 'cockpit',
    label: 'cockpit',
    thesis: 'guidance is opt-in instrumentation — one sticky strip, the diff owns the viewport from first paint.',
  },
  {
    id: 'rail',
    label: 'guide rail',
    thesis: 'the senior engineer stands beside you — a persistent rail tracks where you are and what to read next.',
  },
  {
    id: 'brief',
    label: 'briefing',
    thesis: 'read the memo — tour, risks, and answerable questions up top, the full diff right below.',
  },
  {
    id: 'margin',
    label: 'marginalia',
    thesis: 'the guide writes in the margins — notes and risks pinned to the files they concern, tour floats over the page.',
  },
  {
    id: 'checklist',
    label: 'checklist',
    thesis: 'review as a work-through list — stops, risks, and questions checked off until the change is covered.',
  },
]

const thesis = computed(() => tabs.find((t) => t.id === tab.value)!.thesis)
</script>

<template>
  <main class="diff-surface scratchpad">
    <header class="bar">
      <NuxtLink to="/" class="brand">jDiff</NuxtLink>
      <span class="page-name">scratchpad</span>
      <span class="sub">pr page variations · mock data</span>
      <button class="toggle" :class="{ on: guidance }" @click="guidance = !guidance">
        ai guidance · {{ guidance ? 'on' : 'off' }}
      </button>
    </header>

    <div class="switcher">
      <div class="modes" role="tablist" aria-label="pr page variations">
        <button
          v-for="t in tabs"
          :key="t.id"
          role="tab"
          :aria-selected="tab === t.id"
          class="mode"
          :class="{ on: tab === t.id }"
          @click="tab = t.id"
        >{{ t.label }}</button>
      </div>
      <p class="thesis">{{ thesis }}</p>
    </div>

    <ScratchVariantFinal v-show="tab === 'final'" :guidance="guidance" :active="tab === 'final'" />
    <ScratchVariantCockpit v-show="tab === 'cockpit'" :guidance="guidance" />
    <ScratchVariantGuideRail v-show="tab === 'rail'" :guidance="guidance" :active="tab === 'rail'" />
    <ScratchVariantBriefing v-show="tab === 'brief'" :guidance="guidance" :active="tab === 'brief'" />
    <ScratchVariantMarginalia v-show="tab === 'margin'" :guidance="guidance" :active="tab === 'margin'" />
    <ScratchVariantChecklist v-show="tab === 'checklist'" :guidance="guidance" />
  </main>
</template>

<style scoped>
.scratchpad {
  max-width: 1800px;
  margin: 0 auto;
  padding: 16px 24px 60px;
}
.bar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}
.brand {
  font-family: var(--mono);
  font-weight: 700;
  color: var(--text);
}
.page-name {
  font-family: var(--mono);
  color: var(--muted);
}
.sub { color: var(--muted); font-size: 12px; }
.toggle {
  margin-left: auto;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}
.toggle:hover { color: var(--text); }
.toggle.on { color: var(--text); border-color: var(--accent); }

.switcher {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 4px;
}
.modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
}
.mode {
  border: none;
  background: transparent;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  padding: 4px 14px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.mode:hover { color: var(--text); }
.mode.on {
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--border);
}
.thesis {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .switcher { flex-direction: column; gap: 6px; align-items: flex-start; }
  .thesis { white-space: normal; }
}
</style>
