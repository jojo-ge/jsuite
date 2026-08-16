<script setup lang="ts">
// One project as a card on the projects grid: key, title, description preview,
// ticket count and the four-state progress bar. Finished projects (every
// ticket done) render dimmed — the grid sinks them to the bottom.
import type { Project, Ticket } from '#shared/types/tracker'

defineProps<{
  project: Project
  tickets: Ticket[]
  // Every ticket in the tracker, so blocked-by edges resolve across projects.
  allTickets: Ticket[]
  done?: boolean
}>()
defineEmits<{ edit: [project: Project]; delete: [project: Project] }>()
</script>

<template>
  <NuxtLink
    :to="`/projects/${project.key}`"
    class="group flex flex-col gap-3 rounded-lg border border-default bg-elevated/30 p-4 transition hover:border-primary hover:bg-elevated/60"
    :class="done && 'opacity-60 hover:opacity-100'"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="font-mono text-xs text-muted">{{ project.key }}</span>
        <UBadge v-if="done" color="success" variant="subtle" size="sm">Done</UBadge>
        <UBadge v-else color="secondary" variant="subtle" size="sm">Project</UBadge>
      </div>
      <div class="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
        <UButton
          icon="i-lucide-pencil"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Edit project"
          @click.prevent="$emit('edit', project)"
        />
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="error"
          variant="ghost"
          aria-label="Delete project"
          @click.prevent="$emit('delete', project)"
        />
      </div>
    </div>

    <div>
      <h2 class="text-lg font-semibold group-hover:text-primary">{{ project.title }}</h2>
      <!-- The whole card is a link, so no nested markup here — plain-text preview only. -->
      <p v-if="project.description" class="mt-1 line-clamp-2 text-sm text-muted">{{ markdownPreview(project.description) }}</p>
    </div>

    <div class="mt-auto space-y-2 pt-2">
      <div class="flex items-center gap-3 text-xs text-muted">
        <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-ticket" class="size-3.5" />{{ tickets.length }} tickets</span>
      </div>
      <TicketProgress :tickets="tickets" :all-tickets="allTickets" legend />
    </div>
  </NuxtLink>
</template>
