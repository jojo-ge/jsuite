<script setup lang="ts">
// The codebase's TODO list — the board renders this instead of TicketBoard for
// the todo-mode project. A todo is a lightweight ticket: one human-written
// line, added inline, ticked done inline, and exercised with Grill (a herdr
// terminal interview whose decisions land back in the ticket's resolution).
import type { Project, Ticket } from '~/composables/useTracker'

const props = defineProps<{ project: Project; tickets: Ticket[] }>()

const { createTicket, updateTicket } = useTracker()
const { openEditTicket, onDeleteTicket } = useTrackerModals()
const { herdrUp, grilling, grillTicket, copied, copyCommand } = useHerdrDispatch()

const byKey = (a: Ticket, b: Ticket) => {
  const n = (k: string) => Number(k.split('-').pop()) || 0
  return n(a.key) - n(b.key)
}
const open = computed(() => props.tickets.filter((t) => !isFinished(t.status)).sort(byKey))
const done = computed(() => props.tickets.filter((t) => isFinished(t.status)).sort(byKey))
const showDone = ref(false)

// Quick-add: title only — a todo is one line, everything else comes later
// (the full modal is a click on the row).
const newTitle = ref('')
const adding = ref(false)
async function add() {
  const title = newTitle.value.trim()
  if (!title || adding.value) return
  adding.value = true
  try {
    await createTicket({ title, projectId: props.project.id, type: 'AFK' })
    newTitle.value = ''
  } finally {
    adding.value = false
  }
}

const toggling = ref<string | null>(null)
async function toggle(t: Ticket) {
  toggling.value = t.id
  try {
    await updateTicket(t.id, { status: isFinished(t.status) ? 'todo' : 'done' })
  } finally {
    toggling.value = null
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- Quick-add -->
    <form class="flex gap-2" @submit.prevent="add">
      <UInput
        v-model="newTitle"
        icon="i-lucide-plus"
        placeholder="Add a todo — one line, Enter to save"
        class="flex-1"
        :disabled="adding"
      />
      <UButton type="submit" variant="soft" :loading="adding" :disabled="!newTitle.trim()">Add</UButton>
    </form>

    <!-- Open todos -->
    <ul v-if="open.length" class="divide-y divide-default overflow-hidden rounded-lg border border-default">
      <li
        v-for="t in open"
        :key="t.id"
        class="group flex items-center gap-3 bg-elevated/20 px-3 py-2 transition hover:bg-elevated/60"
      >
        <UCheckbox
          :model-value="false"
          :disabled="toggling === t.id"
          :aria-label="`Mark ${t.key} done`"
          @update:model-value="toggle(t)"
        />
        <button type="button" class="min-w-0 flex-1 text-left" @click="openEditTicket(t)">
          <span class="mr-2 font-mono text-xs text-muted">{{ t.key }}</span>
          <span class="text-sm">{{ t.title }}</span>
        </button>
        <!-- A grilled todo carries its decisions in the resolution. -->
        <UTooltip v-if="t.resolution" text="Grilled — the decisions are in the ticket's resolution">
          <UIcon name="i-lucide-messages-square" class="size-4 shrink-0 text-success" />
        </UTooltip>
        <div class="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <UButton
            :icon="copied === t.id ? 'i-lucide-check' : 'i-lucide-clipboard'"
            :color="copied === t.id ? 'success' : 'neutral'"
            variant="ghost"
            size="xs"
            :aria-label="`Copy the grilling prompt for ${t.key}`"
            @click="copyCommand(t, 'todo')"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="`Delete ${t.key}`"
            @click="onDeleteTicket(t)"
          />
        </div>
        <UTooltip :text="herdrUp ? 'Grill this todo — an interview in its own herdr tab' : 'herdr is not running — copy the prompt instead'">
          <UButton
            icon="i-lucide-flame"
            color="warning"
            variant="soft"
            size="xs"
            :disabled="!herdrUp"
            :loading="grilling === t.id"
            :aria-label="`Grill ${t.key}`"
            @click="grillTicket(t)"
          >
            Grill
          </UButton>
        </UTooltip>
      </li>
    </ul>
    <p v-else class="rounded-lg border border-dashed border-default px-4 py-6 text-center text-sm text-muted">
      No todos yet — write the first one above.
    </p>

    <!-- Done, folded away -->
    <div v-if="done.length">
      <UButton
        :icon="showDone ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        variant="ghost"
        color="neutral"
        size="xs"
        @click="showDone = !showDone"
      >
        {{ done.length }} done
      </UButton>
      <ul v-show="showDone" class="mt-1 divide-y divide-default overflow-hidden rounded-lg border border-default">
        <li
          v-for="t in done"
          :key="t.id"
          class="group flex items-center gap-3 bg-elevated/10 px-3 py-2"
        >
          <UCheckbox
            :model-value="true"
            :disabled="toggling === t.id"
            :aria-label="`Reopen ${t.key}`"
            @update:model-value="toggle(t)"
          />
          <button type="button" class="min-w-0 flex-1 text-left" @click="openEditTicket(t)">
            <span class="mr-2 font-mono text-xs text-dimmed">{{ t.key }}</span>
            <span class="text-sm text-muted line-through">{{ t.title }}</span>
          </button>
          <UTooltip v-if="t.resolution" text="Grilled — the decisions are in the ticket's resolution">
            <UIcon name="i-lucide-messages-square" class="size-4 shrink-0 text-success" />
          </UTooltip>
        </li>
      </ul>
    </div>
  </div>
</template>
