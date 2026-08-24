<script setup lang="ts">
// The entry point: pick the codebase everything else is scoped to. Three ways
// in, cheapest first (same ladder as the project form used to offer): a repo
// you've used before, the native folder picker, or a typed path probed as you
// stop typing. Selecting also get-or-creates the codebase's TODO project.
import type { Project } from '~/composables/useTracker'

useHead({ title: 'Codebases' })

const { projects, tickets, refresh, updateProject } = useTracker()
const { selectedPath, codebases, refreshCodebases, label, select, unattachedProjects } = useCodebase()

const selecting = ref<string | null>(null)
async function pick(path: string) {
  selecting.value = path
  try {
    await select(path)
  } finally {
    selecting.value = null
  }
}

onMounted(() => {
  refresh().catch(() => {})
  refreshCodebases().catch(() => {})
})

function ticketCount(c: { projects: string[] }): number {
  const keys = new Set(c.projects)
  const ids = new Set(projects.value.filter((p) => keys.has(p.key)).map((p) => p.id))
  return tickets.value.filter((t) => t.projectId && ids.has(t.projectId)).length
}

async function forget(path: string) {
  await $fetch('/api/repos', { method: 'DELETE', query: { path } })
  // Forgetting the codebase you're in leaves nothing selected — the middleware
  // will hold every other page until a new one is picked.
  if (selectedPath.value === path) selectedPath.value = null
  await refreshCodebases()
}

// ── Adding a codebase: browse or type ──
type Probe =
  | { ok: true; path: string; slug: string | null; defaultBranch: string }
  | { ok: false; path: string; error: string }

const typed = ref('')
const probe = ref<Probe | null>(null)
const probing = ref(false)
const browsing = ref(false)
let probeTimer: ReturnType<typeof setTimeout> | undefined

watch(typed, (path) => {
  clearTimeout(probeTimer)
  if (!path.trim()) { probe.value = null; probing.value = false; return }
  probing.value = true
  // Typing a path passes through a lot of invalid prefixes — only ask about
  // the one you stopped on.
  probeTimer = setTimeout(async () => {
    const asked = typed.value
    try {
      const res = await $fetch<Probe>('/api/repos/probe', { query: { path: asked } })
      if (typed.value === asked) probe.value = res
    } catch {
      if (typed.value === asked) probe.value = null
    } finally {
      if (typed.value === asked) probing.value = false
    }
  }, 400)
})
onUnmounted(() => clearTimeout(probeTimer))

async function browse() {
  browsing.value = true
  try {
    const picked = await $fetch<{ path: string | null }>('/api/repos/pick')
    if (picked.path) await pick(picked.path)
  } catch (err: any) {
    // macOS-only; elsewhere (or if osascript is blocked) typing still works.
    probe.value = { ok: false, path: typed.value, error: errorText(err) }
  } finally {
    browsing.value = false
  }
}

function errorText(err: any): string {
  return String(err?.data?.statusMessage ?? err?.data?.message ?? err?.statusMessage ?? err?.message ?? err)
}

// ── Unattached projects — repo blank or pointing nowhere known ──
const attaching = ref<string | null>(null)
async function attach(project: Project, path: string) {
  attaching.value = project.id
  try {
    await updateProject(project.id, { repo: path })
    await refreshCodebases()
  } finally {
    attaching.value = null
  }
}
const attachTargets = computed(() => codebases.value.map((c) => ({ label: label(c), value: c.path })))
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="max-w-3xl py-12">
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-bold">Pick a codebase</h1>
        <p class="mt-1 text-sm text-muted">
          Everything in jTicket — projects, tickets, docs, the TODO list — lives inside a codebase.
        </p>
      </div>

      <!-- Known codebases -->
      <div v-if="codebases.length" class="mb-8 space-y-2">
        <button
          v-for="c in codebases"
          :key="c.path"
          type="button"
          class="group flex w-full items-center gap-3 rounded-lg border border-default bg-elevated/30 px-4 py-3 text-left transition hover:border-primary hover:bg-elevated/60"
          :class="{ 'border-primary': c.path === selectedPath }"
          :disabled="!!selecting"
          @click="pick(c.path)"
        >
          <UIcon
            :name="selecting === c.path ? 'i-lucide-loader-circle' : 'i-lucide-folder-git-2'"
            class="size-5 shrink-0 text-muted group-hover:text-primary"
            :class="{ 'animate-spin': selecting === c.path }"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ label(c) }}</span>
              <UBadge v-if="c.path === selectedPath" color="primary" variant="subtle" size="sm">Current</UBadge>
              <UBadge v-if="!c.exists" color="error" variant="subtle" size="sm" icon="i-lucide-triangle-alert">
                folder missing
              </UBadge>
            </div>
            <p class="truncate font-mono text-xs text-muted">{{ c.path }}</p>
          </div>
          <span class="shrink-0 text-xs text-muted">
            {{ c.projects.length }} project{{ c.projects.length === 1 ? '' : 's' }}
            · {{ ticketCount(c) }} ticket{{ ticketCount(c) === 1 ? '' : 's' }}
          </span>
          <span
            class="shrink-0 rounded-full p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:text-error"
            role="button"
            :aria-label="`Forget ${c.path}`"
            @click.stop="forget(c.path)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </span>
        </button>
      </div>

      <!-- Add one: browse or type -->
      <div class="space-y-3 rounded-lg border border-dashed border-default p-4">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-folder-plus" class="size-4 text-muted" />
          <span class="text-sm font-medium">{{ codebases.length ? 'Add another codebase' : 'Add your first codebase' }}</span>
        </div>
        <div class="flex gap-2">
          <UInput
            v-model="typed"
            placeholder="~/code/my-repo"
            class="flex-1 font-mono text-sm"
            @keydown.enter="probe?.ok && pick(probe.path)"
          />
          <UButton icon="i-lucide-folder-open" color="neutral" variant="outline" :loading="browsing" @click="browse">
            Browse…
          </UButton>
        </div>
        <p v-if="probing" class="text-xs text-muted">Checking…</p>
        <div v-else-if="probe?.ok" class="flex items-center gap-2">
          <p class="flex items-center gap-1.5 text-xs text-success">
            <UIcon name="i-lucide-check" class="size-3.5" />
            <span>{{ probe.slug ?? 'local git repo' }}</span>
            <span class="text-muted">· default branch {{ probe.defaultBranch }}</span>
          </p>
          <UButton size="xs" class="ml-auto" :loading="selecting === probe.path" @click="pick(probe.path)">
            Use this codebase
          </UButton>
        </div>
        <p v-else-if="probe && typed" class="flex items-center gap-1.5 text-xs text-error">
          <UIcon name="i-lucide-triangle-alert" class="size-3.5" />
          {{ probe.error }}: {{ probe.path }}
        </p>
      </div>

      <!-- Projects whose repo points nowhere known — attach them to a codebase
           so they show up in a scope again. -->
      <section v-if="unattachedProjects.length" class="mt-10">
        <div class="mb-2 flex items-center gap-2">
          <UIcon name="i-lucide-unlink" class="size-4 text-muted" />
          <h2 class="text-sm font-semibold">Unattached projects</h2>
          <span class="text-xs text-muted">not part of any codebase — attach to bring them into a scope</span>
        </div>
        <div class="overflow-hidden rounded-lg border border-default">
          <div
            v-for="p in unattachedProjects"
            :key="p.id"
            class="flex flex-wrap items-center gap-2 border-b border-default/60 px-3 py-2 text-sm last:border-0"
          >
            <span class="font-mono text-xs text-muted">{{ p.key }}</span>
            <NuxtLink :to="`/projects/${p.key}`" class="truncate font-medium hover:text-primary">{{ p.title }}</NuxtLink>
            <span v-if="p.repo" class="truncate font-mono text-xs text-dimmed">{{ p.repo }}</span>
            <USelect
              v-if="attachTargets.length"
              :items="attachTargets"
              value-key="value"
              placeholder="Attach to…"
              size="xs"
              class="ml-auto w-48"
              :loading="attaching === p.id"
              @update:model-value="(path: string) => attach(p, path)"
            />
          </div>
        </div>
      </section>
    </UContainer>
  </div>
</template>
