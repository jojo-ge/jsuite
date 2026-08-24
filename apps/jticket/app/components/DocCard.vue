<script setup lang="ts">
import type { Doc } from '~/composables/useTracker'

const props = defineProps<{ doc: Doc }>()

const { projects } = useTracker()
const project = computed(() => projects.value.find((p) => p.id === props.doc.projectId))
const status = computed(() => DOC_STATUS_META[props.doc.status])
// Peer-owned = the other side of a shared project's doc — badged with the
// peer's name; the API refuses writes on it.
const peerName = computed(() => peerNameOf(props.doc, project.value))
</script>

<template>
  <UCard
    :ui="{ body: 'p-4 sm:p-4' }"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary/40"
    @click="navigateTo(`/docs/${doc.key}`)"
  >
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-file-text" class="size-4 shrink-0 text-muted" />
      <span class="font-mono text-xs text-muted">{{ doc.key }}</span>
      <UBadge :color="status.color" variant="subtle" size="sm">{{ status.label }}</UBadge>
      <UBadge v-if="peerName" color="secondary" variant="subtle" size="sm" icon="i-lucide-users-round">
        {{ peerName }}
      </UBadge>
      <UBadge v-if="project" color="secondary" variant="outline" size="sm" class="font-mono">
        {{ project.key }}
      </UBadge>
    </div>
    <p class="mt-1 truncate font-medium">{{ doc.title }}</p>
    <div v-if="doc.labels.length" class="mt-2 flex flex-wrap gap-1">
      <UBadge v-for="l in doc.labels" :key="l" color="neutral" variant="outline" size="sm">{{ l }}</UBadge>
    </div>
  </UCard>
</template>
