<script setup lang="ts">
// A record's attached artifacts — listed, attachable, detachable, and openable
// *in place*. Shared by the ticket modal and the project page because the two
// want exactly the same thing; only the owner differs.
//
// Opening in place is the point of the section rather than a flourish: a spec
// and the diagram of the thing it specifies are the context you need while
// reading a ticket, and bouncing to another app to see them is what this
// replaces. A document renders through the same <DocumentArticle> jExplain
// uses; a chart renders through <BlockChart>, which is the live, editable
// canvas — an edit here autosaves to the shared pool, same as anywhere else.
// A diff is the exception and stays a link: jDiff computes it from git on
// demand, so there is nothing to embed.
import type { Explainer } from '@jsuite/documents/types'
import type { Attachment, ResolvedAttachment } from '~/composables/useTracker'

const props = withDefaults(
  defineProps<{
    owner: 'tickets' | 'projects'
    ownerId: string
    /** Rendered flat (in a modal) rather than as a page section. */
    compact?: boolean
  }>(),
  { compact: false },
)

const {
  data: attachments,
  refresh,
} = await useFetch<ResolvedAttachment[]>(() => `/api/${props.owner}/${props.ownerId}/attachments`, {
  default: () => [],
})

const refs = computed<Attachment[]>(() => (attachments.value ?? []).map((a) => ({ type: a.type, id: a.id })))

const pickerOpen = ref(false)
const busy = ref('')

async function attach(a: Attachment) {
  busy.value = `${a.type}:${a.id}`
  try {
    await $fetch(`/api/${props.owner}/${props.ownerId}/attachments`, { method: 'POST', body: a })
    await refresh()
    // Newly attached artifacts open straight away — you attached it to look at it.
    expanded.value = `${a.type}:${a.id}`
  } finally {
    busy.value = ''
  }
}

async function detach(a: ResolvedAttachment) {
  busy.value = `${a.type}:${a.id}`
  try {
    // The id travels as a query param, not a path segment: a diff id contains a slash.
    await $fetch(`/api/${props.owner}/${props.ownerId}/attachments`, {
      method: 'DELETE',
      query: { type: a.type, id: a.id },
    })
    if (expanded.value === `${a.type}:${a.id}`) expanded.value = ''
    await refresh()
  } finally {
    busy.value = ''
  }
}

// ── Opening one in place ──
// One at a time: two live Excalidraw canvases on a ticket is a lot of machinery
// for a section that is meant to be glanceable.
const expanded = ref('')
const docContent = ref<Explainer | null>(null)
const docLoading = ref(false)

function keyOf(a: ResolvedAttachment) {
  return `${a.type}:${a.id}`
}

async function toggle(a: ResolvedAttachment) {
  if (a.missing) return
  // A diff lives in jDiff and has nothing to render here.
  if (a.type === 'diff') return void window.open(a.url, '_blank')

  if (expanded.value === keyOf(a)) {
    expanded.value = ''
    return
  }
  expanded.value = keyOf(a)
  if (a.type !== 'document') return

  docContent.value = null
  docLoading.value = true
  try {
    docContent.value = await $fetch<Explainer>(`/api/documents/${a.id}`)
  } catch {
    docContent.value = null
  } finally {
    docLoading.value = false
  }
}

// The one artifact currently open, if it is still in the list — a detach or a
// refresh can take it out from under `expanded`.
const openAttachment = computed(
  () => (attachments.value ?? []).find((a) => keyOf(a) === expanded.value && !a.missing) ?? null,
)

// Where an open artifact's own full-page view lives — both inside jTicket now.
function fullPage(a: ResolvedAttachment) {
  return a.type === 'document' ? `/documents/${a.id}` : `/charts/${a.id}`
}

// Rows or a pill strip, per visitor and in memory. Only on a page — in the
// ticket modal there is no room for a view toggle over a handful of refs.
// Either way the open artifact renders underneath the list, so the choice is
// about scanning the refs, not about what opening one does.
const view = ref<'rows' | 'chips'>('rows')

defineExpose({ refresh })
</script>

<template>
  <section :class="compact ? '' : 'mb-8'">
    <div class="mb-2 flex items-center gap-2">
      <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Attached</h3>
      <span v-if="attachments.length" class="text-xs text-muted">{{ attachments.length }}</span>

      <UFieldGroup v-if="!compact && attachments.length" size="xs" class="ml-auto">
        <UButton
          icon="i-lucide-list"
          :color="view === 'rows' ? 'primary' : 'neutral'"
          :variant="view === 'rows' ? 'solid' : 'outline'"
          @click="view = 'rows'"
        >
          Rows
        </UButton>
        <UButton
          icon="i-lucide-tags"
          :color="view === 'chips' ? 'primary' : 'neutral'"
          :variant="view === 'chips' ? 'solid' : 'outline'"
          @click="view = 'chips'"
        >
          Chips
        </UButton>
      </UFieldGroup>

      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        :class="(compact || !attachments.length) && 'ml-auto'"
        @click="pickerOpen = true"
      >
        Attach
      </UButton>
    </div>

    <p
      v-if="!attachments.length"
      class="rounded-md border border-dashed border-default px-3 py-4 text-center text-sm text-muted"
    >
      Nothing attached. Link a spec, a diagram or a diff and it opens right here.
    </p>

    <!-- Rows: a tight one-line list -->
    <div v-else-if="view === 'rows' || compact" class="overflow-hidden rounded-lg border border-default">
      <div
        v-for="a in attachments"
        :key="keyOf(a)"
        class="flex items-center gap-2 border-b border-default/60 px-3 py-1.5 text-sm last:border-0"
        :class="expanded === keyOf(a) && 'bg-elevated/40'"
      >
        <button
          type="button"
          :disabled="a.missing"
          class="flex min-w-0 flex-1 items-center gap-2 text-left enabled:hover:text-primary disabled:cursor-default"
          @click="toggle(a)"
        >
          <UIcon
            v-if="a.missing || a.type === 'diff'"
            :name="a.type === 'diff' ? 'i-lucide-external-link' : ATTACHMENT_META[a.type].icon"
            class="size-3.5 shrink-0 text-dimmed"
          />
          <UIcon
            v-else
            :name="expanded === keyOf(a) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3.5 shrink-0 text-dimmed"
          />
          <span class="w-24 shrink-0 truncate font-mono text-xs text-muted">{{ a.id }}</span>
          <span class="truncate" :class="a.missing && 'text-dimmed line-through'">{{ a.title }}</span>
        </button>

        <UTooltip v-if="a.missing" :text="a.reason ?? 'the artifact is gone'">
          <UBadge color="error" variant="subtle" size="sm">Missing</UBadge>
        </UTooltip>
        <UBadge v-else color="neutral" variant="subtle" size="sm" class="shrink-0">
          {{ ATTACHMENT_META[a.type].label }}
        </UBadge>
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="busy === keyOf(a)"
          :aria-label="`Detach ${a.title}`"
          @click="detach(a)"
        />
      </div>
    </div>

    <!-- Chips: a wrapping row of pills; hover shows the full title -->
    <div v-else class="flex flex-wrap gap-2">
      <UTooltip
        v-for="a in attachments"
        :key="keyOf(a)"
        :text="a.missing ? `${a.title} — ${a.reason ?? 'missing'}` : a.title"
      >
        <div
          class="flex items-center gap-1.5 rounded-full border border-default bg-elevated/40 py-1 pl-3 pr-1 text-xs"
          :class="[a.missing && 'border-error/40 text-dimmed', expanded === keyOf(a) && 'border-primary/60 bg-elevated/80']"
        >
          <button
            type="button"
            :disabled="a.missing"
            class="flex items-center gap-1.5 enabled:hover:text-primary disabled:cursor-default"
            @click="toggle(a)"
          >
            <UIcon :name="ATTACHMENT_META[a.type].icon" class="size-3 shrink-0 text-muted" />
            <span class="max-w-44 truncate" :class="a.missing && 'line-through'">{{ a.title }}</span>
          </button>
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            :ui="{ base: 'rounded-full p-0.5' }"
            :loading="busy === keyOf(a)"
            :aria-label="`Detach ${a.title}`"
            @click="detach(a)"
          />
        </div>
      </UTooltip>
    </div>

    <!-- The one open artifact, under the list rather than spliced into it, so
         rows and chips both get the same thing in the same place. -->
    <div v-if="openAttachment" class="mt-2 overflow-hidden rounded-lg border border-default">
      <div class="flex items-center gap-2 border-b border-default bg-elevated/40 px-3 py-1.5">
        <UIcon :name="ATTACHMENT_META[openAttachment.type].icon" class="size-3.5 shrink-0 text-muted" />
        <span class="min-w-0 truncate text-xs font-medium text-muted">{{ openAttachment.title }}</span>
        <UButton
          :to="fullPage(openAttachment)"
          icon="i-lucide-maximize-2"
          size="xs"
          color="neutral"
          variant="ghost"
          class="ml-auto shrink-0"
        >
          Open full
        </UButton>
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Close"
          @click="expanded = ''"
        />
      </div>

      <!-- A document: the same reading surface jExplain gives it. The article
           column scrolls inside a bounded flex region, so it needs a
           `flex min-h-0` parent with a real height, not an auto one. -->
      <div v-if="openAttachment.type === 'document'" class="flex h-[60vh] min-h-0">
        <div v-if="docLoading" class="flex-1 py-16 text-center text-sm text-muted">Loading…</div>
        <DocumentArticle v-else-if="docContent?.blocks?.length" :doc="docContent" />
        <p v-else class="flex-1 py-16 text-center text-sm text-muted">
          This document has no content yet.
        </p>
      </div>

      <!-- A chart: the live canvas, autosaving to the shared pool -->
      <div v-else class="p-3">
        <BlockChart
          :block="{ id: keyOf(openAttachment), type: 'chart', chartKey: openAttachment.id, title: openAttachment.title, height: 420 }"
        />
      </div>
    </div>

    <AttachmentPicker v-model:open="pickerOpen" :attached="refs" @attach="attach" />
  </section>
</template>
