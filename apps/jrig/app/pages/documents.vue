<script setup lang="ts">
// Raw-JSON document browser: the M3 testbed for the save/sync loop and a
// permanently useful escape hatch (inspect or hand-fix any document with live
// validation). The studio (M4) reuses the same sync composable and bar.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type { Issue } from '~~/rig/validator'

import { validateDocument } from '~~/rig/validator'
import StudioSyncBar from '~~/studio/StudioSyncBar.vue'
import { useDocumentSync } from '~~/studio/composables/useDocumentSync'

useHead({ title: 'Documents' })

const toast = useToast()

const names = ref<string[]>([])
const draft = ref('')

const sync = useDocumentSync({
  onApplied: (doc) => {
    draft.value = doc.content
  },
  onStatus: message => toast.add({ title: message, duration: 2500 }),
})

const issues = computed<Issue[]>(() => {
  if (!sync.name.value) {
    return []
  }
  try {
    return validateDocument(JSON.parse(draft.value))
  }
  catch (error) {
    return [{ level: 'error', code: 'json', path: '', message: (error as Error).message }]
  }
})

const refreshList = async () => {
  const list = await $fetch<{ documents: { name: string }[] }>('/api/rig/documents')
  names.value = list.documents.map(entry => entry.name)
}

const openDocument = (name: string) => void sync.open(name)

const onInput = () => sync.markDirty()

const save = () => void sync.save(draft.value)

const onKeyDown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    save()
  }
}

onMounted(() => {
  void refreshList()
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4 p-6">
    <div class="flex items-center gap-4">
      <h1 class="text-xl font-semibold">Documents</h1>
      <span class="text-sm text-muted">.data/jrig/documents — raw JSON, live validation, mtime-fenced saves</span>
      <UButton to="/" variant="ghost" size="sm" icon="i-lucide-house" class="ms-auto">Home</UButton>
    </div>

    <div class="flex gap-4">
      <aside class="w-56 shrink-0 space-y-1">
        <UButton
          v-for="name in names"
          :key="name"
          block
          size="xs"
          :variant="name === sync.name.value ? 'soft' : 'ghost'"
          class="justify-start font-mono"
          @click="openDocument(name)"
        >
          {{ name }}
        </UButton>
      </aside>

      <section class="min-w-0 flex-1 space-y-3">
        <StudioSyncBar
          :name="sync.name.value"
          :dirty="sync.dirty.value"
          :conflict="sync.conflict.value"
          :issues="issues"
          @save="save"
          @discard-mine="sync.discardMine()"
          @keep-mine="sync.keepMine()"
          @overwrite="sync.overwrite(draft)"
        />
        <textarea
          v-model="draft"
          class="h-[70vh] w-full rounded-lg border border-default bg-elevated p-3 font-mono text-xs"
          spellcheck="false"
          :placeholder="sync.name.value ? '' : 'Pick a document'"
          @input="onInput"
        />
      </section>
    </div>
  </div>
</template>
