<script setup lang="ts">
// Codebase settings → Verification rules: extra command patterns the
// analytics should count as verification runs in this codebase (a custom
// test runner, a `make check`, a guards script), each with a category. The
// built-in rules (vitest, jest, pytest, playwright, eslint, tsc, …) always
// apply; these come first, so one can also recategorise a built-in match.
import type { Codebase, VerificationRule } from '~/composables/useCodebase'
import { VERIFICATION_CATEGORIES } from '~/composables/useCodebase'

const props = defineProps<{ codebase: Codebase }>()
const toast = useToast()
const { saveCodebaseVerificationRules } = useCodebase()

const draft = ref<VerificationRule[]>([])
watch(
  () => props.codebase.verificationRules,
  (rules) => {
    draft.value = (rules ?? []).map((r) => ({ ...r }))
  },
  { immediate: true },
)

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.codebase.verificationRules ?? []))
const problems = computed(() =>
  draft.value.map((r) => {
    if (!r.pattern.trim()) return 'empty pattern'
    try {
      new RegExp(r.pattern)
      return ''
    } catch (e: any) {
      return String(e?.message ?? 'invalid pattern')
    }
  }),
)
const valid = computed(() => problems.value.every((p) => !p))

function add() {
  draft.value.push({ id: `codebase-${draft.value.length + 1}`, category: 'test', pattern: '' })
}
function remove(i: number) {
  draft.value.splice(i, 1)
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await saveCodebaseVerificationRules(props.codebase.path, draft.value.map((r, i) => ({ ...r, id: r.id || `codebase-${i + 1}`, pattern: r.pattern.trim() })))
    toast.add({ title: 'Verification rules saved', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not save', description: String(e?.data?.statusMessage ?? e?.message ?? e), color: 'error' })
  } finally {
    saving.value = false
  }
}

// A quick check: does a sample command hit one of the drafted rules?
const sample = ref('')
const sampleHit = computed(() => {
  if (!sample.value.trim()) return null
  for (const [i, r] of draft.value.entries()) {
    if (problems.value[i]) continue
    try {
      if (new RegExp(r.pattern).test(sample.value)) return r
    } catch { /* reported above */ }
  }
  return null
})
</script>

<template>
  <div class="space-y-3">
    <p v-if="!draft.length" class="text-sm text-muted">No codebase rules — the built-in runners are recognised on their own. Add one for a custom script.</p>
    <ul v-else class="space-y-2">
      <li v-for="(r, i) in draft" :key="i" class="flex items-start gap-2">
        <USelect v-model="r.category" :items="VERIFICATION_CATEGORIES" size="sm" class="w-32" />
        <div class="min-w-0 flex-1">
          <UInput v-model="r.pattern" size="sm" placeholder="regular expression, e.g. ^make (check|test)\b" class="w-full font-mono" />
          <p v-if="problems[i]" class="mt-0.5 text-[11px] text-error">{{ problems[i] }}</p>
        </div>
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-x" aria-label="Remove rule" @click="remove(i)" />
      </li>
    </ul>
    <div class="flex flex-wrap items-center gap-2">
      <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="add">Add rule</UButton>
      <UButton size="xs" icon="i-lucide-save" :disabled="!dirty || !valid" :loading="saving" @click="save">Save</UButton>
      <div class="ml-auto flex items-center gap-2 text-xs">
        <UInput v-model="sample" size="xs" placeholder="try a command…" class="w-64 font-mono" />
        <span v-if="sample.trim()" :class="sampleHit ? 'text-success' : 'text-muted'">{{ sampleHit ? `→ ${sampleHit.category}` : 'no codebase rule (built-ins may still match)' }}</span>
      </div>
    </div>
  </div>
</template>
