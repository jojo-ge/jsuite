<script setup lang="ts">
// Temporary host for the ported keyframe editor. Retired in M7 when Animate
// mode reaches parity inside the studio (see docs/PLAN.md).
//
// Routing lives here rather than in the component: `rig/` is framework-free by
// rule, so the page reads the query and hands the editor plain props.
//
//   /editor?character=hoodieGuy&clip=wave.clip.json
import { computed } from 'vue'

import RigEditor from '~~/rig/RigEditor.vue'

useHead({ title: 'Rig editor' })

const route = useRoute()
const query = (key: string) => {
  const value = route.query[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const character = computed(() => query('character'))
const clipDocument = computed(() => query('clip'))
</script>

<template>
  <RigEditor :character="character" :clip-document="clipDocument" />
</template>
