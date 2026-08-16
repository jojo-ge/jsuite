<script setup lang="ts">
// The project's GitHub side, on the project page: which repo it points at, the
// state of its integration branch, and every open PR that belongs to it — each
// row opening the review here in jTicket, and github.com for the PR itself.
//
// The review links are built with useDiffRoutes() rather than written out:
// jTicket serves @jsuite/diff's screens at /diffs, jDiff serves the same
// components at the root, and a hardcoded path only works in one of them.
//
// They carry the repo *as the project stores it*, not the expanded `data.repo`
// this panel displays. The engine expands either one server-side, but the
// review UI keys its client state (the live analysis tasks, `${repo} ${id}`)
// on the string it was given — so a review reached from here and the same
// review reached from a ticket's attachment have to be spelled the same way or
// they are two reviews as far as the browser is concerned.
//
// The data comes from GET /api/projects/:id/github, which does the `gh`/`git`
// work server-side. It's a network call, so it loads lazily and client-side:
// the rest of the project page never waits on GitHub.
import type { Project } from '~/composables/useTracker'

const props = defineProps<{ project: Project }>()
// Nothing to configure inline — "connect a repo" opens the project edit modal
// the page already owns.
const emit = defineEmits<{ configure: [] }>()

interface ProjectPr {
  number: number
  title: string
  author?: { login?: string } | null
  headRefName: string
  baseRefName: string
  isDraft: boolean
  updatedAt: string
  additions?: number
  deletions?: number
  matchedBy: ('integration' | 'base' | 'key')[]
  keys: string[]
  githubUrl: string
}
interface GithubInfo {
  configured: boolean
  repo: string
  slug: string | null
  repoUrl?: string | null
  defaultBranch: string
  integrationBranch: string
  suggestedBranch: string
  branch: {
    name: string
    local: boolean
    remote: boolean
    githubUrl: string | null
    comparePrUrl: string | null
  } | null
  prs: ProjectPr[]
  prsError: string | null
}

const toast = useToast()
const routes = useDiffRoutes()
const { refresh: refreshTracker } = useTracker()
// Cutting the branch is shared with the project header's button — same action,
// same in-flight state, and `revision` tells us when the other one changed it.
const { creating, revision, invalidate, createBranch: cutBranch } = useIntegrationBranch()

const force = ref<string | undefined>(undefined)
const { data, pending, error, refresh } = useFetch<GithubInfo>(
  () => `/api/projects/${props.project.id}/github`,
  { query: { force }, lazy: true, server: false },
)
function reload() {
  force.value = String(Date.now())
  refresh()
}

// "2 hours ago" on each row; a minute's granularity is plenty.
const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => { now.value = new Date() }, 60_000) })
onUnmounted(() => { if (tick) clearInterval(tick) })

// ── Cutting the integration branch ──
// The name is editable here (the header button just takes the suggestion).
const branchName = ref('')
watch(data, (d) => { if (d && !branchName.value) branchName.value = d.suggestedBranch }, { immediate: true })

async function createBranch() {
  await cutBranch(props.project.id, branchName.value)
}

// Somebody else changed the branch — the header button, or another tab.
watch(revision, () => reload())

const errorText = branchErrorText

// ── Adopting a branch that already exists ──
// The integration branch doesn't have to have been cut here: point the project
// at a branch somebody made by hand and everything else (PR matching, the
// roll-up link) works the same.
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
const fetchStamp = ref<string | undefined>(undefined)
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
  { query: { q: debouncedQuery, fetch: fetchStamp }, lazy: true, server: false, immediate: false },
)

function openPicker() {
  pickerOpen.value = true
  branchQuery.value = ''
  debouncedQuery.value = ''
  refreshBranches()
}

// ↻ — prune and re-fetch origin, so a branch a teammate pushed a minute ago shows up.
function refetchBranches() {
  fetchStamp.value = String(Date.now())
  refreshBranches()
}

async function useBranch(name: string) {
  picking.value = name
  try {
    await $fetch(`/api/projects/${props.project.id}`, {
      method: 'PATCH',
      body: { integrationBranch: name },
    })
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

async function clearBranch() {
  await $fetch(`/api/projects/${props.project.id}`, { method: 'PATCH', body: { integrationBranch: '' } })
  await refreshTracker()
  invalidate()
}

const prs = computed(() => data.value?.prs ?? [])
</script>

<template>
  <section class="mb-8">
    <div class="mb-2 flex items-center gap-2">
      <UIcon name="i-lucide-git-pull-request" class="size-4 text-muted" />
      <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Pull requests</h2>
      <span v-if="data?.configured" class="text-xs text-muted">{{ prs.length }}</span>
      <UButton
        v-if="data?.configured"
        icon="i-lucide-refresh-cw"
        size="xs"
        color="neutral"
        variant="ghost"
        :loading="pending"
        class="ml-auto"
        aria-label="Refresh pull requests"
        @click="reload"
      />
      <UButton
        icon="i-lucide-settings"
        size="xs"
        color="neutral"
        variant="ghost"
        :class="data?.configured ? '' : 'ml-auto'"
        aria-label="Edit the GitHub link"
        @click="emit('configure')"
      />
    </div>

    <!-- No repo yet -->
    <div
      v-if="data && !data.configured"
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-10 text-center"
    >
      <UIcon name="i-lucide-github" class="size-7 text-muted" />
      <div>
        <p class="text-sm">This project isn't wired to a repo.</p>
        <p class="text-xs text-muted">Point it at a local clone to see its PRs and cut an integration branch.</p>
      </div>
      <UButton icon="i-lucide-link" size="sm" variant="soft" @click="emit('configure')">Connect a repo</UButton>
    </div>

    <!-- The repo couldn't be resolved at all (bad path, not a directory) -->
    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Can't read this project's repo"
      :description="errorText(error)"
    />

    <div v-else-if="data?.configured" class="space-y-3">
      <!-- Repo + integration branch -->
      <div class="rounded-lg border border-default px-3 py-2.5">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <UIcon name="i-lucide-github" class="size-4 shrink-0 text-muted" />
          <a
            v-if="data.repoUrl"
            :href="data.repoUrl"
            target="_blank"
            rel="noreferrer"
            class="font-medium hover:underline"
          >{{ data.slug }}</a>
          <span v-else class="font-medium">{{ data.slug ?? 'local repo' }}</span>
          <span class="truncate font-mono text-xs text-muted">{{ data.repo }}</span>
          <UButton
            :to="routes.prs(project.repo)"
            icon="i-lucide-git-compare"
            size="xs"
            color="neutral"
            variant="ghost"
            class="ml-auto"
          >
            All reviews
          </UButton>
        </div>

        <!-- Has an integration branch -->
        <div v-if="data.branch" class="mt-2 flex flex-wrap items-center gap-2 border-t border-default/60 pt-2 text-sm">
          <UIcon name="i-lucide-git-branch" class="size-4 shrink-0 text-muted" />
          <span class="font-mono text-xs">{{ data.branch.name }}</span>
          <UBadge v-if="data.branch.remote" color="success" variant="subtle" size="sm">on origin</UBadge>
          <UBadge v-else color="warning" variant="subtle" size="sm">local only</UBadge>
          <span class="text-xs text-muted">integration branch · off {{ data.defaultBranch }}</span>
          <div class="ml-auto flex gap-1">
            <UTooltip text="Point at a different branch">
              <UButton
                icon="i-lucide-search"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Change the integration branch"
                @click="openPicker"
              />
            </UTooltip>
            <UTooltip text="Unset the integration branch">
              <UButton
                icon="i-lucide-unlink"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Unset the integration branch"
                @click="clearBranch"
              />
            </UTooltip>
            <UButton
              :to="routes.branch({ repo: project.repo, branch: data.branch.name })"
              icon="i-lucide-git-compare"
              size="xs"
              color="neutral"
              variant="ghost"
            >
              Review
            </UButton>
            <UButton
              v-if="data.branch.comparePrUrl"
              :to="data.branch.comparePrUrl"
              target="_blank"
              external
              icon="i-lucide-external-link"
              size="xs"
              color="neutral"
              variant="ghost"
            >
              Roll-up PR
            </UButton>
          </div>
        </div>

        <!-- No integration branch yet — cut one -->
        <div v-else class="mt-2 flex flex-wrap items-center gap-2 border-t border-default/60 pt-2">
          <UIcon name="i-lucide-git-branch" class="size-4 shrink-0 text-muted" />
          <UInput v-model="branchName" size="xs" class="w-72 font-mono" :placeholder="data.suggestedBranch" />
          <UButton icon="i-lucide-git-branch-plus" size="xs" :loading="creating === project.id" @click="createBranch">
            Create integration branch
          </UButton>
          <span class="text-xs text-muted">empty branch off {{ data.defaultBranch }}, pushed to origin</span>
          <UButton
            icon="i-lucide-search"
            size="xs"
            color="neutral"
            variant="ghost"
            class="w-full justify-start sm:w-auto"
            @click="openPicker"
          >
            or use an existing branch
          </UButton>
        </div>
      </div>

      <!-- gh couldn't list PRs — the branch panel above is still useful -->
      <UAlert
        v-if="data.prsError"
        color="warning"
        variant="subtle"
        icon="i-lucide-cloud-off"
        title="Couldn't list pull requests"
        :description="data.prsError"
      />

      <div v-if="pending && !prs.length" class="py-6 text-center text-sm text-muted">Loading pull requests…</div>

      <!-- PR rows -->
      <div v-else-if="prs.length" class="overflow-hidden rounded-lg border border-default">
        <div
          v-for="pr in prs"
          :key="pr.number"
          class="flex items-center gap-2 border-b border-default/60 px-3 py-2 text-sm last:border-0 hover:bg-elevated/40"
        >
          <span class="w-12 shrink-0 font-mono text-xs text-muted">#{{ pr.number }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate">{{ pr.title }}</span>
              <UBadge v-if="pr.isDraft" color="neutral" variant="subtle" size="sm">Draft</UBadge>
              <UBadge v-if="pr.matchedBy.includes('integration')" color="primary" variant="subtle" size="sm">
                Roll-up
              </UBadge>
              <UBadge v-for="k in pr.keys" :key="k" color="secondary" variant="outline" size="sm" class="font-mono">
                {{ k }}
              </UBadge>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span class="font-mono">{{ pr.headRefName }} → {{ pr.baseRefName }}</span>
              <span v-if="pr.author?.login">· {{ pr.author.login }}</span>
              <span v-if="pr.additions != null">· <span class="text-success">+{{ pr.additions }}</span>
                <span class="text-error">−{{ pr.deletions }}</span></span>
              <span>· {{ agoLabel(pr.updatedAt, now) }}</span>
            </div>
          </div>
          <div class="flex shrink-0 gap-1">
            <UTooltip text="Review this PR here">
              <UButton
                :to="routes.pr(project.repo, pr.number)"
                icon="i-lucide-git-compare"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Review this PR"
              />
            </UTooltip>
            <UTooltip text="Open on GitHub">
              <UButton
                :to="pr.githubUrl"
                target="_blank"
                external
                icon="i-lucide-github"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Open on GitHub"
              />
            </UTooltip>
          </div>
        </div>
      </div>

      <p v-else-if="!data.prsError" class="rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted">
        No open PRs target
        <span v-if="data.branch" class="font-mono">{{ data.branch.name }}</span>
        <span v-else>this project</span>
        or name one of its tickets.
      </p>
    </div>

    <div v-else class="py-6 text-center text-sm text-muted">Loading…</div>

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
