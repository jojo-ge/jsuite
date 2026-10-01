<script setup lang="ts">
// The project page's Branches tab: the project's integration branch — cutting
// or adopting it, where it stands against origin and the default branch, and
// the remote writes (push, fast-forward pull, the roll-up PR). Its worktree,
// made the codebase's way, sits underneath.
//
// Two reads: GET /github for the repo side (slug, links, the suggested name)
// and GET /branch-status for the ahead/behind picture, which fetches origin on
// open and on ↻ and reads local refs otherwise.
import type { Project } from '~/composables/useTracker'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ configure: [] }>()

interface GithubInfo {
  configured: boolean
  repo: string
  slug: string | null
  repoUrl?: string | null
  jdiffRepoUrl?: string | null
  defaultBranch: string
  integrationBranch: string
  suggestedBranch: string
  branch: {
    name: string
    jdiffUrl: string
    githubUrl: string | null
    comparePrUrl: string | null
  } | null
  prs: { number: number; url: string; matchedBy: string[] }[]
}
interface Commit {
  oid: string
  shortOid: string
  subject: string
  author: string
  committedAt: string
}
interface BranchStatus {
  name: string
  defaultBranch: string
  tip: Commit | null
  local: boolean
  onOrigin: boolean
  toPush: Commit[]
  toPushCount: number
  incoming: Commit[]
  incomingCount: number
  diverged: boolean
  aheadOfDefault: number
  behindDefault: number
  checkedOutAt: string | null
  dirtyFiles: number
}

const toast = useToast()
const { refresh: refreshTracker, prs: trackerPrs } = useTracker()
const { creating, revision, invalidate, createBranch: cutBranch } = useIntegrationBranch()
const errorText = branchErrorText

const { data: gh, error: ghError, refresh: refreshGh } = useFetch<GithubInfo>(
  () => `/api/projects/${props.project.id}/github`,
  { lazy: true, server: false },
)

// The first read fetches origin; live refreshes (a local PR landing moves the
// branch) read local refs only. ↻ fetches again.
const fetchStamp = ref<string | undefined>('1')
const {
  data: statusData,
  pending: statusPending,
  error: statusError,
  refresh: refreshStatus,
} = useFetch<{ defaultBranch: string; fetchFailed: boolean; status: BranchStatus | null }>(
  () => `/api/projects/${props.project.id}/branch-status`,
  { query: { fetch: fetchStamp }, lazy: true, server: false },
)
const status = computed(() => statusData.value?.status ?? null)

async function reloadLocal() {
  fetchStamp.value = undefined
  await refreshStatus()
}
function reloadAll() {
  fetchStamp.value = String(Date.now())
  refreshStatus()
  refreshGh()
}

// Somebody else changed the branch (the header's ⋯ menu, another tab).
watch(revision, reloadAll)
// A local PR merged or an agent landed a queue — the branch moved.
const prFingerprint = computed(() =>
  trackerPrs.value
    .filter((pr) => pr.projectId === props.project.id)
    .map((pr) => `${pr.key}:${pr.status}:${pr.updatedAt}`)
    .sort()
    .join('|'),
)
watch(prFingerprint, reloadLocal)

const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => { now.value = new Date() }, 60_000) })
onUnmounted(() => { if (tick) clearInterval(tick) })

// ── Cutting the integration branch ──
const branchName = ref('')
watch(gh, (d) => { if (d && !branchName.value) branchName.value = d.suggestedBranch }, { immediate: true })

// ── Remote writes ──
const busy = ref<'' | 'push' | 'pull' | 'rollup' | 'unset'>('')

async function push() {
  busy.value = 'push'
  try {
    const res = await $fetch<{ branch: string }>(`/api/projects/${props.project.id}/sync`, { method: 'POST' })
    toast.add({ title: `Pushed ${res.branch} to origin`, color: 'success', icon: 'i-lucide-upload' })
  } catch (err: any) {
    toast.add({ title: 'Could not push the integration branch', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    busy.value = ''
    await reloadLocal()
  }
}

async function pull() {
  busy.value = 'pull'
  try {
    const res = await $fetch<{ branch: string; from: string; to: string }>(`/api/projects/${props.project.id}/branch-pull`, { method: 'POST' })
    toast.add({
      title: res.from === res.to ? `${res.branch} was already up to date` : `Fast-forwarded ${res.branch}`,
      description: res.from === res.to ? undefined : `${res.from.slice(0, 10)} → ${res.to.slice(0, 10)}`,
      color: 'success',
      icon: 'i-lucide-download',
    })
  } catch (err: any) {
    toast.add({ title: 'Could not pull the integration branch', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    busy.value = ''
    await reloadLocal()
  }
}

const rollupPr = computed(() => gh.value?.prs.find((pr) => pr.matchedBy.includes('integration')) ?? null)
async function openRollupPr() {
  busy.value = 'rollup'
  try {
    const res = await $fetch<{ url: string; created: boolean }>(`/api/projects/${props.project.id}/integration-pr`, { method: 'POST' })
    toast.add({
      title: res.created ? 'Roll-up PR opened' : 'Roll-up PR already open',
      description: res.url,
      color: 'success',
      icon: 'i-lucide-git-pull-request',
    })
    if (res.url) window.open(res.url, '_blank')
  } catch (err: any) {
    toast.add({ title: 'Could not open the roll-up PR', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    busy.value = ''
    reloadAll()
  }
}

async function unsetBranch() {
  busy.value = 'unset'
  try {
    await $fetch(`/api/projects/${props.project.id}`, { method: 'PATCH', body: { integrationBranch: '' } })
    await refreshTracker()
    invalidate()
  } finally {
    busy.value = ''
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

// ── Commit lists — what a push sends, what a pull brings ──
const showPush = ref(true)
const showIncoming = ref(true)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
</script>

<template>
  <section class="space-y-3">
    <!-- No repo yet -->
    <div
      v-if="gh && !gh.configured"
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-10 text-center"
    >
      <UIcon name="i-lucide-git-branch" class="size-7 text-muted" />
      <div>
        <p class="text-sm">This project isn't wired to a repo.</p>
        <p class="text-xs text-muted">Point it at a local clone to cut an integration branch and push it.</p>
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

    <div v-else-if="!gh" class="py-10 text-center text-sm text-muted">Loading…</div>

    <template v-else>
      <!-- Repo -->
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <UIcon name="i-lucide-github" class="size-4 shrink-0 text-muted" />
        <a v-if="gh.repoUrl" :href="gh.repoUrl" target="_blank" rel="noreferrer" class="font-medium hover:underline">{{ gh.slug }}</a>
        <span v-else class="font-medium">{{ gh.slug ?? 'local repo' }}</span>
        <span class="truncate font-mono text-xs text-muted">{{ gh.repo }}</span>
        <div class="ml-auto flex items-center gap-1">
          <UTooltip text="Fetch from origin and re-read the branch">
            <UButton
              icon="i-lucide-refresh-cw"
              size="xs"
              color="neutral"
              variant="ghost"
              :loading="statusPending"
              aria-label="Fetch and refresh"
              @click="reloadAll"
            />
          </UTooltip>
          <UButton icon="i-lucide-settings" size="xs" color="neutral" variant="ghost" aria-label="Edit the repo link" @click="emit('configure')" />
        </div>
      </div>

      <!-- No integration branch yet — cut one, or adopt one -->
      <div v-if="!gh.branch" class="rounded-lg border border-default px-3 py-3">
        <p class="mb-2 text-sm">
          No integration branch yet. The project's local PRs land on it, and it goes to GitHub as one roll-up PR.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <UInput v-model="branchName" size="sm" class="w-80 font-mono" :placeholder="gh.suggestedBranch" />
          <UButton icon="i-lucide-git-branch-plus" size="sm" :loading="creating === project.id" @click="cutBranch(project.id, branchName)">
            Create integration branch
          </UButton>
          <span class="text-xs text-muted">empty branch off {{ gh.defaultBranch }}, pushed to origin</span>
          <UButton icon="i-lucide-search" size="sm" color="neutral" variant="ghost" @click="openPicker">
            or use an existing branch
          </UButton>
        </div>
      </div>

      <template v-else>
        <div class="rounded-lg border border-default">
          <!-- Identity -->
          <div class="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
            <UIcon name="i-lucide-git-branch" class="size-4 shrink-0 text-muted" />
            <span class="font-mono text-sm font-medium">{{ gh.branch.name }}</span>
            <template v-if="status">
              <UBadge v-if="!status.local" color="neutral" variant="outline" size="sm">origin only</UBadge>
              <UBadge v-else-if="status.onOrigin" color="success" variant="subtle" size="sm">on origin</UBadge>
              <UBadge v-else color="warning" variant="subtle" size="sm">never pushed</UBadge>
              <UBadge v-if="status.diverged" color="error" variant="subtle" size="sm" icon="i-lucide-split">diverged</UBadge>
            </template>
            <span class="text-xs text-muted">integration branch · off {{ gh.defaultBranch }}</span>
            <div class="ml-auto flex items-center gap-1">
              <UTooltip text="Point at a different branch">
                <UButton icon="i-lucide-search" size="xs" color="neutral" variant="ghost" aria-label="Change the integration branch" @click="openPicker" />
              </UTooltip>
              <UTooltip text="Unset the integration branch (nothing is deleted)">
                <UButton
                  icon="i-lucide-unlink"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :loading="busy === 'unset'"
                  aria-label="Unset the integration branch"
                  @click="unsetBranch"
                />
              </UTooltip>
            </div>
          </div>

          <!-- Where it stands -->
          <div class="border-t border-default/60 px-3 py-2.5">
            <UAlert
              v-if="statusError"
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="Couldn't read the branch"
              :description="errorText(statusError)"
            />
            <div v-else-if="!status" class="text-sm text-muted">Reading the branch…</div>
            <template v-else>
              <p v-if="status.tip" class="flex min-w-0 items-center gap-2 text-xs text-muted">
                <span class="font-mono">{{ status.tip.shortOid }}</span>
                <span class="truncate text-default">{{ status.tip.subject }}</span>
                <span class="shrink-0">· {{ status.tip.author }} · {{ agoLabel(status.tip.committedAt, now) }}</span>
              </p>

              <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div class="rounded-md bg-elevated/40 px-3 py-2">
                  <p class="text-lg font-semibold" :class="status.toPushCount ? 'text-primary' : ''">↑ {{ status.toPushCount }}</p>
                  <p class="text-xs text-muted">{{ status.onOrigin ? 'to push' : 'never pushed' }}</p>
                </div>
                <div class="rounded-md bg-elevated/40 px-3 py-2">
                  <p class="text-lg font-semibold" :class="status.incomingCount ? 'text-warning' : ''">↓ {{ status.incomingCount }}</p>
                  <p class="text-xs text-muted">on origin, not here</p>
                </div>
                <div class="rounded-md bg-elevated/40 px-3 py-2">
                  <p class="text-lg font-semibold">{{ status.aheadOfDefault }}</p>
                  <p class="text-xs text-muted">ahead of {{ status.defaultBranch }}</p>
                </div>
                <div class="rounded-md bg-elevated/40 px-3 py-2">
                  <p class="text-lg font-semibold" :class="status.behindDefault ? 'text-warning' : ''">{{ status.behindDefault }}</p>
                  <p class="text-xs text-muted">behind {{ status.defaultBranch }}</p>
                </div>
              </div>

              <p v-if="status.checkedOutAt" class="mt-2 text-xs text-muted">
                Checked out in <span class="font-mono">{{ status.checkedOutAt }}</span>
                <template v-if="status.dirtyFiles"> · <span class="text-warning">{{ plural(status.dirtyFiles, 'uncommitted file') }}</span></template>
              </p>
              <p v-if="statusData?.fetchFailed" class="mt-2 text-xs text-warning">
                Couldn't reach origin — showing what this clone last fetched.
              </p>
              <UAlert
                v-if="status.diverged"
                class="mt-2"
                color="error"
                variant="subtle"
                icon="i-lucide-split"
                title="The branch has diverged from origin"
                description="Both sides have commits the other lacks, so a push would be rejected and a pull can't fast-forward. Rebase or merge it by hand, then push."
              />

              <!-- Actions -->
              <div class="mt-3 flex flex-wrap items-center gap-1.5">
                <UTooltip text="git push --set-upstream origin — the only remote write in the local-PR flow">
                  <UButton
                    icon="i-lucide-upload"
                    size="sm"
                    :variant="status.toPushCount && !status.diverged ? 'solid' : 'soft'"
                    :color="status.toPushCount && !status.diverged ? 'primary' : 'neutral'"
                    :disabled="!status.local || status.diverged || (status.onOrigin && !status.toPushCount)"
                    :loading="busy === 'push'"
                    @click="push"
                  >
                    {{ status.onOrigin ? `Push${status.toPushCount ? ` ${plural(status.toPushCount, 'commit')}` : ''}` : 'Push to origin' }}
                  </UButton>
                </UTooltip>
                <UTooltip text="Fast-forward to origin's tip — never merges">
                  <UButton
                    v-if="status.incomingCount"
                    icon="i-lucide-download"
                    size="sm"
                    color="neutral"
                    variant="soft"
                    :disabled="status.diverged"
                    :loading="busy === 'pull'"
                    @click="pull"
                  >
                    Pull {{ plural(status.incomingCount, 'commit') }}
                  </UButton>
                </UTooltip>
                <UTooltip :text="rollupPr ? 'Open the roll-up PR on GitHub' : 'Push, then open the roll-up PR against the default branch'">
                  <UButton
                    v-if="rollupPr"
                    :to="rollupPr.url"
                    target="_blank"
                    external
                    icon="i-lucide-git-pull-request"
                    size="sm"
                    color="neutral"
                    variant="soft"
                  >
                    Roll-up PR #{{ rollupPr.number }}
                  </UButton>
                  <UButton
                    v-else
                    icon="i-lucide-git-pull-request-arrow"
                    size="sm"
                    color="neutral"
                    variant="soft"
                    :disabled="!status.local || status.diverged"
                    :loading="busy === 'rollup'"
                    @click="openRollupPr"
                  >
                    Open roll-up PR
                  </UButton>
                </UTooltip>
                <UButton
                  :to="{ query: { tab: 'review' } }"
                  icon="i-lucide-scan-search"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                >
                  Review
                </UButton>
                <div class="ml-auto flex items-center gap-1">
                  <UButton :to="gh.branch.jdiffUrl" target="_blank" external icon="i-lucide-git-compare" size="sm" color="neutral" variant="ghost">
                    jDiff
                  </UButton>
                  <UButton
                    v-if="gh.branch.githubUrl && status.onOrigin"
                    :to="gh.branch.githubUrl"
                    target="_blank"
                    external
                    icon="i-lucide-github"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    aria-label="Open on GitHub"
                  />
                </div>
              </div>
            </template>
          </div>

          <!-- What a push sends -->
          <div v-if="status?.toPush.length" class="border-t border-default/60">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:bg-elevated/40"
              @click="showPush = !showPush"
            >
              <UIcon :name="showPush ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
              {{ status.onOrigin ? 'Not on origin yet' : `Off ${status.defaultBranch}, never pushed` }}
              <span class="font-normal normal-case tracking-normal">{{ status.toPushCount }}</span>
            </button>
            <div v-if="showPush" class="px-3 pb-2">
              <div v-for="c in status.toPush" :key="c.oid" class="flex items-center gap-2 py-0.5 text-xs">
                <span class="shrink-0 font-mono text-muted">{{ c.shortOid }}</span>
                <span class="truncate">{{ c.subject }}</span>
                <span class="ml-auto shrink-0 text-muted">{{ c.author }} · {{ agoLabel(c.committedAt, now) }}</span>
              </div>
              <p v-if="status.toPushCount > status.toPush.length" class="py-0.5 text-xs text-muted">
                … and {{ status.toPushCount - status.toPush.length }} more
              </p>
            </div>
          </div>

          <!-- What a pull brings -->
          <div v-if="status?.incoming.length" class="border-t border-default/60">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:bg-elevated/40"
              @click="showIncoming = !showIncoming"
            >
              <UIcon :name="showIncoming ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
              On origin, not here
              <span class="font-normal normal-case tracking-normal">{{ status.incomingCount }}</span>
            </button>
            <div v-if="showIncoming" class="px-3 pb-2">
              <div v-for="c in status.incoming" :key="c.oid" class="flex items-center gap-2 py-0.5 text-xs">
                <span class="shrink-0 font-mono text-muted">{{ c.shortOid }}</span>
                <span class="truncate">{{ c.subject }}</span>
                <span class="ml-auto shrink-0 text-muted">{{ c.author }} · {{ agoLabel(c.committedAt, now) }}</span>
              </div>
            </div>
          </div>

          <!-- The integration branch's worktree, made the codebase's way -->
          <div class="px-3 [&:has(>*)]:pb-2.5">
            <IntegrationWorktree :project="project" />
          </div>
        </div>
      </template>
    </template>

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
