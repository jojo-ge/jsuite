<script setup lang="ts">
// The project page's Review tab: jReview runs that belong to this project.
//
// "Start review" asks jReview (through /api/projects/:id/reviews) for a
// multi-reviewer review of a branch — the integration branch by default. The
// reviewers and the triager run in herdr; this tab follows them by polling
// while they work, then lists the merged findings. Ticking findings and
// pressing "Add to <KEY>" files each as an AFK bug ticket in THIS project;
// jReview remembers which finding became which ticket, so the rest can be
// added later and nothing is added twice. The auto loop's consensus reviews
// show here too, read-only — their tickets were filed by the loop.
//
// Reports (triage + each reviewer's) are jExplain documents in the shared
// pool, which jTicket serves too — they open inline.
import type { Project } from '~/composables/useTracker'
import type { Explainer } from '@jsuite/documents/types'
import type { JreviewRun, JreviewMeta, JreviewStatus } from '~/utils/jreview'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ configure: [] }>()

const toast = useToast()
const route = useRoute()
const router = useRouter()
const { tickets } = useTracker()
const { available: herdrUp } = useHerdr()
const errorText = branchErrorText
const JREVIEW = 'https://jreview.local'

const active = (s: JreviewStatus) => s === 'reviewing' || s === 'triaging'

// ── The list ──
const { data: listData, pending: listPending, refresh: refreshList } = useFetch<{
  available: boolean
  reviews: JreviewMeta[]
  error?: string
}>(() => `/api/projects/${props.project.id}/reviews`, { lazy: true, server: false })
const reviews = computed(() => listData.value?.reviews ?? [])

// The open review rides in ?review= (jReview opens the tab there when triage
// lands); without one, the newest.
const selectedKey = computed(() => String(route.query.review ?? '') || reviews.value[0]?.key || '')
function select(key: string) {
  router.replace({ query: { ...route.query, review: key } })
}

const { data: review, error: reviewError, refresh: refreshReview } = useFetch<JreviewRun>(
  () => `/api/projects/${props.project.id}/reviews/${selectedKey.value}`,
  { lazy: true, server: false, immediate: false, watch: false },
)
watch(selectedKey, (key) => { if (key) refreshReview() }, { immediate: true })

// Poll while anything is in flight — jReview's watcher moves reviews along
// server-side; this just catches up.
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll = setInterval(() => {
    if (reviews.value.some((r) => active(r.status))) refreshList()
    if (review.value && active(review.value.status)) refreshReview()
  }, 4_000)
})
onUnmounted(() => { if (poll) clearInterval(poll) })

const now = ref(new Date())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { now.value = new Date() }, 60_000) })
onUnmounted(() => { if (clock) clearInterval(clock) })

// ── Starting a review ──
interface BranchCandidate { name: string; subject: string; local: boolean; remote: boolean; isDefault: boolean }
const { data: branchData } = useFetch<{ branches: BranchCandidate[] }>(
  () => `/api/projects/${props.project.id}/branches`,
  { lazy: true, server: false, immediate: !!props.project.repo.trim() },
)
// jReview names a branch that's only on origin 'origin/<name>'.
const branchItems = computed(() =>
  (branchData.value?.branches ?? [])
    .filter((b) => !b.isDefault)
    .map((b) => ({
      label: b.local ? b.name : `origin/${b.name}`,
      value: b.local ? b.name : `origin/${b.name}`,
      description: b.subject,
    })),
)
const newBranch = ref(props.project.integrationBranch.trim())
watch(() => props.project.integrationBranch, (b) => { if (!newBranch.value) newBranch.value = b.trim() })
const newBase = ref('')
const newReviewers = ref(4)
const REVIEWER_ITEMS = [1, 2, 3, 4].map((n) => ({ label: `${n} reviewer${n === 1 ? '' : 's'}`, value: n }))

const starting = ref(false)
async function startReview() {
  starting.value = true
  try {
    const res = await $fetch<{ key: string }>(`/api/projects/${props.project.id}/reviews`, {
      method: 'POST',
      body: { branch: newBranch.value || undefined, base: newBase.value.trim() || undefined, reviewers: newReviewers.value },
    })
    toast.add({
      title: 'Review started',
      description: `${newReviewers.value} reviewer${newReviewers.value === 1 ? '' : 's'} going into herdr — findings land here.`,
      color: 'success',
      icon: 'i-lucide-scan-search',
    })
    await refreshList()
    select(res.key)
  } catch (err: any) {
    toast.add({ title: 'Could not start the review', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    starting.value = false
  }
}

// ── Recovery: retry / skip a reviewer, retry the triager ──
const busy = ref('')
async function act(action: 'retry-reviewer' | 'skip-reviewer' | 'retry-triage', n?: number) {
  if (action === 'skip-reviewer' && !window.confirm(`Skip reviewer ${n}? Triage goes ahead without its report.`)) return
  busy.value = `${action}:${n ?? ''}`
  try {
    review.value = await $fetch<JreviewRun>(`/api/projects/${props.project.id}/reviews/${selectedKey.value}/action`, {
      method: 'POST',
      body: { action, n },
    })
    refreshList()
  } catch (err: any) {
    toast.add({ title: 'jReview refused', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    busy.value = ''
  }
}

// ── Findings → tickets ──
// Every open finding starts ticked; untick what you don't want.
const deselected = ref(new Set<string>())
watch(selectedKey, () => { deselected.value = new Set() })
const canAdd = computed(() => !!review.value && !review.value.consensus && (review.value.status === 'triaged' || review.value.status === 'ticketed'))
const openFindings = computed(() => (review.value?.findings ?? []).filter((f) => !f.ticketKey))
const picked = computed(() => openFindings.value.filter((f) => !deselected.value.has(f.id)))
function setPicked(id: string, on: boolean) {
  const next = new Set(deselected.value)
  if (on) next.delete(id)
  else next.add(id)
  deselected.value = next
}
const allPicked = computed({
  get: () => (picked.value.length === openFindings.value.length ? true : picked.value.length ? 'indeterminate' : false),
  set: (on) => { deselected.value = on ? new Set() : new Set(openFindings.value.map((f) => f.id)) },
})
const ticketByKey = computed(() => new Map(tickets.value.map((t) => [t.key, t])))

const adding = ref(false)
async function addTickets() {
  const ids = picked.value.map((f) => f.id)
  if (!ids.length) return
  adding.value = true
  try {
    const res = await $fetch<{ added: string[] }>(`/api/projects/${props.project.id}/reviews/${selectedKey.value}/tickets`, {
      method: 'POST',
      body: { findingIds: ids },
    })
    toast.add({
      title: `Added ${res.added.length} ticket${res.added.length === 1 ? '' : 's'} to ${props.project.key}`,
      description: res.added.join(', '),
      color: 'success',
      icon: 'i-lucide-ticket-plus',
    })
  } catch (err: any) {
    toast.add({ title: 'Could not add the tickets', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    adding.value = false
    await Promise.all([refreshReview(), refreshList()])
  }
}

// ── Reports, opened inline ──
const reportOpen = ref(false)
const reportTitle = ref('')
const reportDoc = ref<Explainer | null>(null)
const reportLoading = ref(false)
async function openReport(title: string, docKey: string) {
  reportTitle.value = title
  reportDoc.value = null
  reportOpen.value = true
  reportLoading.value = true
  try {
    reportDoc.value = await $fetch<Explainer>(`/api/documents/${docKey}`)
  } catch {
    reportDoc.value = null
  } finally {
    reportLoading.value = false
  }
}

// ── Presentation ──
const STATUS_BADGE: Record<JreviewStatus, { label: string; color: 'primary' | 'warning' | 'success' | 'info' }> = {
  reviewing: { label: 'reviewing', color: 'primary' },
  triaging: { label: 'triaging', color: 'info' },
  triaged: { label: 'findings in', color: 'warning' },
  ticketed: { label: 'ticketed', color: 'success' },
}
const REVIEWER_BADGE = {
  queued: { icon: 'i-lucide-circle-dashed', class: 'text-muted', label: 'queued' },
  running: { icon: 'i-lucide-loader-circle', class: 'animate-spin text-primary', label: 'reviewing' },
  done: { icon: 'i-lucide-circle-check', class: 'text-success', label: 'reported' },
  failed: { icon: 'i-lucide-circle-alert', class: 'text-error', label: 'dispatch failed' },
  skipped: { icon: 'i-lucide-circle-slash', class: 'text-muted', label: 'skipped' },
} as const
function listLine(r: JreviewMeta): string {
  if (r.status === 'reviewing') return `${r.reviewersDone}/${r.reviewerCount} reported`
  if (r.status === 'triaging') return r.consensus ? 'matching reports' : 'merging findings'
  if (r.consensus) return `loop ${r.loop ?? '?'} consensus`
  const left = r.findingCount - r.ticketedCount
  return `${r.findingCount} finding${r.findingCount === 1 ? '' : 's'}${left && r.ticketedCount ? ` · ${left} not added` : ''}`
}
const severityCounts = computed(() => {
  const out: Record<string, number> = {}
  for (const f of review.value?.findings ?? []) out[f.severity] = (out[f.severity] ?? 0) + 1
  return (['critical', 'high', 'medium', 'low'] as const).filter((s) => out[s]).map((s) => `${out[s]} ${s}`).join(' · ')
})
</script>

<template>
  <section class="space-y-4">
    <!-- No repo -->
    <div
      v-if="!project.repo.trim()"
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-10 text-center"
    >
      <UIcon name="i-lucide-scan-search" class="size-7 text-muted" />
      <div>
        <p class="text-sm">This project isn't wired to a repo.</p>
        <p class="text-xs text-muted">Point it at a local clone to review its branches with jReview.</p>
      </div>
      <UButton icon="i-lucide-link" size="sm" variant="soft" @click="emit('configure')">Connect a repo</UButton>
    </div>

    <template v-else>
      <!-- Start a review -->
      <div class="rounded-lg border border-default px-3 py-3">
        <div class="flex flex-wrap items-end gap-2">
          <UFormField label="Branch" class="min-w-64 flex-1">
            <USelectMenu
              v-model="newBranch"
              :items="branchItems"
              value-key="value"
              icon="i-lucide-git-branch"
              placeholder="Pick a branch to review"
              :search-input="{ placeholder: 'Search branches…' }"
              class="w-full font-mono"
            />
          </UFormField>
          <UFormField label="Against" hint="optional" class="w-56">
            <UInput v-model="newBase" class="w-full font-mono" placeholder="PR base, else default" />
          </UFormField>
          <UFormField label="Reviewers" class="w-36">
            <USelect v-model="newReviewers" :items="REVIEWER_ITEMS" value-key="value" class="w-full" />
          </UFormField>
          <UButton
            icon="i-lucide-scan-search"
            :loading="starting"
            :disabled="!newBranch || listData?.available === false"
            @click="startReview"
          >
            Start review
          </UButton>
        </div>
        <p class="mt-2 text-xs text-muted">
          jReview runs each reviewer as an Opus session in herdr over
          <span class="font-mono">base...branch</span>, then a triager merges their findings. You pick which become
          {{ project.key }} tickets.
          <span v-if="!herdrUp" class="text-warning">herdr isn't running — start it first, or the reviewers can't be dispatched.</span>
        </p>
      </div>

      <UAlert
        v-if="listData?.available === false"
        color="warning"
        variant="subtle"
        icon="i-lucide-cloud-off"
        title="jReview isn't reachable"
        :description="listData.error"
      />

      <div v-else-if="listPending && !listData" class="py-8 text-center text-sm text-muted">Loading reviews…</div>

      <p v-else-if="!reviews.length" class="rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted">
        No reviews for {{ project.key }} yet.
      </p>

      <div v-else class="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <!-- Reviews, newest first -->
        <nav class="flex flex-col gap-1 self-start">
          <button
            v-for="r in reviews"
            :key="r.key"
            type="button"
            class="rounded-md border px-3 py-2 text-left text-sm"
            :class="r.key === selectedKey ? 'border-primary/60 bg-primary/5' : 'border-default hover:bg-elevated/40'"
            @click="select(r.key)"
          >
            <div class="flex items-center gap-2">
              <UIcon
                v-if="active(r.status)"
                name="i-lucide-loader-circle"
                class="size-3.5 shrink-0 animate-spin text-primary"
              />
              <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ r.branch }}</span>
              <UBadge :color="STATUS_BADGE[r.status].color" variant="subtle" size="sm">{{ STATUS_BADGE[r.status].label }}</UBadge>
            </div>
            <p class="mt-0.5 flex gap-2 text-xs text-muted">
              <span class="truncate">{{ listLine(r) }}</span>
              <span class="ml-auto shrink-0">{{ agoLabel(r.createdAt, now) }}</span>
            </p>
          </button>
        </nav>

        <!-- The open review -->
        <div class="min-w-0">
          <UAlert
            v-if="reviewError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Couldn't load the review"
            :description="errorText(reviewError)"
          />
          <div v-else-if="!review || review.key !== selectedKey" class="py-8 text-center text-sm text-muted">Loading…</div>

          <div v-else class="space-y-3">
            <!-- Header -->
            <div class="flex flex-wrap items-start gap-2">
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ review.title }}</span>
                  <UBadge :color="STATUS_BADGE[review.status].color" variant="subtle" size="sm">{{ STATUS_BADGE[review.status].label }}</UBadge>
                  <UBadge v-if="review.consensus" color="neutral" variant="outline" size="sm" icon="i-lucide-repeat">
                    auto loop {{ review.consensus.loop ?? '' }}
                  </UBadge>
                </p>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span class="font-mono">{{ review.base.length === 40 ? review.base.slice(0, 10) : review.base }}...{{ review.branch }}</span>
                  <template v-if="review.pr"> · <a :href="review.pr.url" target="_blank" class="hover:underline">PR #{{ review.pr.number }}</a></template>
                  <template v-if="review.worktree"> · in a worktree</template>
                  · {{ agoLabel(review.createdAt, now) }}
                </p>
              </div>
              <UButton
                :to="`${JREVIEW}/r/${review.key}`"
                target="_blank"
                external
                icon="i-lucide-external-link"
                size="xs"
                color="neutral"
                variant="ghost"
              >
                jReview
              </UButton>
            </div>

            <!-- Pipeline: reviewers → triage -->
            <div class="rounded-lg border border-default">
              <div
                v-for="r in review.reviewers"
                :key="r.n"
                class="flex items-center gap-2 border-b border-default/60 px-3 py-1.5 text-sm"
              >
                <UIcon :name="REVIEWER_BADGE[r.status].icon" class="size-4 shrink-0" :class="REVIEWER_BADGE[r.status].class" />
                <button
                  type="button"
                  class="font-medium"
                  :class="r.status === 'done' ? 'hover:underline' : 'cursor-default'"
                  :disabled="r.status !== 'done'"
                  @click="openReport(`Reviewer ${r.n}`, r.docKey)"
                >
                  Reviewer {{ r.n }}
                </button>
                <span class="text-xs text-muted">{{ REVIEWER_BADGE[r.status].label }}</span>
                <span v-if="r.agent && r.status === 'running'" class="truncate font-mono text-xs text-dimmed">herdr · {{ r.agent }}</span>
                <span v-if="r.error" class="truncate text-xs text-error">{{ r.error }}</span>
                <div v-if="review.status === 'reviewing' && r.status !== 'done' && r.status !== 'skipped'" class="ml-auto flex shrink-0 gap-0.5">
                  <UTooltip text="Start a fresh session for this reviewer">
                    <UButton
                      icon="i-lucide-rotate-ccw"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :loading="busy === `retry-reviewer:${r.n}`"
                      :aria-label="`Re-dispatch reviewer ${r.n}`"
                      @click="act('retry-reviewer', r.n)"
                    />
                  </UTooltip>
                  <UTooltip v-if="!review.consensus" text="Skip — triage goes ahead without it">
                    <UButton
                      icon="i-lucide-skip-forward"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :loading="busy === `skip-reviewer:${r.n}`"
                      :aria-label="`Skip reviewer ${r.n}`"
                      @click="act('skip-reviewer', r.n)"
                    />
                  </UTooltip>
                </div>
                <UButton
                  v-else-if="r.status === 'done'"
                  icon="i-lucide-file-text"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="ml-auto"
                  @click="openReport(`Reviewer ${r.n}`, r.docKey)"
                >
                  Report
                </UButton>
              </div>
              <div class="flex items-center gap-2 px-3 py-1.5 text-sm">
                <UIcon
                  :name="review.triage.status === 'done' ? 'i-lucide-circle-check' : review.triage.status === 'failed' ? 'i-lucide-circle-alert' : review.status === 'triaging' ? 'i-lucide-loader-circle' : 'i-lucide-circle-dashed'"
                  class="size-4 shrink-0"
                  :class="review.triage.status === 'done' ? 'text-success' : review.triage.status === 'failed' ? 'text-error' : review.status === 'triaging' ? 'animate-spin text-primary' : 'text-muted'"
                />
                <span class="font-medium">{{ review.consensus ? 'Consensus' : 'Triage' }}</span>
                <span class="truncate text-xs text-muted">
                  <template v-if="review.triage.status === 'failed'"><span class="text-error">{{ review.triage.error }}</span></template>
                  <template v-else-if="review.status === 'reviewing'">starts when every reviewer has reported</template>
                  <template v-else-if="review.status === 'triaging'">
                    {{ review.consensus ? 'keeping what every reviewer raised' : 'merging duplicate findings' }}<template v-if="review.triage.agent"> · herdr · <span class="font-mono">{{ review.triage.agent }}</span></template>
                  </template>
                  <template v-else-if="review.consensus">{{ review.consensus.kept ?? review.tickets?.ticketKeys.length ?? 0 }} agreed<template v-if="review.consensus.considered !== undefined"> of {{ review.consensus.considered }}</template></template>
                  <template v-else>{{ review.findings.length }} distinct finding{{ review.findings.length === 1 ? '' : 's' }}<template v-if="severityCounts"> · {{ severityCounts }}</template></template>
                </span>
                <UButton
                  v-if="review.status === 'triaging'"
                  icon="i-lucide-rotate-ccw"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="ml-auto"
                  :loading="busy === 'retry-triage:'"
                  @click="act('retry-triage')"
                >
                  {{ review.triage.status === 'failed' ? 'Retry' : 'Restart' }}
                </UButton>
                <UButton
                  v-else-if="!review.consensus && review.triage.status === 'done'"
                  icon="i-lucide-file-text"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="ml-auto"
                  @click="openReport('Triage report', review.triage.docKey)"
                >
                  Report
                </UButton>
              </div>
            </div>

            <!-- A consensus review: the tickets the loop filed -->
            <div v-if="review.consensus && review.tickets?.ticketKeys.length" class="flex flex-wrap gap-1.5">
              <NuxtLink
                v-for="k in review.tickets.ticketKeys"
                :key="k"
                :to="`/tickets/${k}`"
                class="flex items-center gap-1.5 rounded-full border border-default px-2.5 py-0.5 text-xs hover:bg-elevated/60"
              >
                <span class="font-mono">{{ k }}</span>
                <UBadge
                  v-if="ticketByKey.get(k)"
                  :color="STATUS_META[ticketByKey.get(k)!.status].color"
                  variant="subtle"
                  size="sm"
                >
                  {{ STATUS_META[ticketByKey.get(k)!.status].label }}
                </UBadge>
              </NuxtLink>
            </div>

            <!-- Findings -->
            <template v-if="!review.consensus">
              <div v-if="!review.findings.length" class="rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted">
                <template v-if="review.status === 'reviewing'">
                  Reviewing — the merged findings land here once every reviewer has reported.
                </template>
                <template v-else-if="review.status === 'triaging'">Triaging — the merged findings land here.</template>
                <template v-else>The reviewers found nothing worth a ticket.</template>
              </div>

              <template v-else>
                <div class="flex flex-wrap items-center gap-2">
                  <UCheckbox
                    v-if="canAdd && openFindings.length"
                    v-model="allPicked"
                    aria-label="Pick every finding"
                  />
                  <span class="text-sm font-semibold">Findings</span>
                  <span class="text-xs text-muted">
                    {{ review.findings.length }}<template v-if="review.findings.length - openFindings.length">
                      · {{ review.findings.length - openFindings.length }} added to {{ review.tickets?.projectKey ?? project.key }}</template>
                  </span>
                  <UButton
                    v-if="canAdd && openFindings.length"
                    icon="i-lucide-ticket-plus"
                    size="sm"
                    class="ml-auto"
                    :disabled="!picked.length"
                    :loading="adding"
                    @click="addTickets"
                  >
                    Add {{ picked.length }} to {{ project.key }}
                  </UButton>
                  <span v-else-if="canAdd" class="ml-auto flex items-center gap-1 text-xs text-success">
                    <UIcon name="i-lucide-check" class="size-3.5" /> every finding is a ticket
                  </span>
                </div>
                <div class="space-y-1.5">
                  <ReviewFindingCard
                    v-for="f in review.findings"
                    :key="f.id"
                    :finding="f"
                    :selectable="canAdd && !f.ticketKey"
                    :selected="!deselected.has(f.id)"
                    :ticket="f.ticketKey ? ticketByKey.get(f.ticketKey) : null"
                    @update:selected="setPicked(f.id, $event)"
                  />
                </div>
              </template>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- A reviewer's or the triager's report — a jExplain document in the shared pool -->
    <UModal v-model:open="reportOpen" :title="reportTitle" :ui="{ content: 'sm:max-w-4xl' }">
      <template #body>
        <div class="max-h-[70vh] overflow-y-auto">
          <div v-if="reportLoading" class="py-16 text-center text-sm text-muted">Loading…</div>
          <DocumentArticle v-else-if="reportDoc" :doc="reportDoc" />
          <p v-else class="py-16 text-center text-sm text-muted">This report isn't in the document pool.</p>
        </div>
      </template>
    </UModal>
  </section>
</template>
