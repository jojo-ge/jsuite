<script setup lang="ts">
// `gh pr list` gives us only the author's login, so the avatar comes from
// github.com/<login>.png — the stable redirect to the user's avatar. The
// initial sits underneath the image, so a slow fetch shows a letter rather
// than a hole, and bots ("app/dependabot", which has no user page) and any
// offline/404 case just keep it.
const props = withDefaults(defineProps<{ login?: string, size?: number }>(), { size: 20 })

const failed = ref(false)
watch(() => props.login, () => { failed.value = false })

const src = computed(() => {
  const login = props.login
  if (!login || login.includes('/')) return null
  return `https://github.com/${encodeURIComponent(login)}.png?size=${props.size * 2}`
})
const initial = computed(() => (props.login ?? '?').replace(/^app\//, '').charAt(0).toUpperCase())
</script>

<template>
  <!-- Decorative: every caller puts the login next to it, in text or sr-only. -->
  <span
    class="avatar"
    aria-hidden="true"
    :data-initial="initial"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.5)}px` }"
  >
    <img
      v-if="src && !failed"
      :src="src"
      alt=""

      :width="size"
      :height="size"
      @error="failed = true"
    >
  </span>
</template>

<style scoped>
.avatar {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel-2);
  overflow: hidden;
  font-family: var(--mono);
  line-height: 1;
  color: var(--muted);
  user-select: none;
}
/* Pseudo-element, not a child node, so the letter never lands in the row's
   selected/copied text. */
.avatar::before { content: attr(data-initial); }
.avatar img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
