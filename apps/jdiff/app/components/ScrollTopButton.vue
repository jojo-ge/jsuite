<script setup lang="ts">
const visible = ref(false)

function onScroll() {
  visible.value = window.scrollY > window.innerHeight
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))

function toTop() {
  window.scrollTo({ top: 0, behavior: 'instant' })
}
</script>

<template>
  <button v-if="visible" class="scroll-top" title="scroll to top" @click="toTop">
    ↑ top
  </button>
</template>

<style scoped>
.scroll-top {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 10;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 12px;
}
.scroll-top:hover {
  color: var(--text);
  border-color: var(--accent);
}
</style>
