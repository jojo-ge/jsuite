<script setup lang="ts">
// The mark switcher: every jTicket mark there is to try (app/utils/logos.ts),
// and a click puts one on — the sidebar and the tab icon change at once, and
// the pick is remembered in this browser (useLogo). Nothing is stored on the
// server: it is a preference of the person looking, like the theme.
import type { LogoMark } from '~/utils/logos'

useHead({ title: 'Logo' })

const { id, mark, select } = useLogo()

// Narrow a long gallery by name or by what a mark stands for.
const query = ref('')
const matches = (m: LogoMark) => {
  const q = query.value.trim().toLowerCase()
  return !q || m.name.toLowerCase().includes(q) || m.note.toLowerCase().includes(q)
}

const GROUPS: { key: LogoMark['group']; title: string; hint: string }[] = [
  { key: 'original', title: 'From the repaint', hint: 'The five marks drawn alongside the Ink theme.' },
  { key: 'ticket', title: 'The j and a ticket', hint: 'Ticket j, taken further: the j cut from a ticket, hung on one, built out of them.' },
  { key: 'j', title: 'Around the J', hint: 'The letter itself: cut, framed, dotted differently, or turned into something else.' },
  { key: 'more', title: 'More to try', hint: 'Marks named after things jTicket does.' },
]
const groups = computed(() =>
  GROUPS.map((g) => ({ ...g, marks: LOGO_MARKS.filter((m) => m.group === g.key && matches(m)) })).filter(
    (g) => g.marks.length,
  ),
)
</script>

<template>
  <div class="min-h-screen bg-default">
    <UContainer class="space-y-8 py-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold">Logo</h1>
          <p class="mt-1 max-w-2xl text-sm text-muted">
            Pick the mark jTicket wears, from {{ LOGO_MARKS.length }}. It changes the sidebar and the tab
            icon straight away and is remembered in this browser.
          </p>
        </div>
        <!-- The pick, at the three sizes it is actually seen: beside the
             wordmark, in a bookmark, in a tab. -->
        <div class="flex items-center gap-4 rounded-lg border border-default px-4 py-3">
          <AppLogo :size="40" label="" />
          <AppLogo :size="24" label="" />
          <AppLogo :size="16" label="" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">{{ mark.name }}</p>
            <p class="text-xs text-muted">{{ mark.note }}</p>
          </div>
        </div>
      </div>

      <UInput
        v-model="query"
        icon="i-lucide-search"
        placeholder="Filter marks: j, hook, review…"
        aria-label="Filter marks"
        class="w-full max-w-sm"
      />

      <p v-if="!groups.length" class="py-10 text-sm text-muted">
        No mark matches “{{ query }}”.
      </p>

      <section v-for="g in groups" :key="g.key" :aria-labelledby="`logo-group-${g.key}`">
        <h2 :id="`logo-group-${g.key}`" class="text-sm font-semibold text-highlighted">
          {{ g.title }} <span class="font-normal text-muted">· {{ g.marks.length }}</span>
        </h2>
        <p class="mt-0.5 text-sm text-muted">{{ g.hint }}</p>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          <button
            v-for="m in g.marks"
            :key="m.id"
            type="button"
            class="group relative flex flex-col items-start gap-3 rounded-lg border bg-default p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="m.id === id ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-accented hover:bg-elevated/50'"
            :aria-pressed="m.id === id"
            @click="select(m.id)"
          >
            <span class="flex w-full items-end justify-between">
              <AppLogo :size="56" :mark="m.id" label="" />
              <AppLogo :size="16" :mark="m.id" label="" />
            </span>
            <span class="min-w-0">
              <span class="block text-sm font-medium text-highlighted">{{ m.name }}</span>
              <span class="block text-xs text-muted">{{ m.note }}</span>
            </span>
            <UBadge
              v-if="m.id === id"
              color="primary"
              variant="solid"
              size="sm"
              icon="i-lucide-check"
              class="absolute right-3 top-3"
            >
              In use
            </UBadge>
          </button>
        </div>
      </section>
    </UContainer>
  </div>
</template>
