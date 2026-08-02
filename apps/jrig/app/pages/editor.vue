<script setup lang="ts">
// Temporary host for the ported keyframe editor. Retired in M7 when Animate
// mode reaches parity inside the studio (see docs/PLAN.md).
import RigEditor from '~~/rig/RigEditor.vue'

useHead({ title: 'Rig editor' })
</script>

<template>
  <RigEditor />
</template>
