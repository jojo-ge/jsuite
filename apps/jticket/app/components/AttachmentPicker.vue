<script setup lang="ts">
// Choosing an artifact to attach. The three types are picked in genuinely
// different ways, which is why this is a tabbed dialog rather than one list:
// a document or a chart is *chosen from a pool that already exists*, while a
// diff is *named* — it is computed from a repo on demand, so there is no list
// to pick from and never will be.
import type { ExplainerMeta } from '@jsuite/documents/types'
import type { Attachment, AttachmentType } from '~/composables/useTracker'

const props = defineProps<{
  open: boolean
  /** Already-linked refs — shown as attached rather than hidden, so a second
      click is a no-op you can see coming instead of a silent one. */
  attached: Attachment[]
}>()
const emit = defineEmits<{ 'update:open': [boolean]; attach: [Attachment] }>()

const tab = ref<AttachmentType>('document')
const query = ref('')

// Both pools, lazily: the dialog is opened far less often than the page it
// sits on, so there is no reason for a ticket render to pay for these.
const { data: documents, refresh: refreshDocs } = await useFetch<ExplainerMeta[]>('/api/documents', {
  immediate: false,
  default: () => [],
})
const { data: charts, refresh: refreshCharts } = await useFetch<{ key: string; title: string }[]>('/api/charts', {
  immediate: false,
  default: () => [],
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    query.value = ''
    refreshDocs()
    refreshCharts()
  },
)

function isAttached(type: AttachmentType, id: string) {
  return props.attached.some((a) => a.type === type && a.id === id)
}

function matches(...fields: string[]) {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => f.toLowerCase().includes(q))
}

// Both pools reduce to the same three fields the list needs, so the list is
// written once. The pools genuinely differ — a document knows how many blocks
// it has, a chart knows nothing of the sort — and `note` is where that goes.
interface Candidate {
  id: string
  title: string
  note: string
}

const pool = computed<Candidate[]>(() =>
  tab.value === 'document'
    ? (documents.value ?? []).map((d) => ({
        id: d.key,
        title: d.title || d.key,
        note: `${d.blockCount} blocks`,
      }))
    : (charts.value ?? []).map((c) => ({ id: c.key, title: c.title || c.key, note: '' })),
)
const results = computed(() => pool.value.filter((c) => matches(c.id, c.title)))

function pick(type: AttachmentType, id: string) {
  if (isAttached(type, id)) return
  emit('attach', { type, id })
  emit('update:open', false)
}

// A diff ref is a review target, not a pool key: a bare number is a PR,
// `branch/<name>` is a branch. Accept a pasted PR URL or a `#123` too, since
// that is what a human actually has on the clipboard.
const diffRef = ref('')
const diffId = computed(() => {
  const raw = diffRef.value.trim()
  if (!raw) return ''
  const url = /\/pull\/(\d+)/.exec(raw)
  if (url) return url[1]!
  const hash = /^#?(\d+)$/.exec(raw)
  if (hash) return hash[1]!
  return raw.startsWith('branch/') ? raw : `branch/${raw}`
})
const diffLabel = computed(() => {
  if (!diffId.value) return ''
  return diffId.value.startsWith('branch/')
    ? `branch ${diffId.value.slice('branch/'.length)}`
    : `PR #${diffId.value}`
})

// Label and icon come from the one per-type map, so a tab can't drift from the
// row it produces.
const TABS: AttachmentType[] = ['document', 'chart', 'diff']
</script>

<template>
  <UModal
    :open="open"
    title="Attach an artifact"
    description="Link a document, chart or diff. The artifact itself isn't copied — only the link is."
    :ui="{ content: 'sm:max-w-2xl', description: 'sr-only' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFieldGroup size="sm" class="w-full">
          <UButton
            v-for="t in TABS"
            :key="t"
            :icon="ATTACHMENT_META[t].icon"
            class="flex-1 justify-center"
            :color="tab === t ? 'primary' : 'neutral'"
            :variant="tab === t ? 'solid' : 'outline'"
            @click="tab = t"
          >
            {{ ATTACHMENT_META[t].label }}
          </UButton>
        </UFieldGroup>

        <!-- Pool picks: a document or a chart that already exists -->
        <template v-if="tab !== 'diff'">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            :placeholder="tab === 'document' ? 'Filter documents…' : 'Filter charts…'"
            autofocus
          />

          <div class="scroll-thin max-h-96 overflow-y-auto rounded-lg border border-default">
            <p v-if="!results.length" class="px-3 py-8 text-center text-sm text-muted">
              {{ pool.length ? 'Nothing matches that.' : `The ${tab} pool is empty.` }}
            </p>
            <button
              v-for="c in results"
              :key="c.id"
              type="button"
              :disabled="isAttached(tab, c.id)"
              class="flex w-full items-center gap-2 border-b border-default/60 px-3 py-2 text-left text-sm last:border-0 enabled:hover:bg-elevated/40 disabled:opacity-50"
              @click="pick(tab, c.id)"
            >
              <UIcon :name="ATTACHMENT_META[tab].icon" class="size-3.5 shrink-0 text-muted" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ c.title }}</span>
                <span class="block truncate font-mono text-xs text-dimmed">{{ c.id }}</span>
              </span>
              <UBadge v-if="isAttached(tab, c.id)" color="neutral" variant="subtle" size="sm">
                Attached
              </UBadge>
              <span v-else-if="c.note" class="shrink-0 text-xs text-dimmed">{{ c.note }}</span>
            </button>
          </div>
        </template>

        <!-- A diff is named, not picked -->
        <div v-else class="space-y-3">
          <UInput
            v-model="diffRef"
            placeholder="42, #42, a PR URL, or branch/my-feature"
            autofocus
            class="font-mono"
          />
          <p class="text-sm text-muted">
            A diff is a review target rather than a stored artifact: a number is a pull request,
            anything else is a branch. It's read against the owning project's repo, so a ticket in
            the backlog will show it as missing until it has a project.
          </p>
          <div class="flex items-center gap-2">
            <UBadge v-if="diffLabel" color="neutral" variant="subtle" size="sm" class="font-mono">
              {{ diffLabel }}
            </UBadge>
            <UButton
              class="ml-auto"
              :disabled="!diffId || isAttached('diff', diffId)"
              @click="pick('diff', diffId)"
            >
              {{ isAttached('diff', diffId) ? 'Already attached' : 'Attach' }}
            </UButton>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end">
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">Close</UButton>
      </div>
    </template>
  </UModal>
</template>
