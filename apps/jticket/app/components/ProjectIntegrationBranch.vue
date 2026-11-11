<script setup lang="ts">
// The Overview tab's integration-branch card: cutting the project's
// integration branch or pointing it at one that already exists, and the
// branch's worktree, made the codebase's way (IntegrationWorktree). The
// roll-up PR lives on the Pull requests tab.
//
// One read: GET /github for the repo side (slug, links, the suggested name).
import type { Project } from '~/composables/useTracker'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ configure: [] }>()

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
    jdiffUrl: string
    githubUrl: string | null
  } | null
}

const toast = useToast()
const { refresh: refreshTracker } = useTracker()
const { creating, revision, invalidate, createBranch: cutBranch } = useIntegrationBranch()
const errorText = branchErrorText

const { data: gh, error: ghError, refresh: refreshGh } = useFetch<GithubInfo>(
  () => `/api/projects/${props.project.id}/github`,
  { lazy: true, server: false },
)
// Somebody else changed the branch (the header's ⋯ menu, another tab).
watch(revision, () => refreshGh())

const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => { now.value = new Date() }, 60_000) })
onUnmounted(() => { if (tick) clearInterval(tick) })

// ── Cutting the integration branch ──
const branchName = ref('')
watch(gh, (d) => { if (d && !branchName.value) branchName.value = d.suggestedBranch }, { immediate: true })

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
        <!-- Identity -->
        <div class="flex flex-wrap items-center gap-2 border-t border-default/60 px-3 py-2.5 text-sm">
          <UIcon name="i-lucide-git-branch" class="size-4 shrink-0 text-muted" />
          <span class="font-mono text-sm font-medium">{{ gh.branch.name }}</span>
          <span class="text-xs text-muted">off {{ gh.defaultBranch }} · local PRs land here</span>
          <div class="ml-auto flex items-center gap-1">
            <UButton :to="gh.branch.jdiffUrl" target="_blank" external icon="i-lucide-git-compare" size="xs" color="neutral" variant="ghost">
              jDiff
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
