<script setup lang="ts">
// The project page's Prompts panel: what this project's tickets actually say
// when they're handed to an agent. Folded closed by default — most projects
// fire the defaults forever, and the page is for the tickets.
import type { Project } from '~/composables/useTracker'

const props = defineProps<{ project: Project }>()

const open = ref(false)
const count = computed(() => Object.keys(props.project.prompts ?? {}).length)
</script>

<template>
  <UCard>
    <template #header>
      <button
        type="button"
        class="flex w-full items-center gap-3 text-left"
        :aria-expanded="open"
        @click="open = !open"
      >
        <UIcon :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 shrink-0 text-dimmed" />
        <UIcon name="i-lucide-message-square-code" class="size-4 shrink-0 text-muted" />
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold">Prompts</h2>
          <p class="truncate text-xs text-muted">
            What {{ project.key }}'s hand-offs say when a ticket goes to an agent.
          </p>
        </div>
        <UBadge v-if="count" color="primary" variant="subtle" size="sm">
          {{ count }} overridden
        </UBadge>
        <UBadge v-else color="neutral" variant="subtle" size="sm">Defaults</UBadge>
      </button>
    </template>

    <div v-if="open" class="space-y-4">
      <p class="text-sm text-muted">
        Each hand-off falls through until something answers: this project → the
        <NuxtLink to="/prompts" class="text-primary hover:underline">global defaults</NuxtLink> → the built-in text.
        A single ticket can go further still — open it and use its own prompt box.
      </p>
      <PromptEditor scope="project" :project="project" />
    </div>
  </UCard>
</template>
