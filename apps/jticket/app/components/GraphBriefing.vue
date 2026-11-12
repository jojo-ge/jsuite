<script setup lang="ts">
// The briefing in front of one graph node, and its Move on button. It informs
// and never refuses: every upstream's state, the node's own project, the
// base a build would start from (and the upstream builds it could stack on),
// then the flags — what isn't in the expected state. Move on always works: it
// creates the project of a proposed node, records the stacking choice and
// keeps this briefing on the node; it starts nothing.
//
// GitHub and git facts are time-boxed on the server; while some read
// 'unknown' (`incomplete`) the briefing asks again a few times.
import { sliceDisplay, type Briefing, type ProjectFacts } from '~/utils/graphs'
import { verdictBadge } from '~/utils/prList'

const props = defineProps<{ graphKey: string; nodeId: string; compact?: boolean }>()
const emit = defineEmits<{ entered: [projectKey: string] }>()

const toast = useToast()
const briefing = ref<Briefing | null>(null)
const error = ref('')
const loading = ref(false)
const stackOn = ref<string>('')
// Once the human picks a base, the briefing previews that pick.
const picked = ref(false)
const note = ref('')
const entering = ref(false)

let polls = 0
let timer: ReturnType<typeof setTimeout> | null = null
async function load(again = false) {
  if (timer) clearTimeout(timer)
  if (!again) polls = 0
  loading.value = !briefing.value
  try {
    const q = picked.value ? `?stackOn=${encodeURIComponent(stackOn.value)}` : ''
    briefing.value = await $fetch<Briefing>(`/api/graphs/${props.graphKey}/nodes/${props.nodeId}/briefing${q}`)
    error.value = ''
    if (briefing.value.incomplete && polls++ < 3) timer = setTimeout(() => load(true), 2500)
  } catch (err: any) {
    error.value = String(err?.data?.statusMessage ?? err?.message ?? err)
  } finally {
    loading.value = false
  }
}
onBeforeUnmount(() => timer && clearTimeout(timer))

// The first load takes the node's stored choice; changing the pick previews it.
watch(
  () => [props.graphKey, props.nodeId],
  async () => {
    briefing.value = null
    picked.value = false
    stackOn.value = ''
    note.value = ''
    await load()
    stackOn.value = briefing.value?.base?.stackOn ?? ''
  },
  { immediate: true },
)
function pickBase(v: string) {
  stackOn.value = v === DEFAULT_BASE ? '' : v
  picked.value = true
  load()
}

const DEFAULT_BASE = '__default'
const baseItems = computed(() => [
  // A select item can't hold '' — the default branch rides as a sentinel.
  { label: 'The default branch', value: DEFAULT_BASE },
  ...(briefing.value?.base?.options ?? []).map((o) => ({
    label: `${o.projectKey} · ${o.branch || 'no integration branch yet'}`,
    value: o.nodeId,
  })),
])

async function moveOn() {
  if (!briefing.value) return
  entering.value = true
  try {
    const res = await $fetch<{ project: { key: string }; created: boolean; flags: Array<{ message: string; level: string }> }>(
      `/api/graphs/${props.graphKey}/nodes/${props.nodeId}/enter`,
      { method: 'POST', body: { note: note.value, ...(briefing.value.base ? { stackOn: stackOn.value || null } : {}) } },
    )
    toast.add({
      title: res.created ? `Moved on — ${res.project.key} created` : `Moved on into ${res.project.key}`,
      description: res.flags.map((f) => f.message).join(' ') || undefined,
      color: 'success',
      icon: 'i-lucide-circle-arrow-right',
    })
    emit('entered', res.project.key)
    await load()
  } catch (err: any) {
    toast.add({ title: "Couldn't move on", description: String(err?.data?.statusMessage ?? err?.message ?? err), color: 'error' })
  } finally {
    entering.value = false
  }
}

const warnings = computed(() => briefing.value?.flags.filter((f) => f.level === 'warning') ?? [])
const infos = computed(() => briefing.value?.flags.filter((f) => f.level === 'info') ?? [])

function rollupText(p: ProjectFacts): string {
  const r = p.rollup
  if (r.state === 'unknown') return r.error ? 'roll-up PR: GitHub couldn’t be asked' : 'roll-up PR: GitHub hasn’t answered yet'
  if (r.state === 'no-branch') return 'no integration branch'
  if (r.state === 'none') return 'no roll-up PR'
  const ci = r.ci === 'unknown' || r.ci === 'none' ? '' : ` · CI ${r.ci}`
  return `roll-up PR #${r.number} ${r.state}${r.base ? ` → ${r.base}` : ''}${ci}`
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="loading" class="py-6 text-center text-sm text-muted">Reading the briefing…</p>
    <UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
    <template v-else-if="briefing">
      <!-- Flags first: they're the point -->
      <div v-if="warnings.length || infos.length" class="space-y-1.5">
        <div v-for="(f, i) in warnings" :key="`w${i}`" class="flex items-start gap-2 text-sm text-warning">
          <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
          <span>{{ f.message }}</span>
        </div>
        <div v-for="(f, i) in infos" :key="`i${i}`" class="flex items-start gap-2 text-sm text-muted">
          <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" />
          <span>{{ f.message }}</span>
        </div>
      </div>
      <p v-else class="flex items-center gap-2 text-sm text-success">
        <UIcon name="i-lucide-circle-check" class="size-4" /> Everything before this is where it should be.
      </p>

      <template v-if="!compact">
        <!-- Upstreams -->
        <div v-if="briefing.upstreams.length" class="space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Before this</h3>
          <div v-for="u in briefing.upstreams" :key="u.nodeId" class="rounded-md border border-default px-3 py-2 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs text-muted">{{ u.type }}</span>
              <NuxtLink v-if="u.project" :to="`/projects/${u.project.key}`" class="font-mono text-xs text-muted hover:underline">{{ u.project.key }}</NuxtLink>
              <span class="font-medium">{{ u.title }}</span>
              <UBadge v-if="u.proposed" color="neutral" variant="outline" size="sm">proposed</UBadge>
              <UBadge v-else-if="u.enteredAt" color="info" variant="subtle" size="sm">moved on {{ u.enteredAt.slice(0, 10) }}</UBadge>
            </div>
            <div v-if="u.project" class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
              <span>{{ u.project.tickets.done }}/{{ u.project.tickets.total }} tickets done</span>
              <span v-if="u.project.tickets.inProgress.length" class="text-info">{{ u.project.tickets.inProgress.length }} in progress</span>
              <span v-if="u.project.auto" class="text-info">auto mode on</span>
              <template v-if="u.mode === 'standard'">
                <a v-if="u.project.rollup.url" :href="u.project.rollup.url" target="_blank" class="hover:underline">{{ rollupText(u.project) }}</a>
                <span v-else>{{ rollupText(u.project) }}</span>
                <span v-if="u.project.sharedWith?.length" class="text-warning" :title="sliceDisplay(u.project.slice, u.project.sharedWith).title">{{ sliceDisplay(u.project.slice, u.project.sharedWith).text }}</span>
                <span v-else-if="u.project.slice.state !== 'unknown'" :class="sliceDisplay(u.project.slice).large ? 'text-warning' : ''">slice: {{ sliceDisplay(u.project.slice).text }}</span>
                <span v-if="u.project.branch.known">{{ u.project.branch.behind }} behind · {{ u.project.branch.unpushed ?? '?' }} unpushed</span>
              </template>
              <template v-if="u.project.review">
                <span v-if="verdictBadge(u.project.review.verdict)">verdict: {{ verdictBadge(u.project.review.verdict)!.label }}</span>
                <span>{{ u.project.review.openFindings }} findings open</span>
              </template>
              <template v-if="u.project.plan">
                <span>{{ u.project.plan.drafts }} drafts · {{ u.project.plan.builds }} builds<template v-if="u.project.plan.proposedBuilds"> ({{ u.project.plan.proposedBuilds }} proposed)</template></span>
                <NuxtLink v-if="u.project.plan.specDoc" :to="`/docs/${u.project.plan.specDoc}`" class="hover:underline">spec {{ u.project.plan.specDoc }}</NuxtLink>
                <span v-else class="text-warning">no spec</span>
              </template>
              <NuxtLink v-if="u.project.outcomeDoc" :to="`/docs/${u.project.outcomeDoc}`" class="text-success hover:underline">outcome report</NuxtLink>
            </div>
          </div>
        </div>

        <!-- A build's base -->
        <UFormField v-if="briefing.base" label="Starts from" :hint="briefing.base.options.length ? 'the default branch, or stack on a build before this one' : ''">
          <USelect :model-value="stackOn || DEFAULT_BASE" :items="baseItems" value-key="value" class="w-full" :disabled="!briefing.base.options.length" @update:model-value="pickBase(String($event ?? ''))" />
        </UFormField>

        <UFormField label="Note" hint="optional — kept with this moment">
          <UTextarea v-model="note" :rows="2" autoresize class="w-full" placeholder="Why now, what you checked…" />
        </UFormField>
      </template>

      <div class="flex items-center gap-2">
        <UButton icon="i-lucide-circle-arrow-right" :loading="entering" @click="moveOn">
          {{ briefing.node.proposed ? `Move on — create the ${briefing.node.type.toLowerCase()} project` : briefing.node.enteredAt ? 'Move on again' : 'Move on' }}
        </UButton>
        <span v-if="briefing.incomplete" class="text-xs text-muted">Some GitHub facts are still loading.</span>
      </div>
    </template>
  </div>
</template>
