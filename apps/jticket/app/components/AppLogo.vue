<script setup lang="ts">
// The jTicket mark: three descending bars — work burning down — on the dark
// plate. Same geometry as public/favicon.svg, so the tab icon and the header
// are one mark; edit both together.
withDefaults(defineProps<{ size?: number }>(), { size: 32 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="jTicket"
    class="shrink-0"
  >
    <rect width="32" height="32" rx="8" fill="var(--color-jticket-ink)" />
    <g fill="var(--color-periwinkle-400)">
      <rect x="6" y="8" width="5" height="16" rx="2" />
      <rect x="13.5" y="8" width="5" height="11" rx="2" opacity=".8" />
      <rect x="21" y="8" width="5" height="7" rx="2" opacity=".55" />
    </g>
  </svg>
</template>
