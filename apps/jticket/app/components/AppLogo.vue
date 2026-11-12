<script setup lang="ts">
// The jTicket mark. Which mark is the browser's pick (useLogo, chosen on
// /logo) unless `mark` names one — the gallery shows them all. The drawings
// and their colours live in app/utils/logos.ts; the tab icon is the same
// drawing with the same colours written in (logoFavicon, set in app.vue).
//
// A mark has no plate: it sits straight on whatever is behind it, in its own
// two colours, which are mid-toned so they hold on the light and dark themes
// alike. It is the one place in the app where colour is not a status.
const props = withDefaults(defineProps<{ size?: number; mark?: string; label?: string }>(), {
  size: 32,
  mark: undefined,
  label: 'jTicket',
})

const { mark: picked } = useLogo()
const shown = computed(() => (props.mark ? findLogo(props.mark) : picked.value))
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="LOGO_VIEWBOX"
    xmlns="http://www.w3.org/2000/svg"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    class="shrink-0"
    :style="{ color: shown.colors.main, '--logo-accent': shown.colors.accent, '--logo-on': LOGO_ON }"
  >
    <!-- eslint-disable-next-line vue/no-v-html — the body is a constant from logos.ts, never user input -->
    <g fill="currentColor" v-html="shown.body" />
  </svg>
</template>
