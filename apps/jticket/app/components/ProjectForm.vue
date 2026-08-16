<script setup lang="ts">
// Project create/edit fields, shared by ProjectModal and the tabbed create
// modal. The parent owns the save button (save()/saving/canSave).
import type { Project, ProjectMode } from '~/composables/useTracker'

const props = withDefaults(
  // autofocus is off for the create modal's hidden tabs — see TicketForm.
  defineProps<{ project?: Project | null; autofocus?: boolean }>(),
  { autofocus: true },
)
const emit = defineEmits<{ saved: [] }>()

const { createProject, updateProject } = useTracker()

const form = reactive({ title: '', description: '', mode: 'standard' as ProjectMode, repo: '', integrationBranch: '' })
const saving = ref(false)
const canSave = computed(() => !!form.title.trim())

// ── The repo field ──
// Three ways in, cheapest first: pick one you've used before, browse to it with
// the native folder dialog, or type the path. Whatever lands in the field is
// probed (read-only) so you find out it's the wrong folder here, not later on
// the project page.
interface KnownRepo { path: string; slug: string; defaultBranch: string; exists: boolean; projects: string[] }
type Probe =
  | { ok: true; path: string; slug: string | null; defaultBranch: string }
  | { ok: false; path: string; error: string }

const probe = ref<Probe | null>(null)
const probing = ref(false)
const browsing = ref(false)
let probeTimer: ReturnType<typeof setTimeout> | undefined

const { data: repoList, refresh: refreshRepos } = useFetch<{ repos: KnownRepo[] }>('/api/repos', { lazy: true, server: false })
// The repo already in the field shouldn't take up a suggestion slot.
const recentRepos = computed(() => (repoList.value?.repos ?? []).filter((r) => r.path !== probe.value?.path).slice(0, 8))

watch(() => form.repo, (path) => {
  clearTimeout(probeTimer)
  if (!path.trim()) { probe.value = null; probing.value = false; return }
  probing.value = true
  // Typing a path passes through a lot of invalid prefixes — only ask about the
  // one you stopped on.
  probeTimer = setTimeout(async () => {
    const asked = form.repo
    try {
      const res = await $fetch<Probe>('/api/repos/probe', { query: { path: asked } })
      if (form.repo === asked) probe.value = res
    } catch {
      if (form.repo === asked) probe.value = null
    } finally {
      if (form.repo === asked) probing.value = false
    }
  }, 400)
}, { immediate: true })

onUnmounted(() => clearTimeout(probeTimer))

async function browse() {
  browsing.value = true
  try {
    const picked = await $fetch<{ path: string | null }>('/api/repos/pick')
    if (picked.path) form.repo = picked.path
  } catch (err: any) {
    // macOS-only; elsewhere (or if osascript is blocked) typing still works.
    probe.value = { ok: false, path: form.repo, error: errorText(err) }
  } finally {
    browsing.value = false
  }
}

async function forgetRepo(path: string) {
  await $fetch('/api/repos', { method: 'DELETE', query: { path } })
  await refreshRepos()
}

function repoLabel(r: KnownRepo): string {
  return r.slug || r.path.split('/').filter(Boolean).pop() || r.path
}

function errorText(err: any): string {
  return String(err?.data?.statusMessage ?? err?.data?.message ?? err?.statusMessage ?? err?.message ?? err)
}

// What the project page would name the branch if you cut it there — shown as a
// placeholder so the convention is visible before it exists.
const branchPlaceholder = computed(() =>
  props.project ? `proj/${props.project.key}-${slugForBranch(props.project.title)}` : 'proj/PROJ-1-my-project',
)
function slugForBranch(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
}

const modeOptions = [
  { label: 'Standard — plain tracker', value: 'standard' },
  { label: 'Wayfinder — the description is a map, tickets have a frontier', value: 'wayfinder' },
]

function reset() {
  form.title = props.project?.title ?? ''
  form.description = props.project?.description ?? ''
  form.mode = props.project?.mode ?? 'standard'
  form.repo = props.project?.repo ?? ''
  form.integrationBranch = props.project?.integrationBranch ?? ''
}
reset()

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    // Saving the project remembers the repo path; doing it here as well hands
    // the list the slug we already probed, so the chip reads 'owner/name'
    // straight away instead of after the project page's first GitHub call.
    if (probe.value?.ok) {
      await $fetch('/api/repos', { method: 'POST', body: { path: probe.value.path } }).catch(() => {})
    }
    if (props.project) await updateProject(props.project.id, { ...form })
    else await createProject({ ...form })
    emit('saved')
  } finally {
    saving.value = false
  }
}

defineExpose({ save, reset, saving, canSave })
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Title" required>
      <UInput v-model="form.title" placeholder="Project name" class="w-full" :autofocus="autofocus" />
    </UFormField>
    <UFormField label="Description">
      <UTextarea v-model="form.description" :rows="4" placeholder="What this project covers…" class="w-full" />
    </UFormField>
    <UFormField label="Mode" help="Wayfinder projects treat the description as a map and surface a takeable frontier of tickets.">
      <USelect v-model="form.mode" :items="modeOptions" class="w-full" />
    </UFormField>

    <!-- GitHub link. Optional: with a repo the project view lists the project's
         open PRs and can cut its integration branch. -->
    <div class="space-y-4 border-t border-default pt-4">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-github" class="size-4 text-muted" />
        <span class="text-xs font-semibold uppercase tracking-wide text-muted">GitHub</span>
        <span class="text-xs text-muted">optional</span>
      </div>
      <UFormField label="Repo" help="Path to a local clone — what a review is computed against. '~' is fine.">
        <div class="flex gap-2">
          <UInput v-model="form.repo" placeholder="~/code/my-repo" class="flex-1 font-mono text-sm" />
          <UButton
            icon="i-lucide-folder-open"
            color="neutral"
            variant="outline"
            :loading="browsing"
            @click="browse"
          >
            Browse…
          </UButton>
        </div>
      </UFormField>

      <!-- What that path actually is -->
      <p v-if="probing" class="-mt-2 text-xs text-muted">Checking…</p>
      <p v-else-if="probe?.ok" class="-mt-2 flex items-center gap-1.5 text-xs text-success">
        <UIcon name="i-lucide-check" class="size-3.5" />
        <span>{{ probe.slug ?? 'local git repo' }}</span>
        <span class="text-muted">· default branch {{ probe.defaultBranch }}</span>
      </p>
      <p v-else-if="probe && form.repo" class="-mt-2 flex items-center gap-1.5 text-xs text-error">
        <UIcon name="i-lucide-triangle-alert" class="size-3.5" />
        {{ probe.error }}: {{ probe.path }}
      </p>

      <!-- Repos this tracker has been pointed at before -->
      <div v-if="recentRepos.length" class="-mt-1 flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-muted">Recent</span>
        <UTooltip v-for="r in recentRepos" :key="r.path" :text="r.path">
          <div
            class="group flex items-center gap-1 rounded-full border border-default bg-elevated/40 py-1 pl-2.5 pr-1 text-xs"
            :class="r.exists ? '' : 'opacity-50'"
          >
            <button type="button" class="max-w-52 truncate hover:underline" @click="form.repo = r.path">
              {{ repoLabel(r) }}
            </button>
            <span v-if="r.projects.length" class="font-mono text-[10px] text-muted">{{ r.projects.length }}</span>
            <button
              type="button"
              class="rounded-full p-0.5 text-muted opacity-0 transition group-hover:opacity-100 hover:text-error"
              :aria-label="`Forget ${r.path}`"
              @click="forgetRepo(r.path)"
            >
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </div>
        </UTooltip>
      </div>
      <UFormField
        label="Integration branch"
        help="The branch this project's PRs target. Leave blank to cut or pick one from the project page."
      >
        <UInput v-model="form.integrationBranch" :placeholder="branchPlaceholder" class="w-full font-mono text-sm" />
      </UFormField>
    </div>
  </div>
</template>
