<script setup lang="ts">
// One character, one frame, nothing else on the page — the screenshot target
// for style-checking a document against a reference image. Deliberately static:
// `poseMode: manual` with an empty overlay is the rest pose, so two shots of the
// same document are pixel-identical and a diff means the art changed.
//
//   /still?id=hoodieGuy&frame=rig&size=900
//   /still?id=hoodieGuy&frame=avatar&bg=%23f3f4f0&ring=%23ff8793
//   /still?id=hoodieGuy&clip=wave&t=0.5
//
// `id` and `clip` name documents in `.data/jrig/documents/` — the TS styles are
// the seeder's source and are not renderable here. There is no skin picker
// either: a skin is the one rendering input a document cannot express (it owns
// the 13 colour roles), so the rig's default is simply what everything draws on.
import { computed, onMounted } from 'vue'

import AvatarRig from '~~/rig/AvatarRig.vue'
import { composePose } from '~~/rig/evaluate'
import { useDocumentPool } from '~~/studio/composables/useDocumentPool'

useHead({ title: 'Still' })

const route = useRoute()
const param = (key: string, fallback: string) => {
  const value = route.query[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

const id = computed(() => param('id', 'hoodie'))
const FRAMES = ['bust', 'rig', 'avatar'] as const
type Frame = typeof FRAMES[number]
const frame = computed<Frame>(() => {
  const value = param('frame', 'rig')
  return (FRAMES as readonly string[]).includes(value) ? value as Frame : 'rig'
})
/** The fill and ring of an avatar-framed still; ignored by the other frames. */
const background = computed(() => param('bg', ''))
const ring = computed(() => param('ring', ''))
const size = computed(() => Number(param('size', '900')))
// Same 2s mtime poll the gallery and the editor use: edit the JSON on disk,
// re-shoot, compare.
const pool = useDocumentPool()
const errors = computed(() => Object.entries(pool.issues.value)
  .flatMap(([name, issues]) => issues
    .filter(issue => issue.level === 'error')
    .map(issue => `${name} ${issue.path}: ${issue.message}`)))

// `?clip=wave&t=0.4` freezes that clip at that second — a clip playing on a
// character is the property this whole app exists to keep, and a still of it is
// the only way to check it without racing an animation frame.
const pose = computed(() => {
  const clip = pool.clips.value.find(entry => entry.id === param('clip', ''))
  if (!clip) {
    return {}
  }
  const time = Number(param('t', String(clip.duration / 2)))
  return composePose(clip.layer === 'base'
    ? { base: { clip, time } }
    : { emote: { clip, time, weight: 1 } })
})

const art = computed(() => pool.styles.value.find(style => style.id === id.value))

onMounted(() => pool.start())
</script>

<template>
  <div class="still">
    <div v-if="art" :style="{ width: `${size}px` }">
      <AvatarRig
        :art="art"
        :clips="pool.clips.value"
        :frame="frame"
        :background="background"
        :ring="ring"
        pose-mode="manual"
        :pose="pose"
        :ambient="false"
      />
    </div>
    <p v-else class="miss">no character document with id "{{ id }}"</p>
    <ul v-if="errors.length" class="errors">
      <li v-for="line in errors" :key="line">{{ line }}</li>
    </ul>
  </div>
</template>

<style scoped>
.still {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #fff;
  padding: 0;
  margin: 0;
}

.miss,
.errors {
  font: 13px/1.5 ui-monospace, monospace;
  color: #b00;
  padding: 8px 12px;
}
</style>
