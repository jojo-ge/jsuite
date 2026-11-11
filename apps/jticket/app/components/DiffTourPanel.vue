<script setup lang="ts">
// The Diff tab's tour strip: Build tour (one /jdiff-tour session in herdr, no
// focus steal), its progress and failure, Start / Resume / Restart, and the
// tour's overview with a `?stop=` link per stop. The walk itself lives in
// ProjectDiff (useTourWalk); this only shows state and emits.
import type { TourView } from '~/utils/tour'

const props = defineProps<{
  view: TourView | null
  /** Where the reader left off, when they did. */
  resumeIndex: number | null
  touring: boolean
  herdrUp: boolean
  /** A Build/Cancel request in flight. */
  busy: boolean
  /** Why the last Build request failed to dispatch. */
  dispatchError: string
}>()
const emit = defineEmits<{ build: []; cancel: []; start: [index: number]; restart: [] }>()

const route = useRoute()
const { render } = useMarkdown()
const open = ref(false)

const tour = computed(() => props.view?.tour ?? null)
const building = computed(() => !!props.view?.job)
const failure = computed(() => props.dispatchError || props.view?.failure || '')
const overviewHtml = computed(() => (tour.value?.overview.trim() ? render(tour.value.overview) : ''))
const builtAt = computed(() => (props.view?.createdAt ? new Date(props.view.createdAt).toLocaleString() : ''))

const now = ref(Date.now())
if (import.meta.client) {
  const t = setInterval(() => (now.value = Date.now()), 1000)
  onScopeDispose(() => clearInterval(t))
}
const elapsed = computed(() => {
  const s = Math.max(0, Math.round((now.value - (props.view?.job?.startedAt ?? now.value)) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
})

const stopLink = (i: number) => ({ query: { ...route.query, stop: String(i) } })
</script>

<template>
  <div class="rounded-lg border border-default bg-elevated/40 px-3 py-2">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <UIcon name="i-lucide-route" class="size-4 shrink-0 text-primary" />
      <template v-if="tour">
        <span class="font-medium">Guided tour</span>
        <span class="text-xs text-muted">
          {{ tour.stops.length }} stops<template v-if="builtAt"> · {{ builtAt }}</template>
        </span>
        <UButton v-if="!touring" size="xs" icon="i-lucide-play" @click="emit('start', resumeIndex ?? 0)">
          {{ resumeIndex ? `Resume ${resumeIndex + 1}/${tour.stops.length}` : 'Start tour' }}
        </UButton>
        <UButton v-if="resumeIndex && !touring" size="xs" color="neutral" variant="ghost" @click="emit('restart')">Restart</UButton>
        <UButton size="xs" color="neutral" variant="ghost" :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" @click="open = !open">
          Overview
        </UButton>
      </template>
      <span v-else class="text-muted">No guided tour for this diff yet.</span>

      <div class="ml-auto flex items-center gap-2">
        <template v-if="building">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-muted" />
          <span class="text-xs text-muted">Building the tour in herdr… {{ elapsed }}</span>
          <UButton size="xs" color="neutral" variant="outline" :loading="busy" @click="emit('cancel')">Cancel</UButton>
        </template>
        <UTooltip v-else-if="herdrUp" text="One Opus session in a new herdr tab reads the whole change and writes a 20–40-stop walk (background — no focus steal)">
          <UButton size="xs" :color="tour ? 'neutral' : 'primary'" :variant="tour ? 'outline' : 'solid'" icon="i-lucide-sparkles" :loading="busy" @click="emit('build')">
            {{ tour ? 'Rebuild tour' : 'Build tour' }}
          </UButton>
        </UTooltip>
        <span v-else class="text-xs text-dimmed">Start herdr to build a tour</span>
      </div>
    </div>

    <p v-if="failure && !building" class="mt-1.5 flex items-start gap-1.5 text-xs text-error">
      <UIcon name="i-lucide-triangle-alert" class="mt-px size-3.5 shrink-0" /> {{ failure }}
    </p>

    <div v-if="open && tour" class="mt-3 grid gap-4 border-t border-default pt-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div v-if="overviewHtml" class="jx-prose jx-prose-sm" v-html="overviewHtml" />
      <ol class="space-y-0.5 text-xs">
        <li v-for="(s, i) in tour.stops" :key="i">
          <NuxtLink :to="stopLink(i)" replace class="flex gap-2 rounded px-1.5 py-1 hover:bg-elevated">
            <span class="w-5 shrink-0 text-right font-mono text-dimmed">{{ i + 1 }}</span>
            <span class="min-w-0">
              <span class="font-medium">{{ s.title }}</span>
              <span class="block truncate font-mono text-[11px] text-muted">{{ s.path }}:{{ s.line }}</span>
            </span>
          </NuxtLink>
        </li>
      </ol>
    </div>
  </div>
</template>
