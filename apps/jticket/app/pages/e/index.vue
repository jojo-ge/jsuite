<script setup lang="ts">
// All documents — the whole shared pool, not codebase-scoped and not only
// tracked docs: reviewer reports, explain.py articles and
// every DOC-n's content. Each opens in the reader at /e/<key>. Found by
// full-text search and by tag (a document's kind). Only the kinds people read
// — explainer, research, decision, spec, proposal — are listed and searched;
// reports and review outputs (most of the pool) wait for the switch.
import { listedByDefault } from '@jsuite/documents/tags'
import type { ExplainerMeta } from '@jsuite/documents/types'
import type { LibraryEntry } from '~/utils/documentLibrary'

useHead({ title: 'All documents' })

const { data: pool, refresh } = await useFetch<ExplainerMeta[]>('/api/documents', { default: () => [] })
const { docs } = useTracker()

// What is being looked for lives in the URL (?q=&tags=a,b&all=1), so a
// filtered library can be linked, reloaded and come back to.
const route = useRoute()
const router = useRouter()
const query = ref(String(route.query.q ?? ''))
const tags = ref(String(route.query.tags ?? '').split(',').filter(Boolean))
const all = ref(route.query.all === '1')
let urlTimer: ReturnType<typeof setTimeout> | null = null
watch([query, tags, all], () => {
  if (urlTimer) clearTimeout(urlTimer)
  urlTimer = setTimeout(() => {
    const q = query.value.trim()
    router.replace({
      query: {
        ...(q ? { q } : {}),
        ...(tags.value.length ? { tags: tags.value.join(',') } : {}),
        ...(all.value ? { all: '1' } : {}),
      },
    })
  }, 250)
})

// The row's own text filters as you type; the body is searched by the server
// (every word must appear somewhere in the document), a beat behind.
const contentHits = ref(new Map<string, string | undefined>())
const searching = ref(false)
let searchRun = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null
async function searchBodies(q: string) {
  const run = ++searchRun
  if (q.length < 2) {
    contentHits.value = new Map()
    searching.value = false
    return
  }
  searching.value = true
  try {
    const hits = await $fetch<ExplainerMeta[]>('/api/documents', { query: { q } })
    if (run === searchRun) contentHits.value = new Map(hits.map((h) => [h.key, h.snippet]))
  } finally {
    if (run === searchRun) searching.value = false
  }
}
watch(query, (raw) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => searchBodies(raw.trim()), 200)
})
// A linked search (?q=) is searched once the page is up, not on the server render.
onMounted(() => searchBodies(query.value.trim()))
onBeforeUnmount(() => {
  if (urlTimer) clearTimeout(urlTimer)
  if (searchTimer) clearTimeout(searchTimer)
})

const entries = computed(() => libraryEntries(pool.value ?? [], docs.value))
const hitKeys = computed(() => new Set(contentHits.value.keys()))
const filter = computed(() => ({ tags: tags.value, all: all.value, contentHits: hitKeys.value }))
const shown = computed(() => filterLibrary(entries.value, query.value, filter.value))

// The kinds the library leaves out until asked: how many there are, and how
// many of them the query and tags would have found.
const otherTotal = computed(() => entries.value.filter((e) => !listedByDefault(e)).length)
const heldBack = computed(() =>
  showsEverything(filter.value) ? 0 : filterLibrary(entries.value, query.value, { ...filter.value, all: true }).length - shown.value.length,
)
// The chips count what picking them would leave: the rows showing now.
const tagChips = computed(() => {
  const counts = libraryTags(shown.value)
  const missing = tags.value.filter((t) => !counts.some((c) => c.tag === t))
  return [...missing.map((tag) => ({ tag, count: 0 })), ...counts]
})
const filtering = computed(() => !!query.value.trim() || tags.value.length > 0)
function clearFilters() {
  query.value = ''
  tags.value = []
}

// Dates render client-side only (ClientOnly below) — the server's locale and
// timezone would otherwise mismatch on hydration.
const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
function updated(iso: string): string {
  try {
    return fmt.format(new Date(iso))
  } catch {
    return ''
  }
}

const removing = ref<string | null>(null)
async function remove(e: LibraryEntry) {
  if (!window.confirm(deleteDocumentPrompt(e.title, e.trackedAs))) return
  removing.value = e.key
  try {
    await $fetch(`/api/documents/${encodeURIComponent(e.key)}`, { method: 'DELETE' })
    await refresh()
  } finally {
    removing.value = null
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <UContainer class="py-8">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">All documents</h1>
          <p class="text-sm text-muted">
            Explainers, research, decisions, specs and proposals. Reports and review outputs are under Other kinds.
            Tracked docs (DOC-n) are also under <NuxtLink to="/docs" class="text-primary hover:underline">Docs</NuxtLink>.
          </p>
        </div>
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search titles, tags and text"
          class="w-full sm:w-80"
          aria-label="Search documents"
          :loading="searching"
          trailing
        />
      </div>

      <div v-if="entries.length" class="mb-4 flex flex-wrap items-center gap-1.5">
        <button
          v-for="t in tagChips"
          :key="t.tag"
          type="button"
          class="flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2.5 transition-colors"
          :class="tags.includes(t.tag) ? 'border-primary bg-primary/10' : 'border-default hover:border-accented hover:bg-elevated/50'"
          :aria-pressed="tags.includes(t.tag)"
          @click="tags = toggleTag(tags, t.tag)"
        >
          <DocumentKindIcon :kind="t.tag" size="sm" label />
          <span class="text-xs tabular-nums text-dimmed">{{ t.count }}</span>
        </button>
        <UButton v-if="filtering" size="xs" color="neutral" variant="link" icon="i-lucide-x" label="Clear" @click="clearFilters" />
        <USwitch
          v-if="otherTotal"
          v-model="all"
          size="sm"
          class="ml-auto"
          :label="`Other kinds (${otherTotal})`"
          title="List and search the rest too: slice, outcome and status reports, review outputs and briefs"
        />
      </div>

      <div v-if="!entries.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-book-open-text" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">No documents yet</p>
          <p class="mx-auto max-w-md text-sm text-muted">
            Ask Claude to explain something with the <code class="font-mono text-xs">j-explain</code> skill, or write
            a doc with <code class="font-mono text-xs">to-jdoc</code> — it lands here.
          </p>
        </div>
      </div>

      <div v-else-if="!shown.length" class="py-16 text-center text-sm text-muted">
        <p>{{ filtering ? 'Nothing matches.' : 'Nothing here but reports and review outputs.' }}</p>
        <UButton
          v-if="heldBack"
          class="mt-2"
          size="xs"
          variant="link"
          :label="`${heldBack} of the other kinds ${filtering ? (heldBack === 1 ? 'matches' : 'match') : (heldBack === 1 ? 'is hidden' : 'are hidden')} — show`"
          @click="all = true"
        />
      </div>

      <ul v-else class="divide-y divide-default overflow-hidden rounded-lg border border-default">
        <li v-for="e in shown" :key="e.key" class="group relative flex items-start gap-3 px-4 py-3 hover:bg-elevated/50">
          <!-- relative z-10: above the row's stretched link, so the tooltip and the click reach it -->
          <button
            type="button"
            class="relative z-10 mt-0.5 shrink-0 rounded-lg transition-opacity hover:opacity-80"
            :disabled="!e.tags[0]"
            :aria-label="e.tags[0] ? `Only ${e.tags[0]}` : 'Untagged'"
            @click="e.tags[0] && (tags = toggleTag(tags, e.tags[0]))"
          >
            <DocumentKindIcon :kind="e.tags[0]" size="lg" />
          </button>
          <div class="min-w-0 flex-1">
            <p v-if="e.kicker" class="text-[11px] font-semibold uppercase tracking-widest text-primary">{{ e.kicker }}</p>
            <NuxtLink :to="readerPath(e.key)" class="font-medium after:absolute after:inset-0 group-hover:text-primary">
              {{ e.title }}
            </NuxtLink>
            <p v-if="e.subtitle" class="truncate text-sm text-muted">{{ e.subtitle }}</p>
            <p v-if="contentHits.get(e.key)" class="mt-0.5 truncate text-xs italic text-dimmed">
              <UIcon name="i-lucide-text-search" class="mr-1 inline size-3.5 align-text-bottom" />{{ contentHits.get(e.key) }}
            </p>
            <p class="mt-1 flex flex-wrap items-center gap-3 text-xs text-dimmed">
              <!-- relative z-10: above the row's stretched link -->
              <button
                v-for="t in e.tags"
                :key="t"
                type="button"
                class="relative z-10 font-medium hover:underline"
                :class="documentKindMeta(t).text"
                :title="tags.includes(t) ? `Stop filtering by ${t}` : `Only ${t}`"
                @click="tags = toggleTag(tags, t)"
              >
                {{ documentKindMeta(t).label }}
              </button>
              <span class="font-mono">{{ e.key }}</span>
              <span>{{ e.blockCount }} block{{ e.blockCount === 1 ? '' : 's' }}</span>
              <span v-if="e.chartCount" class="flex items-center gap-1">
                <UIcon name="i-lucide-shapes" class="size-3.5" />{{ e.chartCount }}
              </span>
              <span v-if="e.noteCount" class="flex items-center gap-1">
                <UIcon name="i-lucide-message-square" class="size-3.5" />{{ e.noteCount }}
              </span>
              <ClientOnly><span>{{ updated(e.updatedAt) }}</span></ClientOnly>
            </p>
          </div>
          <!-- relative z-10: above the row's stretched link -->
          <div class="relative z-10 flex shrink-0 items-center gap-1">
            <NuxtLink v-if="e.trackedAs" :to="`/docs/${e.trackedAs}`" :title="`Open ${e.trackedAs}`">
              <UBadge color="secondary" variant="outline" size="sm" class="font-mono">{{ e.trackedAs }}</UBadge>
            </NuxtLink>
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Delete ${e.title}`"
              :loading="removing === e.key"
              @click="remove(e)"
            />
          </div>
        </li>
      </ul>
    </UContainer>
  </div>
</template>
