<script setup lang="ts">
// The whole shared document pool — the same 'everything on disk in
// .data/jexplain' that @jsuite/documents mounts here by default. jTicket
// overrides the layer's plain list because it is the one consumer that knows
// something extra about these documents: which project each belongs to, read
// off the projects' attachments. So the pool is grouped rather than flat, and a
// document nothing links still shows, under "Not attached".
//
// This replaces the old /docs pages. Those listed the five DOC-n wrapper
// records; there are no wrappers any more (TICK-138), and the thing they stood
// for — this document belongs to that project — is an attachment now.
//
// It creates and it groups, but it does not delete (TICK-151): jTicket never
// destroys a document out of the shared pool. Being jTicket's own page, it has
// no delete affordance to withhold — where the layer's <DocumentLibrary> would
// need :deletable="false" to reach the same place. /documents/<key> holds the
// same line. See "who may delete out of the pool" in the root README for why.
import { documentPath } from '@jsuite/documents/routes'

useHead({ title: 'Documents' })

const { documents, projects, tickets, refresh } = useTracker()

// A document's labels are its own filing, carried in the shared pool rather
// than on the attachment — so the chip bar is built from every document here,
// not from the projects, and filtering by one narrows every section at once.
const selected = ref<string[]>([])

const allLabels = computed(() => [...new Set(documents.value.flatMap((d) => d.labels))].sort())

const filtered = computed(() =>
  documents.value.filter((d) => selected.value.every((label) => d.labels.includes(label))),
)

function toggle(label: string) {
  selected.value = selected.value.includes(label)
    ? selected.value.filter((l) => l !== label)
    : [...selected.value, label]
}

const grouped = computed(() => {
  const claimed = new Set<string>()
  const sections = projects.value
    .map((project) => {
      // A document belongs to a project by being attached to it *or* to one of
      // its tickets — a spec attached to the ticket that implements it is still
      // that project's document, and filing it under "Not attached" would be
      // the wrong answer to "what has this project written down?".
      const keys = new Set(
        project.attachments.filter((a) => a.type === 'document').map((a) => a.id),
      )
      for (const t of tickets.value) {
        if (t.projectId !== project.id) continue
        for (const a of t.attachments ?? []) if (a.type === 'document') keys.add(a.id)
      }
      // Ordered by the pool, not by attachment order, so a document appears in
      // the same place in every section it lands in.
      const docs = filtered.value.filter((d) => keys.has(d.key))
      for (const d of docs) claimed.add(d.key)
      return { project, docs }
    })
    .filter((s) => s.docs.length)
  return { sections, loose: filtered.value.filter((d) => !claimed.has(d.key)) }
})

const creating = ref(false)
const newTitle = ref('')
const createError = ref('')
async function create() {
  const title = newTitle.value.trim()
  if (!title) return
  createError.value = ''
  try {
    const doc = await $fetch<{ key: string }>('/api/documents', { method: 'POST', body: { title, blocks: [] } })
    creating.value = false
    newTitle.value = ''
    await refresh()
    navigateTo(documentPath(doc.key))
  } catch (err) {
    // Stay open with what they typed — retyping a title because the pool was
    // briefly unreachable is a worse outcome than an inline error.
    createError.value = String((err as { message?: string })?.message ?? err)
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Documents</h1>
          <p class="text-sm text-muted">
            Every document in the shared pool — explainers, specs and debriefs alike, grouped by the
            project that attached them. Local only, never posted anywhere.
          </p>
        </div>
        <UButton icon="i-lucide-file-plus" @click="creating = !creating">New doc</UButton>
      </div>

      <form v-if="creating" class="mb-6" @submit.prevent="create">
        <div class="flex gap-2">
          <UInput v-model="newTitle" placeholder="Document title" class="flex-1" autofocus />
          <UButton type="submit" :disabled="!newTitle.trim()">Create</UButton>
          <UButton color="neutral" variant="ghost" @click="creating = false">Cancel</UButton>
        </div>
        <p v-if="createError" class="mt-2 text-sm text-error">{{ createError }}</p>
      </form>

      <div v-if="allLabels.length" class="mb-6 flex flex-wrap items-center gap-2">
        <DocLabels :labels="allLabels" :active="selected" interactive size="sm" @select="toggle" />
        <UButton
          v-if="selected.length"
          size="xs"
          color="neutral"
          variant="ghost"
          label="Clear"
          @click="selected = []"
        />
      </div>

      <div v-if="!documents.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-file-text" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">No documents yet</p>
          <p class="text-sm text-muted">Write one here, or let a skill post to /api/documents.</p>
        </div>
      </div>

      <div v-else-if="!filtered.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-tag" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">Nothing filed under that</p>
          <p class="text-sm text-muted">No document carries all of: {{ selected.join(', ') }}.</p>
        </div>
        <UButton color="neutral" variant="subtle" @click="selected = []">Clear filter</UButton>
      </div>

      <div v-else class="space-y-10">
        <section v-for="s in grouped.sections" :key="s.project.id">
          <div class="mb-3 flex items-center gap-2">
            <span class="font-mono text-xs text-muted">{{ s.project.key }}</span>
            <h2 class="text-lg font-semibold">{{ s.project.title }}</h2>
            <span class="text-xs text-muted">{{ s.docs.length }} attached</span>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DocCard v-for="d in s.docs" :key="d.key" :doc="d" :project="s.project" />
          </div>
        </section>

        <section v-if="grouped.loose.length">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-folder-x" class="size-4 text-muted" />
            <h2 class="text-lg font-semibold">Not attached</h2>
            <span class="text-xs text-muted">{{ grouped.loose.length }} docs</span>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DocCard v-for="d in grouped.loose" :key="d.key" :doc="d" />
          </div>
        </section>
      </div>
    </UContainer>
  </div>
</template>
