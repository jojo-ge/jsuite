<script setup lang="ts">
import type { BranchInfo, BranchList, KnownRepo, ReviewMeta } from '~/utils/reviewTypes'

useHead({ title: 'Reviews' })

const { data: reviews, refresh } = await useFetch<ReviewMeta[]>('/api/reviews')
const { data: repos, refresh: refreshRepos } = await useFetch<KnownRepo[]>('/api/repos', { default: () => [] })

const creating = ref(false)
const showForm = ref(false)
const form = reactive({ repoPath: '', branch: '', base: '', title: '' })
const createError = ref('')
const router = useRouter()

// ── Codebase → branches ──────────────────────────────────────────────────────
const branchList = ref<(BranchList & { repo: string }) | null>(null)
const branchesLoading = ref(false)
const branchError = ref('')
let loadedFor = ''

async function loadBranches() {
  const repo = form.repoPath.trim()
  if (!repo || repo === loadedFor) return
  loadedFor = repo
  branchesLoading.value = true
  branchError.value = ''
  branchList.value = null
  try {
    const list = await $fetch<BranchList & { repo: string }>('/api/branches', { query: { repo } })
    if (loadedFor !== repo) return
    branchList.value = list
    form.branch = list.current || list.branches[0]?.name || ''
    applyTargetFor(form.branch)
  } catch (err: any) {
    if (loadedFor === repo) {
      branchError.value = String(err.data?.message ?? err.message ?? err)
      loadedFor = '' // let the human retry the same path
    }
  } finally {
    if (loadedFor === repo) branchesLoading.value = false
  }
}

function pickRepo(path: string) {
  form.repoPath = path
  loadBranches()
}

async function browseRepo() {
  try {
    const res = await $fetch<{ path: string | null }>('/api/repos/pick')
    if (res.path) pickRepo(res.path)
  } catch (err: any) {
    createError.value = String(err.data?.message ?? err.message ?? err)
  }
}

async function forgetRepo(path: string) {
  await $fetch('/api/repos', { method: 'DELETE', query: { path } })
  refreshRepos()
}

const branchByName = computed(() => new Map((branchList.value?.branches ?? []).map((b) => [b.name, b])))
const selectedBranch = computed<BranchInfo | undefined>(() => branchByName.value.get(form.branch))

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

const branchItems = computed(() =>
  (branchList.value?.branches ?? []).map((b) => ({
    label: b.name,
    value: b.name,
    description: [b.current ? 'checked out' : '', b.pr ? `PR #${b.pr.number}${b.pr.isDraft ? ' (draft)' : ''} → ${b.pr.baseRefName}` : '', ago(b.committedAt)]
      .filter(Boolean)
      .join(' · '),
    pr: b.pr,
  })),
)

// Targets: any branch, plus whatever the human typed (a tag, a SHA, HEAD~5).
const customTargets = ref<string[]>([])
const targetItems = computed(() => [
  ...customTargets.value.map((t) => ({ label: t, value: t })),
  ...(branchList.value?.branches ?? []).map((b) => ({ label: b.name, value: b.name })),
])
function addTarget(ref: string) {
  const t = ref.trim()
  if (!t) return
  if (!customTargets.value.includes(t)) customTargets.value.unshift(t)
  form.base = t
}

/**
 * The natural target for a branch: its open PR's base (for a stacked PR,
 * the parent branch — local if we have it, else origin/), else the repo's
 * default branch.
 */
function applyTargetFor(name: string) {
  const b = branchByName.value.get(name)
  const prBase = b?.pr?.baseRefName
  const byName = branchByName.value
  if (prBase) form.base = byName.has(prBase) ? prBase : byName.has(`origin/${prBase}`) ? `origin/${prBase}` : prBase
  else form.base = branchList.value?.defaultBase ?? ''
}
watch(() => form.branch, (name, prev) => {
  if (prev !== undefined && name !== prev) applyTargetFor(name)
})

const targetHint = computed(() => {
  const b = selectedBranch.value
  if (b?.pr) {
    const natural = b.pr.baseRefName
    return form.base.replace(/^origin\//, '') === natural
      ? `PR #${b.pr.number} targets ${natural}${natural !== branchList.value?.defaultBase?.replace(/^origin\//, '') ? ' — a stacked PR, so only its own commits are reviewed' : ''}.`
      : `PR #${b.pr.number} targets ${natural}; you've overridden it.`
  }
  return form.base === branchList.value?.defaultBase ? 'No open PR — defaulting to the main branch.' : ''
})

async function startReview() {
  createError.value = ''
  if (!form.repoPath.trim()) {
    createError.value = 'Point jReview at the repo to review.'
    return
  }
  creating.value = true
  try {
    const res = await $fetch<{ path: string }>('/api/reviews', { method: 'POST', body: { ...form } })
    router.push(res.path)
  } catch (err: any) {
    createError.value = String(err.data?.message ?? err.message ?? err)
  } finally {
    creating.value = false
  }
}

async function removeReview(r: ReviewMeta) {
  if (!window.confirm(`Forget review "${r.title}"? Its reports stay in jExplain${r.projectKey ? ` and ${r.projectKey} stays in jTicket` : ''}.`)) return
  await $fetch(`/api/reviews/${r.key}`, { method: 'DELETE' })
  refresh()
}

const statusColor = (s: ReviewMeta['status']) =>
  s === 'ticketed' ? 'success' : s === 'triaged' ? 'warning' : 'primary'
const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 py-8">
    <header class="flex items-center gap-3">
      <img src="/favicon.svg" alt="" class="size-8 rounded-lg">
      <div class="flex-1">
        <h1 class="text-lg font-semibold">jReview</h1>
        <p class="text-sm text-muted">Four reviewers, one triage, tickets on your say-so.</p>
      </div>
      <UButton icon="i-lucide-scan-search" label="New review" @click="showForm = !showForm" />
    </header>

    <UCard v-if="showForm">
      <div class="flex flex-col gap-4">
        <UFormField label="Codebase">
          <div class="flex gap-2">
            <UInput
              v-model="form.repoPath"
              placeholder="~/code/my-repo"
              class="flex-1"
              autofocus
              @blur="loadBranches"
              @keydown.enter="loadBranches"
            />
            <UButton icon="i-lucide-folder-open" color="neutral" variant="outline" aria-label="Browse" @click="browseRepo" />
          </div>
          <div v-if="repos?.length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="r in repos.slice(0, 10)"
              :key="r.path"
              class="group inline-flex items-center rounded-md border border-default text-xs"
              :class="form.repoPath === r.path ? 'border-primary bg-primary/10' : ''"
            >
              <button type="button" class="px-2 py-1 font-medium hover:text-primary" :title="r.path" @click="pickRepo(r.path)">
                {{ r.name }}
              </button>
              <button
                v-if="r.lastUsedAt"
                type="button"
                class="hidden pr-1.5 text-dimmed hover:text-error group-hover:inline"
                :aria-label="`Forget ${r.name}`"
                @click="forgetRepo(r.path)"
              >
                <UIcon name="i-lucide-x" class="size-3" />
              </button>
            </span>
          </div>
        </UFormField>

        <p v-if="branchError" class="text-sm text-error">{{ branchError }}</p>
        <p v-else-if="branchesLoading" class="text-sm text-muted">Reading branches and open PRs…</p>

        <template v-if="branchList">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Branch to review">
              <USelectMenu v-model="form.branch" :items="branchItems" value-key="value" :filter-fields="['label', 'description']" virtualize class="w-full">
                <template #item-trailing="{ item }">
                  <UBadge v-if="(item as any).pr" color="primary" variant="subtle" size="sm">#{{ (item as any).pr.number }}</UBadge>
                </template>
              </USelectMenu>
            </UFormField>
            <UFormField label="Target (compare against)">
              <USelectMenu
                v-model="form.base"
                :items="targetItems"
                value-key="value"
                create-item
                virtualize
                class="w-full"
                @create="addTarget"
              />
            </UFormField>
          </div>
          <div class="-mt-2 flex flex-col gap-1 text-xs text-muted">
            <p v-if="selectedBranch?.pr">
              <UIcon name="i-lucide-git-pull-request" class="size-3.5 align-[-2px]" />
              <a :href="selectedBranch.pr.url" target="_blank" class="hover:underline">#{{ selectedBranch.pr.number }} {{ selectedBranch.pr.title }}</a>
            </p>
            <p v-if="targetHint">{{ targetHint }}</p>
            <p>Reviews <code>{{ form.base || '…' }}...{{ form.branch || '…' }}</code><template v-if="selectedBranch && !selectedBranch.current"> in a separate worktree — your checkout isn't touched</template>.</p>
            <p v-if="branchList.prError" class="text-warning">PR detection unavailable: {{ branchList.prError }}</p>
          </div>
        </template>

        <UInput v-model="form.title" placeholder="Title (optional — defaults to repo · branch)" />
        <p class="text-xs text-muted">
          Starts four Opus 5.5 reviewers in herdr. Each runs the repo's code-review skill (or the default one)
          and publishes a jExplain report here. When all four are in, a triager merges the duplicates.
        </p>
        <p v-if="createError" class="text-sm text-error">{{ createError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="showForm = false" />
          <UButton icon="i-lucide-play" label="Run 4 reviewers" :loading="creating" :disabled="!branchList" @click="startReview" />
        </div>
      </div>
    </UCard>

    <div v-if="!reviews?.length && !showForm" class="rounded-lg border border-dashed border-default p-10 text-center text-muted">
      <p class="mb-3">No reviews yet.</p>
      <UButton icon="i-lucide-scan-search" label="Review a branch" variant="soft" @click="showForm = true" />
    </div>

    <ul v-else class="flex flex-col gap-2">
      <li v-for="r in reviews" :key="r.key">
        <UCard :ui="{ body: 'p-4 sm:p-4' }">
          <div class="flex items-center gap-3">
            <NuxtLink :to="`/r/${r.key}`" class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">{{ r.title }}</span>
                <UBadge :color="statusColor(r.status)" variant="subtle" size="sm">{{ r.status }}</UBadge>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted">
                <span class="font-mono">{{ r.repoPath }}</span>
                · <span class="font-mono">{{ r.base }}...{{ r.branch }}</span>
                <template v-if="r.prNumber"> · PR #{{ r.prNumber }}</template>
                <template v-if="r.findingCount"> · {{ r.findingCount }} findings</template>
                <template v-if="r.projectKey"> · {{ r.projectKey }} in jTicket</template>
                · {{ dateFmt(r.createdAt) }}
              </p>
            </NuxtLink>
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Forget review"
              @click="removeReview(r)"
            />
          </div>
        </UCard>
      </li>
    </ul>
  </div>
</template>
