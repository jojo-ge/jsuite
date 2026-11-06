<script setup lang="ts">
// PROTOTYPE — throwaway. The floating bar that flips a page between UI
// variants (?variant=). Dev only; never rendered in a production build.
const props = defineProps<{ variants: string[]; names?: Record<string, string> }>()
const dev = import.meta.dev
const route = useRoute()
const router = useRouter()
const current = computed(() => {
  const q = String(route.query.variant ?? '')
  return props.variants.includes(q) ? q : props.variants[0]!
})
function go(by: -1 | 1) {
  const i = props.variants.indexOf(current.value)
  const next = props.variants[(i + by + props.variants.length) % props.variants.length]!
  router.replace({ query: { ...route.query, variant: next === props.variants[0] ? undefined : next } })
}
function onKey(e: KeyboardEvent) {
  const el = document.activeElement as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  if (e.key === 'ArrowLeft') go(-1)
  if (e.key === 'ArrowRight') go(1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    v-if="dev"
    class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-amber-500 bg-neutral-900 px-2 py-1 text-sm text-white shadow-xl"
  >
    <button class="rounded-full px-2 py-0.5 hover:bg-white/10" aria-label="Previous variant" @click="go(-1)">←</button>
    <span class="px-1 font-mono text-xs uppercase tracking-wide text-amber-400">prototype</span>
    <span class="px-1 font-medium">{{ current }}<template v-if="names?.[current]"> · {{ names[current] }}</template></span>
    <button class="rounded-full px-2 py-0.5 hover:bg-white/10" aria-label="Next variant" @click="go(1)">→</button>
  </div>
</template>
