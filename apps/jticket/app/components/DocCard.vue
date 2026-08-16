<script setup lang="ts">
import type { ExplainerMeta } from '@jsuite/documents/types'
import type { Project } from '~/composables/useTracker'

// A document in the shared pool. `project` is passed in by whoever grouped it —
// the document itself knows nothing about projects; the link lives on the
// project's attachments.
defineProps<{ doc: ExplainerMeta; project?: Project }>()
</script>

<template>
  <UCard
    :ui="{ body: 'p-4 sm:p-4' }"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary/40"
    @click="navigateTo(`/documents/${doc.key}`)"
  >
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-file-text" class="size-4 shrink-0 text-muted" />
      <span class="truncate font-mono text-xs text-muted">{{ doc.key }}</span>
      <UBadge v-if="project" color="secondary" variant="outline" size="sm" class="font-mono">
        {{ project.key }}
      </UBadge>
    </div>
    <p class="mt-1 truncate font-medium">{{ doc.title }}</p>
    <p v-if="doc.subtitle" class="mt-0.5 truncate text-sm text-muted">{{ doc.subtitle }}</p>
    <div class="mt-2 flex flex-wrap gap-2 text-xs text-dimmed">
      <span>{{ doc.blockCount }} blocks</span>
      <span v-if="doc.chartCount">· {{ doc.chartCount }} charts</span>
      <span v-if="doc.noteCount">· {{ doc.noteCount }} notes</span>
    </div>
  </UCard>
</template>
