<script setup lang="ts">
// A project's Diff tab — jDiff's side-by-side viewer, inside jTicket. It shows
// one *target* (app/utils/diffTarget.ts), named in the page's query so every
// "see the changes" link lands on it: the project's own branch by default (a
// standard project's integration branch vs the default branch; a PR review
// project's PR head vs its base), a local PR (?pr=PR-n), a GitHub PR (?gh=n)
// or any two refs (?head=…&base=…).
//
// The server builds and highlights the rows (GET /api/projects/:id/diff);
// this lays them out with a file list. Client-only: the rows are large, and
// nothing here is worth server-rendering.
//
// A target can carry a guided tour (GET /api/projects/:id/diff/tour): Build
// tour dispatches one /jdiff-tour session, and the tour is walked here with
// the floating tour bar (useTourWalk — keys, resume, `?stop=` links).
import type { Project } from '~/composables/useTracker'
import type { DiffFile } from '~/utils/diffRows'
import type { TourStop, TourView } from '~/utils/tour'
import { diffTargetParams, localPrRefs, parseDiffTarget, sameDiffTarget, type DiffTargetQuery } from '~/utils/diffTarget'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ configure: [] }>()

interface DiffResponse {
  target: { kind: 'project' | 'pr' | 'gh' | 'refs'; label: string; head: string; base: string; headOid: string; baseOid: string }
  files: DiffFile[]
}

const route = useRoute()
const router = useRouter()
const { prs } = useTracker()

const target = computed<DiffTargetQuery>(() => parseDiffTarget(route.query as Record<string, unknown>))

function selectTarget(t: DiffTargetQuery) {
  const { pr: _pr, gh: _gh, head: _head, base: _base, ...rest } = route.query
  router.replace({ query: { ...rest, tab: 'diff', ...diffTargetParams(t) } })
}

// The picker: the project's own branch, then its local PRs newest first, plus
// whatever a link opened (a GitHub PR, a bare branch) when it isn't one of those.
interface TargetOption { label: string; value: string; target: DiffTargetQuery; icon: string }
const ownLabel = computed(() =>
  props.project.mode === 'prreview' && props.project.prReview
    ? `PR #${props.project.prReview.pr.number} — ${props.project.integrationBranch || 'its head'} vs ${props.project.prReview.pr.baseRefName}`
    : props.project.integrationBranch
      ? `${props.project.integrationBranch} vs the default branch`
      : 'Integration branch (not set)',
)
const options = computed<TargetOption[]>(() => {
  const out: TargetOption[] = [{ label: ownLabel.value, value: 'own', target: {}, icon: 'i-lucide-git-branch' }]
  const projectPrs = prs.value
    .filter((pr) => pr.projectId === props.project.id && pr.status !== 'closed' && localPrRefs(pr))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  for (const pr of projectPrs) {
    out.push({
      label: `${pr.key} · ${pr.title}${pr.status === 'merged' ? ' (merged)' : ''}`,
      value: `pr:${pr.key}`,
      target: { pr: pr.key },
      icon: pr.status === 'merged' ? 'i-lucide-git-merge' : 'i-lucide-git-pull-request',
    })
  }
  const t = target.value
  if (!out.some((o) => sameDiffTarget(o.target, t))) {
    out.push({
      label: t.gh ? `GitHub PR #${t.gh}` : t.pr ? t.pr : `${t.head}${t.base ? ` vs ${t.base}` : ''}`,
      value: 'custom',
      target: t,
      icon: t.gh ? 'i-simple-icons-github' : 'i-lucide-git-compare',
    })
  }
  return out
})
const selected = computed({
  get: () => options.value.find((o) => sameDiffTarget(o.target, target.value))?.value ?? 'own',
  set: (v: string) => {
    const o = options.value.find((x) => x.value === v)
    if (o) selectTarget(o.target)
  },
})

const query = computed(() => diffTargetParams(target.value))
const { data, pending, error, refresh } = useFetch<DiffResponse>(
  () => `/api/projects/${props.project.id}/diff`,
  { query, server: false, lazy: true, watch: [query] },
)
const errMessage = (e: any) => String(e?.data?.statusMessage ?? e?.data?.message ?? e?.statusMessage ?? e?.message ?? e)
const errorText = computed(() => (error.value ? errMessage(error.value) : ''))

const files = computed(() => data.value?.files ?? [])
const totals = computed(() => files.value.reduce(
  (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
  { additions: 0, deletions: 0 },
))

// ── File list ──
const filter = ref('')
const listed = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return files.value
    .map((f, i) => ({ file: f, index: i }))
    .filter(({ file }) => !q || file.path.toLowerCase().includes(q))
})
const anchorFor = (i: number) => `diff-file-${i}`
function jumpTo(i: number) {
  document.getElementById(anchorFor(i))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function splitPath(path: string) {
  const at = path.lastIndexOf('/')
  return at < 0 ? { dir: '', name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) }
}
const STATUS_ICON = {
  added: 'i-lucide-file-plus',
  deleted: 'i-lucide-file-minus',
  renamed: 'i-lucide-file-symlink',
  modified: 'i-lucide-file-diff',
} as const
const shortOid = (oid: string) => oid.slice(0, 8)

// ── Guided tour ──
const { available: herdrUp } = useHerdr()
const tourUrl = computed(() => `/api/projects/${props.project.id}/diff/tour`)
const { data: tourView, refresh: refreshTour } = useFetch<TourView>(tourUrl, { query, server: false, lazy: true, watch: [query] })
const tourBusy = ref(false)
const tourDispatchError = ref('')
watch(query, () => (tourDispatchError.value = ''))

// While a build runs, poll until its tour (or its failure) lands.
let tourPoll: ReturnType<typeof setInterval> | null = null
watch(() => !!tourView.value?.job, (building) => {
  if (tourPoll) clearInterval(tourPoll)
  tourPoll = building ? setInterval(() => refreshTour(), 4_000) : null
}, { immediate: true })
onBeforeUnmount(() => tourPoll && clearInterval(tourPoll))

async function buildTour() {
  tourBusy.value = true
  tourDispatchError.value = ''
  try {
    await $fetch(tourUrl.value, { method: 'POST', body: query.value })
  } catch (e) {
    tourDispatchError.value = errMessage(e)
  } finally {
    tourBusy.value = false
    await refreshTour()
  }
}

async function cancelTour() {
  tourBusy.value = true
  try {
    await $fetch(tourUrl.value, { method: 'DELETE', query: query.value })
  } catch { /* the run may have just finished */ } finally {
    tourBusy.value = false
    await refreshTour()
  }
}

const fileRefs = new Map<string, { revealLine: (side: TourStop['side'], line: number) => Promise<HTMLElement | null> }>()
function setFileRef(path: string, el: unknown) {
  if (el) fileRefs.set(path, el as any)
  else fileRefs.delete(path)
}
const toast = useToast()
async function revealStop(stop: TourStop): Promise<HTMLElement | null> {
  const file = fileRefs.get(stop.path)
  if (!file) {
    toast.add({ title: 'Not in this diff', description: `${stop.path} has no changes in this target.`, color: 'warning', icon: 'i-lucide-file-question' })
    return null
  }
  return file.revealLine(stop.side, stop.line)
}

const tour = computed(() => tourView.value?.tour ?? null)
const { tourIndex, currentStop, resumeIndex, jumpToStop, nextStop, prevStop, endTour, clearProgress } = useTourWalk({
  repo: computed(() => props.project.repo),
  tourKey: computed(() => tourView.value?.key ?? ''),
  tour,
  tourAt: computed(() => tourView.value?.createdAt ?? ''),
  reveal: revealStop,
  ready: computed(() => !!data.value?.files.length),
})
function restartTour() {
  clearProgress()
  jumpToStop(0)
}
</script>

<template>
  <section class="space-y-4">
    <UAlert
      v-if="!project.repo"
      color="neutral"
      variant="subtle"
      icon="i-lucide-folder-git-2"
      title="No repo yet"
      description="Point the project at a local clone to see its diffs."
      :actions="[{ label: 'Connect a repo', onClick: () => emit('configure') }]"
    />

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <USelectMenu
          v-model="selected"
          :items="options"
          value-key="value"
          :search-input="options.length > 8 ? { placeholder: 'Find a PR…' } : false"
          class="w-full max-w-xl"
          aria-label="What to diff"
        />
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" :loading="pending" aria-label="Reload the diff" @click="refresh()" />
        <div v-if="data" class="ml-auto flex items-center gap-3 font-mono text-xs text-muted">
          <span :title="`${data.target.head} @ ${data.target.headOid}`">{{ data.target.head }} <span class="text-dimmed">{{ shortOid(data.target.headOid) }}</span></span>
          <UIcon name="i-lucide-arrow-left" class="size-3" />
          <span :title="`${data.target.base} @ ${data.target.baseOid}`">{{ data.target.base }} <span class="text-dimmed">{{ shortOid(data.target.baseOid) }}</span></span>
        </div>
      </div>

      <ClientOnly>
        <DiffTourPanel
          v-if="data && files.length && tourView"
          class="mb-4"
          :view="tourView"
          :resume-index="resumeIndex"
          :touring="tourIndex != null"
          :herdr-up="herdrUp"
          :busy="tourBusy"
          :dispatch-error="tourDispatchError"
          @build="buildTour"
          @cancel="cancelTour"
          @start="jumpToStop"
          @restart="restartTour"
        />
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" title="Could not build the diff" :description="errorText" />
        <div v-else-if="pending && !data" class="flex items-center gap-2 py-12 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Building the diff…
        </div>
        <div v-else-if="data && !files.length" class="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted">
          <UIcon name="i-lucide-git-compare" class="size-8" />
          <p><span class="font-mono">{{ data.target.head }}</span> has no changes against <span class="font-mono">{{ data.target.base }}</span>.</p>
        </div>
        <div v-else-if="data" class="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]" :class="{ 'pb-64': currentStop }">
          <!-- File list -->
          <aside class="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
            <p class="mb-2 text-xs text-muted">
              {{ files.length }} file{{ files.length === 1 ? '' : 's' }} ·
              <span class="text-success">+{{ totals.additions }}</span>
              <span class="text-error">−{{ totals.deletions }}</span>
            </p>
            <UInput v-if="files.length > 6" v-model="filter" size="xs" icon="i-lucide-search" placeholder="Filter files" class="mb-2 w-full" />
            <ul class="space-y-px">
              <li v-for="{ file, index } in listed" :key="file.path">
                <button
                  type="button"
                  class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-elevated"
                  :title="file.oldPath ? `${file.oldPath} → ${file.path}` : file.path"
                  @click="jumpTo(index)"
                >
                  <UIcon
                    :name="STATUS_ICON[file.status]"
                    class="size-3.5 shrink-0"
                    :class="file.status === 'added' ? 'text-success' : file.status === 'deleted' ? 'text-error' : 'text-muted'"
                  />
                  <span class="min-w-0 flex-1 truncate font-mono">
                    {{ splitPath(file.path).name }}<span v-if="splitPath(file.path).dir" class="ml-1.5 text-[11px] text-dimmed">{{ splitPath(file.path).dir }}</span>
                  </span>
                  <span class="shrink-0 font-mono text-[11px]">
                    <span class="text-success">+{{ file.additions }}</span>
                    <span class="ml-1 text-error">−{{ file.deletions }}</span>
                  </span>
                </button>
              </li>
            </ul>
          </aside>

          <!-- The files -->
          <div class="min-w-0 space-y-4">
            <DiffFileView
              v-for="(file, i) in files"
              :key="`${data.target.headOid}:${file.path}`"
              :ref="(el) => setFileRef(file.path, el)"
              :file="file"
              :anchor="anchorFor(i)"
              :project-id="project.id"
              :head-oid="data.target.headOid"
              :tour-stop="currentStop?.path === file.path ? currentStop : null"
            />
          </div>
        </div>
        <DiffTourBar
          v-if="currentStop && tour && tourIndex != null"
          :stop="currentStop"
          :index="tourIndex"
          :count="tour.stops.length"
          :variant="tourView?.variant ?? 'detail'"
          @prev="prevStop"
          @next="nextStop"
          @end="endTour"
        />
      </ClientOnly>
    </template>
  </section>
</template>
