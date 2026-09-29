<script setup lang="ts">
// One project on the projects page, in one of two shapes:
//   card — the top three of your order: full title, the flow-state bar with
//          its legend, what's running, when it last moved.
//   row  — everything below: one line with the same facts, squeezed.
// Neither shows the description — that lives on the project's Overview tab.
// The ⋮⋮ handle is where a drag starts (the page arms the drag on pointerdown
// there, so a click anywhere else still opens the project); Alt+↑/↓ on it
// moves the project one place. Hide parks it in the Project backlog.
import type { Project, Ticket } from '~/composables/useTracker'
import { lastActivity, shortAge } from '~/utils/projectOrder'

const props = defineProps<{
  project: Project
  tickets: Ticket[]
  // Every ticket in the tracker, so blocked-by edges resolve across projects.
  allTickets: Ticket[]
  variant: 'card' | 'row'
  // Finished — dimmed, no handle, no hide (done projects have their own section).
  done?: boolean
  // Reorderable — shows the ⋮⋮ handle.
  sortable?: boolean
}>()
const emit = defineEmits<{
  edit: [project: Project]
  delete: [project: Project]
  hide: [project: Project]
  unhide: [project: Project]
  move: [project: Project, delta: -1 | 1]
}>()

const MODE_BADGE: Partial<Record<Project['mode'], { label: string; color: 'primary' | 'success' | 'warning' | 'info' | 'error'; icon: string }>> = {
  wayfinder: { label: 'Wayfinder', color: 'primary', icon: 'i-lucide-compass' },
  jmap: { label: 'jMap', color: 'success', icon: 'i-lucide-map' },
  todo: { label: 'TODO list', color: 'warning', icon: 'i-lucide-list-todo' },
  architect: { label: 'Architect', color: 'info', icon: 'i-lucide-drafting-compass' },
  predeploy: { label: 'Predeploy', color: 'error', icon: 'i-lucide-bug' },
}
const modeBadge = computed(() => MODE_BADGE[props.project.mode] ?? null)

const running = computed(() => props.tickets.filter((t) => t.status === 'in_progress').length)
const finished = computed(() => props.tickets.filter((t) => isFinished(t.status)).length)
const autoLoop = computed(() => (props.project.auto?.enabled ? props.project.auto.loop : null))
const lastMoved = computed(() => lastActivity(props.tickets))
const age = computed(() => shortAge(lastMoved.value))

function onHandleKey(e: KeyboardEvent) {
  if (!e.altKey) return
  if (e.key === 'ArrowUp') { e.preventDefault(); emit('move', props.project, -1) }
  if (e.key === 'ArrowDown') { e.preventDefault(); emit('move', props.project, 1) }
}
</script>

<template>
  <!-- draggable=false: a link drags as a URL by default, which would beat the
       wrapper's own drag. The page's wrapper owns dragging. -->
  <NuxtLink
    :to="`/projects/${project.key}`"
    draggable="false"
    class="group flex transition"
    :class="[
      variant === 'card'
        ? 'flex-col gap-2.5 rounded-lg border border-default bg-elevated/40 p-4 hover:border-primary hover:bg-elevated/70'
        : 'items-center gap-2.5 px-2 py-1.5 hover:bg-elevated/50',
      done && 'opacity-60 hover:opacity-100',
    ]"
  >
    <!-- Card: header line — handle, key, mode, actions -->
    <div v-if="variant === 'card'" class="flex items-center gap-2">
      <span
        v-if="sortable"
        class="drag-handle -ml-1 cursor-grab rounded px-0.5 text-dimmed hover:text-default focus-visible:outline-2 focus-visible:outline-primary"
        role="button"
        tabindex="0"
        :aria-label="`Drag ${project.key} to reorder — Alt+↑/↓ moves it`"
        @click.prevent
        @keydown="onHandleKey"
      >
        <UIcon name="i-lucide-grip-vertical" class="size-4" />
      </span>
      <span class="font-mono text-xs text-muted">{{ project.key }}</span>
      <UBadge v-if="modeBadge" :color="modeBadge.color" variant="subtle" size="sm" :icon="modeBadge.icon">{{ modeBadge.label }}</UBadge>
      <div class="ml-auto flex items-center gap-0.5">
        <div class="flex gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" aria-label="Edit project" @click.prevent="emit('edit', project)" />
          <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" aria-label="Delete project" @click.prevent="emit('delete', project)" />
        </div>
        <UButton
          v-if="!done"
          :icon="project.hidden ? 'i-lucide-eye' : 'i-lucide-eye-off'"
          size="xs"
          color="neutral"
          variant="ghost"
          @click.prevent="emit(project.hidden ? 'unhide' : 'hide', project)"
        >
          {{ project.hidden ? 'Unhide' : 'Hide' }}
        </UButton>
      </div>
    </div>

    <!-- Row: handle + key + mode lead the line -->
    <template v-else>
      <span
        v-if="sortable"
        class="drag-handle cursor-grab rounded text-dimmed hover:text-default focus-visible:outline-2 focus-visible:outline-primary"
        role="button"
        tabindex="0"
        :aria-label="`Drag ${project.key} to reorder — Alt+↑/↓ moves it`"
        @click.prevent
        @keydown="onHandleKey"
      >
        <UIcon name="i-lucide-grip-vertical" class="size-4" />
      </span>
      <span v-else class="w-4 shrink-0" />
      <span class="w-16 shrink-0 font-mono text-xs text-muted">{{ project.key }}</span>
      <UBadge v-if="modeBadge" :color="modeBadge.color" variant="subtle" size="sm" class="shrink-0">{{ modeBadge.label }}</UBadge>
    </template>

    <h2
      class="font-semibold group-hover:text-primary"
      :class="variant === 'card' ? 'text-lg text-balance' : 'min-w-0 flex-1 truncate text-sm'"
      :title="variant === 'row' ? project.title : undefined"
    >
      {{ project.title }}
    </h2>

    <!-- What's happening: the auto loop, running tickets -->
    <div class="flex shrink-0 items-center gap-1.5" :class="variant === 'card' && 'order-last'">
      <UBadge v-if="autoLoop" color="success" variant="subtle" size="sm" icon="i-lucide-infinity">loop {{ autoLoop }}</UBadge>
      <UBadge v-if="running" color="info" variant="subtle" size="sm" icon="i-lucide-loader">{{ running }} running</UBadge>
      <template v-if="variant === 'card'">
        <span class="text-xs text-muted">{{ finished }}/{{ tickets.length }} tickets done</span>
      </template>
      <span
        v-if="variant === 'card'"
        class="ml-auto text-xs text-muted"
        :title="lastMoved ? `Last ticket change ${lastMoved.slice(0, 10)}` : undefined"
      >
        {{ lastMoved ? (age === 'today' ? 'active today' : `active ${age} ago`) : 'no tickets yet' }}
      </span>
    </div>

    <!-- Progress: the full bar + legend on a card, a small bar on a row -->
    <TicketProgress
      v-if="variant === 'card'"
      :tickets="tickets"
      :all-tickets="allTickets"
      :project="project"
      legend
    />
    <template v-else>
      <TicketProgress :tickets="tickets" :all-tickets="allTickets" :project="project" class="w-20 shrink-0" />
      <span class="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-muted">{{ finished }}/{{ tickets.length }}</span>
      <span
        class="w-10 shrink-0 text-right text-xs text-muted"
        :title="lastMoved ? `Last ticket change ${lastMoved.slice(0, 10)}` : 'No tickets yet'"
      >
        {{ age }}
      </span>
      <div class="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" aria-label="Edit project" @click.prevent="emit('edit', project)" />
        <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" aria-label="Delete project" @click.prevent="emit('delete', project)" />
      </div>
      <UButton
        v-if="!done"
        :icon="project.hidden ? 'i-lucide-eye' : 'i-lucide-eye-off'"
        size="xs"
        color="neutral"
        variant="ghost"
        class="shrink-0"
        @click.prevent="emit(project.hidden ? 'unhide' : 'hide', project)"
      >
        {{ project.hidden ? 'Unhide' : 'Hide' }}
      </UButton>
    </template>
  </NuxtLink>
</template>
