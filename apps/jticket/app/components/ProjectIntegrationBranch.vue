<script setup lang="ts">
// The Overview tab's integration-branch card: cutting the project's
// integration branch or pointing it at one that already exists, and the
// branch's worktree, made the codebase's way (IntegrationWorktree). The
// roll-up PR lives on the Pull requests tab.
//
// Stacking (app/utils/stacking.ts): the branch can be cut from another build's
// integration branch instead of the default branch; the card shows the base,
// how far the branch is ahead of/behind it, unpushed commits and the slice's
// size, and has the Sync button (merge the base in, locally).
//
// Reads: GET /github for the repo side (slug, links, the suggested name), and
// GET /integration-branch for the branch measured against its base.
import type { Project } from '~/composables/useTracker'
import { stackCandidates, type SliceSize, type SyncCase, type UpstreamPr } from '~/utils/stacking'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ configure: [] }>()

interface GithubInfo {
  configured: boolean
  repo: string
  slug: string | null
  repoUrl?: string | null
  defaultBranch: string
  integrationBranch: string
  integrationBase?: string
  baseBranch?: string
  suggestedBranch: string
  branch: {
    name: string
    local: boolean
    remote: boolean
    diffUrl: string
    githubUrl: string | null
  } | null
  /** A fresher copy of the GitHub side is being fetched. */
  refreshing?: boolean
}

const toast = useToast()
const { refresh: refreshTracker, projects } = useTracker()
const { creating, revision, invalidate, createBranch: cutBranch } = useIntegrationBranch()
const errorText = branchErrorText

const { data: gh, error: ghError, refresh: refreshGh } = useFetch<GithubInfo>(
  () => `/api/projects/${props.project.id}/github`,
  { lazy: true, server: false },
)
// Somebody else changed the branch (the header's ⋯ menu, another tab).
watch(revision, () => refreshGh())
// "On origin?" comes from the server's cache: an aged answer is marked
// `refreshing`, so ask again until the fresh one lands.
useRefetchWhileRefreshing(gh, () => refreshGh())

const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => { now.value = new Date() }, 60_000) })
onUnmounted(() => { if (tick) clearInterval(tick) })

// ── Cutting the integration branch ──
const branchName = ref('')
watch(gh, (d) => { if (d && !branchName.value) branchName.value = d.suggestedBranch }, { immediate: true })

// What to cut it from: the default branch, or another build's integration
// branch to stack on (a select item can't carry '', hence the sentinel).
const DEFAULT_BASE = '__default'
const cutBase = ref(DEFAULT_BASE)
const baseItems = computed(() => [
  { label: `Default branch${gh.value?.defaultBranch ? ` (${gh.value.defaultBranch})` : ''}`, value: DEFAULT_BASE },
  ...stackCandidates(projects.value, props.project).map((p) => ({ label: `Stack on ${p.key} ${p.title} · ${p.integrationBranch}`, value: p.integrationBranch })),
])
// Preselect what this build is meant to start from: the base Move on recorded,
// else the build its graph says it stacks on (chosen at Move on, perhaps before
// that build had a branch to stack on).
const { data: place } = useFetch<{ node?: { stackOn: string | null }; upstream?: Array<{ nodeId: string; project: { key: string } | null }> }>(
  () => `/api/projects/${props.project.id}/graph`,
  { lazy: true, server: false },
)
const intendedBase = computed(() => {
  if (props.project.integrationBase) return props.project.integrationBase
  const on = place.value?.node?.stackOn
  const key = on ? place.value?.upstream?.find((u) => u.nodeId === on)?.project?.key : undefined
  return key ? (projects.value.find((p) => p.key === key)?.integrationBranch ?? '') : ''
})
watch(
  [intendedBase, baseItems],
  ([want]) => {
    if (cutBase.value === DEFAULT_BASE && want && baseItems.value.some((i) => i.value === want)) cutBase.value = want
  },
  { immediate: true },
)
const cutBaseName = computed(() => (cutBase.value === DEFAULT_BASE ? gh.value?.defaultBranch ?? 'the default branch' : cutBase.value))
function cut() {
  cutBranch(props.project.id, branchName.value, cutBase.value === DEFAULT_BASE ? undefined : cutBase.value)
}

// ── The branch against its base ──
interface StackState {
  configured: boolean
  branch: string
  base: string
  baseBranch: string
  defaultBranch: string
  stacked: boolean
  upstreamProject: { id: string; key: string; title: string } | null
  upstreamPr: UpstreamPr | null
  baseExists: boolean
  upstreamMerged: boolean
  upstreamWhy: string
  sync: SyncCase | null
  comparedWith: string
  ahead: number | null
  behind: number | null
  pushed: boolean | null
  unpushed: number | null
  slice: SliceSize | null
  refreshing?: boolean
  error: string | null
}
const { data: stack, refresh: refreshStack } = useFetch<StackState>(
  () => `/api/projects/${props.project.id}/integration-branch`,
  { lazy: true, server: false },
)
watch(revision, () => refreshStack())
useRefetchWhileRefreshing(stack, () => refreshStack())

const syncLabel = computed(() => {
  const s = stack.value
  if (!s) return 'Sync'
  if (s.sync === 'upstream-merged') return `Move onto ${s.upstreamPr?.state === 'MERGED' && s.upstreamPr.baseRefName ? s.upstreamPr.baseRefName : s.defaultBranch}`
  if (s.sync === 'upstream-open') return 'Sync from upstream'
  return `Merge ${s.defaultBranch} in`
})
const syncNeeded = computed(() => !!stack.value && (stack.value.sync === 'upstream-merged' || stack.value.behind !== 0))

interface SyncAnswer {
  ok: boolean
  case: SyncCase
  from: string
  outcome:
    | { ok: true; kind: 'up-to-date' | 'fast-forward' | 'merge'; after: string; worktree: string | null }
    | { ok: false; reason: 'conflict'; conflictFiles: string[] }
    | { ok: false; reason: 'dirty-worktree'; worktree: string }
  base: string
  baseChanged: boolean
  retarget: { number: number; url: string; from: string; to: string; ok: boolean; error: string | null } | null
}
const syncing = ref(false)
const syncResult = ref<SyncAnswer | null>(null)
async function sync() {
  syncing.value = true
  syncResult.value = null
  try {
    syncResult.value = await $fetch<SyncAnswer>(`/api/projects/${props.project.id}/integration-branch/sync`, { method: 'POST' })
    if (syncResult.value.baseChanged) await refreshTracker()
    invalidate()
  } catch (err: any) {
    toast.add({ title: 'Could not sync', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    syncing.value = false
  }
}
const sizeLabel = (s: SliceSize) => `${s.files} file${s.files === 1 ? '' : 's'} · +${s.additions} −${s.deletions}`

const unsetting = ref(false)
async function unsetBranch() {
  unsetting.value = true
  try {
    await $fetch(`/api/projects/${props.project.id}`, { method: 'PATCH', body: { integrationBranch: '' } })
    await refreshTracker()
    invalidate()
  } finally {
    unsetting.value = false
  }
}

// ── Adopting a branch that already exists ──
// The integration branch doesn't have to have been cut here: point the project
// at a branch somebody made by hand and everything else works the same.
interface BranchCandidate {
  name: string
  oid: string
  subject: string
  committedAt: string
  local: boolean
  remote: boolean
  isDefault: boolean
}

const pickerOpen = ref(false)
const branchQuery = ref('')
const debouncedQuery = ref('')
const pickerFetch = ref<string | undefined>(undefined)
const picking = ref('')
let queryTimer: ReturnType<typeof setTimeout> | undefined
watch(branchQuery, (q) => {
  clearTimeout(queryTimer)
  queryTimer = setTimeout(() => { debouncedQuery.value = q }, 250)
})
onUnmounted(() => clearTimeout(queryTimer))

const {
  data: branchData,
  pending: branchPending,
  refresh: refreshBranches,
} = useFetch<{ branches: BranchCandidate[]; current: string }>(
  () => `/api/projects/${props.project.id}/branches`,
  { query: { q: debouncedQuery, fetch: pickerFetch }, lazy: true, server: false, immediate: false },
)

function openPicker() {
  pickerOpen.value = true
  branchQuery.value = ''
  debouncedQuery.value = ''
  refreshBranches()
}
function refetchBranches() {
  pickerFetch.value = String(Date.now())
  refreshBranches()
}

async function useBranch(name: string) {
  picking.value = name
  try {
    await $fetch(`/api/projects/${props.project.id}`, { method: 'PATCH', body: { integrationBranch: name } })
    toast.add({
      title: `Integration branch set to ${name}`,
      description: 'PRs targeting it now show up on this project.',
      color: 'success',
      icon: 'i-lucide-git-branch',
    })
    pickerOpen.value = false
    await refreshTracker()
    invalidate()
  } catch (err: any) {
    toast.add({ title: 'Could not set the branch', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    picking.value = ''
  }
}
</script>

<template>
  <section class="space-y-3">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Integration branch</h3>

    <!-- No repo yet -->
    <div
      v-if="gh && !gh.configured"
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-8 text-center"
    >
      <UIcon name="i-lucide-git-branch" class="size-7 text-muted" />
      <div>
        <p class="text-sm">This project isn't wired to a repo.</p>
        <p class="text-xs text-muted">Point it at a local clone to cut an integration branch.</p>
      </div>
      <UButton icon="i-lucide-link" size="sm" variant="soft" @click="emit('configure')">Connect a repo</UButton>
    </div>

    <UAlert
      v-else-if="ghError"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Can't read this project's repo"
      :description="errorText(ghError)"
    />

    <div v-else-if="!gh" class="py-6 text-center text-sm text-muted">Loading…</div>

    <div v-else class="rounded-lg border border-default">
      <!-- Repo -->
      <div class="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
        <UIcon name="i-lucide-github" class="size-4 shrink-0 text-muted" />
        <a v-if="gh.repoUrl" :href="gh.repoUrl" target="_blank" rel="noreferrer" class="font-medium hover:underline">{{ gh.slug }}</a>
        <span v-else class="font-medium">{{ gh.slug ?? 'local repo' }}</span>
        <span class="truncate font-mono text-xs text-muted">{{ gh.repo }}</span>
        <UButton icon="i-lucide-settings" size="xs" color="neutral" variant="ghost" class="ml-auto" aria-label="Edit the repo link" @click="emit('configure')" />
      </div>

      <!-- No integration branch yet — cut one, or adopt one -->
      <div v-if="!gh.branch" class="border-t border-default/60 px-3 py-3">
        <p class="mb-2 text-sm">
          No integration branch yet. The project's local PRs land on it, and it goes to GitHub as one roll-up PR.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <UInput v-model="branchName" size="sm" class="w-80 font-mono" :placeholder="gh.suggestedBranch" />
          <USelect v-if="baseItems.length > 1" v-model="cutBase" :items="baseItems" size="sm" class="w-80" aria-label="Cut it from" />
          <UButton icon="i-lucide-git-branch-plus" size="sm" :loading="creating === project.id" @click="cut">
            Create integration branch
          </UButton>
          <span class="text-xs text-muted">empty branch off {{ cutBaseName }}, pushed to origin</span>
          <UButton icon="i-lucide-search" size="sm" color="neutral" variant="ghost" @click="openPicker">
            or use an existing branch
          </UButton>
        </div>
      </div>

      <template v-else>
        <!-- Identity -->
        <div class="flex flex-wrap items-center gap-2 border-t border-default/60 px-3 py-2.5 text-sm">
          <UIcon name="i-lucide-git-branch" class="size-4 shrink-0 text-muted" />
          <span class="font-mono text-sm font-medium">{{ gh.branch.name }}</span>
          <span v-if="stack?.stacked" class="text-xs text-muted">
            stacked on
            <NuxtLink v-if="stack.upstreamProject" :to="`/projects/${stack.upstreamProject.key}`" class="hover:underline">{{ stack.upstreamProject.key }}</NuxtLink>{{ ' ' }}<span class="font-mono">{{ stack.baseBranch }}</span> · local PRs land here
          </span>
          <span v-else class="text-xs text-muted">off {{ gh.baseBranch || gh.defaultBranch }} · local PRs land here</span>
          <div class="ml-auto flex items-center gap-1">
            <UButton :to="gh.branch.diffUrl" icon="i-lucide-git-compare" size="xs" color="neutral" variant="ghost">
              Diff
            </UButton>
            <UButton
              v-if="gh.branch.githubUrl && gh.branch.remote"
              :to="gh.branch.githubUrl"
              target="_blank"
              external
              icon="i-lucide-github"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Open on GitHub"
            />
            <UTooltip text="Point at a different branch">
              <UButton icon="i-lucide-search" size="xs" color="neutral" variant="ghost" aria-label="Change the integration branch" @click="openPicker" />
            </UTooltip>
            <UTooltip text="Unset the integration branch (nothing is deleted)">
              <UButton
                icon="i-lucide-unlink"
                size="xs"
                color="neutral"
                variant="ghost"
                :loading="unsetting"
                aria-label="Unset the integration branch"
                @click="unsetBranch"
              />
            </UTooltip>
          </div>
        </div>

        <!-- Against its base: the slice, ahead/behind, unpushed, and Sync -->
        <div v-if="stack?.configured" class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-default/60 px-3 py-2 text-xs text-muted">
          <span v-if="stack.slice" class="font-medium text-default" title="This project's own work, measured from where it meets its base">{{ sizeLabel(stack.slice) }}</span>
          <span v-else>no changes yet</span>
          <span v-if="stack.ahead !== null && stack.comparedWith">{{ stack.ahead }} ahead, {{ stack.behind }} behind <span class="font-mono">{{ stack.comparedWith }}</span></span>
          <span v-if="stack.pushed === false" class="text-warning">not on origin</span>
          <span v-else-if="stack.unpushed" class="text-warning">{{ stack.unpushed }} unpushed</span>
          <UBadge v-if="stack.stacked && stack.upstreamMerged" color="warning" variant="subtle" size="sm" :title="stack.upstreamWhy">upstream merged</UBadge>
          <UBadge v-else-if="stack.stacked && !stack.baseExists" color="error" variant="subtle" size="sm">base branch missing</UBadge>
          <UTooltip :text="stack.sync === 'upstream-merged' ? `The upstream was merged (${stack.upstreamWhy}): merge what it merged into, make that the base, and retarget the roll-up PR. Local only — nothing is pushed.` : `Fetch ${stack.baseBranch} and merge it into ${stack.branch}. Local only — nothing is pushed.`">
            <UButton icon="i-lucide-git-merge" size="xs" color="neutral" variant="soft" class="ml-auto" :loading="syncing" :disabled="!syncNeeded" @click="sync">
              {{ syncLabel }}
            </UButton>
          </UTooltip>
        </div>
        <div v-if="syncResult" class="px-3 pb-2.5">
          <UAlert
            v-if="syncResult.outcome.ok"
            color="success"
            variant="subtle"
            icon="i-lucide-git-merge"
            :title="syncResult.outcome.kind === 'up-to-date' ? `Already up to date with ${syncResult.from}` : `${syncResult.outcome.kind === 'merge' ? 'Merged' : 'Fast-forwarded to'} ${syncResult.from} — not pushed yet`"
            :description="[
              syncResult.baseChanged ? `The base is now ${syncResult.base || gh.defaultBranch}.` : '',
              syncResult.retarget ? (syncResult.retarget.ok ? `Roll-up PR #${syncResult.retarget.number} now targets ${syncResult.retarget.to}.` : `Could not retarget the roll-up PR: ${syncResult.retarget.error}`) : '',
              syncResult.outcome.worktree ? `Its worktree at ${syncResult.outcome.worktree} was moved too.` : '',
            ].filter(Boolean).join(' ') || undefined"
            :close="true"
            @update:open="syncResult = null"
          />
          <UAlert
            v-else-if="syncResult.outcome.reason === 'conflict'"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="`${syncResult.from} conflicts with ${stack?.branch ?? 'this branch'} — nothing was changed`"
            :description="`Conflicted: ${syncResult.outcome.conflictFiles.join(', ')}. Merge ${syncResult.from} into the branch by hand in a worktree, resolve, commit, then sync again.`"
            :close="true"
            @update:open="syncResult = null"
          />
          <UAlert
            v-else
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="The branch is checked out with uncommitted changes — nothing was changed"
            :description="`Commit or stash the changes at ${syncResult.outcome.worktree}, then sync again.`"
            :close="true"
            @update:open="syncResult = null"
          />
        </div>

        <!-- The integration branch's worktree, made the codebase's way -->
        <div class="px-3 [&:has(>*)]:pb-2.5">
          <IntegrationWorktree :project="project" />
        </div>
      </template>
    </div>

    <!-- Branch picker — every branch in the repo, local and on origin -->
    <UModal
      v-model:open="pickerOpen"
      title="Use an existing branch"
      description="Search the repo's branches and point this project at one. Nothing is created or pushed."
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #body>
        <div class="flex items-center gap-2">
          <UInput
            v-model="branchQuery"
            icon="i-lucide-search"
            placeholder="Search by branch name or commit message…"
            autofocus
            class="flex-1"
          />
          <UTooltip text="Fetch from origin first">
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :loading="branchPending"
              aria-label="Refresh from origin"
              @click="refetchBranches"
            />
          </UTooltip>
        </div>

        <div class="mt-3 max-h-[55vh] overflow-y-auto rounded-lg border border-default">
          <div v-if="branchPending && !branchData" class="py-10 text-center text-sm text-muted">Reading branches…</div>
          <p v-else-if="!branchData?.branches.length" class="py-10 text-center text-sm text-muted">
            No branch matches “{{ branchQuery }}”.
          </p>
          <template v-else>
            <button
              v-for="b in branchData?.branches ?? []"
              :key="b.name"
              type="button"
              class="flex w-full items-center gap-2 border-b border-default/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-elevated/40 disabled:opacity-50"
              :disabled="!!picking"
              @click="useBranch(b.name)"
            >
              <UIcon
                :name="picking === b.name ? 'i-lucide-loader-circle' : 'i-lucide-git-branch'"
                class="size-4 shrink-0 text-muted"
                :class="picking === b.name ? 'animate-spin' : ''"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate font-mono text-xs">{{ b.name }}</span>
                  <UBadge v-if="b.name === branchData?.current" color="primary" variant="subtle" size="sm">Current</UBadge>
                  <UBadge v-if="b.isDefault" color="neutral" variant="subtle" size="sm">Default</UBadge>
                  <UBadge v-if="!b.remote" color="warning" variant="subtle" size="sm">local only</UBadge>
                  <UBadge v-else-if="!b.local" color="neutral" variant="outline" size="sm">on origin</UBadge>
                </div>
                <p class="truncate text-xs text-muted">{{ b.subject }}</p>
              </div>
              <span class="shrink-0 font-mono text-xs text-muted">{{ b.oid }}</span>
              <span class="shrink-0 text-xs text-muted">{{ agoLabel(b.committedAt, now) }}</span>
            </button>
          </template>
        </div>
      </template>
    </UModal>
  </section>
</template>
