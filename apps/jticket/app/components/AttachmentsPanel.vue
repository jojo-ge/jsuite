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
// A diff renders through <DiffReviewCard>, the review at a glance: the full
// review screens are screens, and what belongs on a ticket is the verdict plus
// the way through to them (`url`, which now points at jTicket's own /diffs).
import type { Explainer } from '@jsuite/documents/types'
import type { Attachment, ResolvedAttachment } from '~/composables/useTracker'

const props = withDefaults(
  defineProps<{
    owner: 'tickets' | 'projects'
    ownerId: string
    /** Rendered flat (in a modal) rather than as a page section. */
    compact?: boolean
    /**
     * How a review opened from here should offer to get back to this record.
     * The owner passes it because only the owner knows what to call itself and
     * which page it is showing on; the layer just renders it in the review's
     * bar. Nothing else here needs it — a document or a chart opens on a
     * jTicket page that already wears the board's header.
     */
    from?: DiffFrom | null
  }>(),
  { compact: false, from: null },
)

const {
  data: attachments,
  refresh,
} = await useFetch<ResolvedAttachment[]>(() => `/api/${props.owner}/${props.ownerId}/attachments`, {
  default: () => [],
})

const refs = computed<Attachment[]>(() => (attachments.value ?? []).map((a) => ({ type: a.type, id: a.id })))

// `keyOf` is the shared `type:id` identity — the key for lists, for which row
// is open, and for which row is mid-request.
const keyOf = attachmentKey

const pickerOpen = ref(false)
const busy = ref('')

async function attach(a: Attachment) {
  await $fetch(`/api/${props.owner}/${props.ownerId}/attachments`, { method: 'POST', body: a })
  await refresh()
  // Newly attached artifacts open straight away — you attached it to look at it.
  expanded.value = keyOf(a)
}

// Nothing else in this component loads a document body: `expanded` is the only
// input, and the watcher below is the only loader. Setting `expanded` from two
// places (a click, and attaching) with the fetch hung off just one of them is
// exactly how a freshly attached document ends up showing the *previous* one.

async function detach(a: ResolvedAttachment) {
  busy.value = keyOf(a)
  try {
    // The id travels as a query param, not a path segment: a diff id contains a slash.
    await $fetch(`/api/${props.owner}/${props.ownerId}/attachments`, {
      method: 'DELETE',
      query: { type: a.type, id: a.id },
    })
    if (expanded.value === keyOf(a)) expanded.value = ''
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

function toggle(a: ResolvedAttachment) {
  if (a.missing) return
  expanded.value = expanded.value === keyOf(a) ? '' : keyOf(a)
}

// The one artifact currently open, if it is still in the list — a detach or a
// refresh can take it out from under `expanded`.
const openAttachment = computed(
  () => (attachments.value ?? []).find((a) => keyOf(a) === expanded.value && !a.missing) ?? null,
)

// "Open full" goes to the URL the server resolved — one place knows where an
// artifact of each type lives — with the way back folded in by the layer that
// owns review URLs. Only a destination without jTicket's header needs one, and
// which types those are is ATTACHMENT_META's to say.
const openUrl = computed(() => {
  const a = openAttachment.value
  if (!a?.url) return ''
  return ATTACHMENT_META[a.type].hostChrome ? a.url : withFromUrl(a.url, props.from)
})

// A chart embeds its own fetch (<BlockChart> reads the pool itself); a document
// needs its blocks here, so whatever opens one, the body follows it.
watch(
  openAttachment,
  async (a) => {
    if (a?.type !== 'document') {
      docContent.value = null
      return
    }
    docContent.value = null
    docLoading.value = true
    try {
      docContent.value = await $fetch<Explainer>(`/api/documents/${a.id}`)
    } catch {
      docContent.value = null
    } finally {
      docLoading.value = false
    }
  },
  { immediate: true },
)

// Rows or a pill strip, per visitor and in memory. Only on a page — in the
// ticket modal there is no room for a view toggle over a handful of refs.
// Either way the open artifact renders underneath the list, so the choice is
// about scanning the refs, not about what opening one does.
const view = ref<'rows' | 'chips'>('rows')
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
            v-if="a.missing"
            :name="ATTACHMENT_META[a.type].icon"
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
          :to="openUrl"
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

      <!-- A diff: the review at a glance, read against the owning record's
           repo. `repo` is only ever set on a diff the server could resolve. -->
      <div v-else-if="openAttachment.type === 'diff'" class="p-3">
        <DiffReviewCard :repo="openAttachment.repo ?? ''" :id="openAttachment.id" :from="from" />
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
