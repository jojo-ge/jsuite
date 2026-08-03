<script setup lang="ts">
// One character, big, with the whole emote library on buttons beside it.
//
// The gallery answers "how do these all look together"; this answers "what does
// THIS one do", which is a different question and needs the clip library within
// reach rather than a play-all across every card.
//
// Unfolded it uses the `rig` frame, not `bust` like the gallery cards. This view
// exists to play emotes, and half the library raises an arm out of the portrait
// crop — a thumbs-up with the thumb cut off is not a preview of anything.
//
// Its preview toggle is deliberately local state seeded from the page: flipping
// a character into the round cut-out to check how it crops should not re-render
// the gallery behind it.
import { computed, ref, watch } from 'vue'

import type { Clip } from '~~/rig/core'
import type { ArtStyle } from '~~/rig/styles'
import type { AvatarTreatment } from '~~/studio/avatarBackgrounds'

import AvatarRig from '~~/rig/AvatarRig.vue'
import { CAST_TONES, lookFor, PROFILE_TONES, toneFor } from '~~/studio/avatarBackgrounds'

const props = defineProps<{
  art: ArtStyle | null
  /** Compiled clip documents — the same pool the gallery renders from. */
  clips: Clip[]
  /** Seeds the modal's own toggle; the page's mode is not touched. */
  avatar: boolean
  treatment: AvatarTreatment
}>()

const open = defineModel<boolean>('open', { required: true })

const rig = ref<InstanceType<typeof AvatarRig> | null>(null)
const avatarMode = ref(props.avatar)
const treatment = ref<AvatarTreatment>(props.treatment)
const base = ref<'idle' | 'talking' | null>('idle')
const ambient = ref(true)
const playing = ref<string | null>(null)

// Re-seed on open rather than on prop change: while the modal is up, its
// toggles are its own.
watch(open, (isOpen) => {
  if (isOpen) {
    avatarMode.value = props.avatar
    treatment.value = props.treatment
    playing.value = null
  }
})

const palette = computed(() => (treatment.value === 'filled' ? PROFILE_TONES : CAST_TONES))
const look = computed(() => lookFor(toneFor(props.art?.id ?? '', palette.value), treatment.value))

const play = (clipId: string) => {
  playing.value = clipId
  rig.value?.play(clipId)
}
const stop = () => {
  rig.value?.stop()
  playing.value = null
}
</script>

<template>
  <UModal v-model:open="open" :title="art?.name ?? 'Character'" :description="art?.blurb" :ui="{ content: 'max-w-3xl' }">
    <template #body>
      <div v-if="art" class="flex flex-col gap-5 sm:flex-row">
        <div class="shrink-0 sm:w-72">
          <AvatarRig
            ref="rig"
            :art="art"
            :clips="clips"
            :name="art.name"
            :base="base"
            :ambient="ambient"
            :frame="avatarMode ? 'avatar' : 'rig'"
            :background="avatarMode ? look.background : null"
            :ring="avatarMode ? look.ring : null"
            class="w-full"
            :class="avatarMode ? '' : 'rounded-lg'"
            :style="avatarMode ? { '--rig-ring-width': '6px' } : { background: '#f4f1ea' }"
            @emote-end="playing = null"
          />
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <USwitch v-model="avatarMode" label="Avatar preview" size="sm" />
            <USelect
              v-if="avatarMode"
              v-model="treatment"
              :items="[{ label: 'Story asset', value: 'story' }, { label: 'Filled', value: 'filled' }]"
              value-key="value"
              size="sm"
            />
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <USelect
              v-model="base"
              :items="[{ label: 'no base', value: null }, { label: 'idle', value: 'idle' }, { label: 'talking', value: 'talking' }]"
              value-key="value"
              size="sm"
            />
            <USwitch v-model="ambient" label="Ambient" size="sm" />
          </div>

          <div class="space-y-2">
            <p class="text-xs text-muted">Emotes — every clip plays on every character, which is the whole contract</p>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="emote in clips.filter(clip => clip.layer === 'emote')"
                :key="emote.id"
                size="sm"
                :variant="playing === emote.id ? 'solid' : 'soft'"
                @click="play(emote.id)"
              >
                {{ emote.name }}
              </UButton>
              <UButton size="sm" variant="ghost" color="neutral" :disabled="!playing" @click="stop">
                Stop
              </UButton>
            </div>
          </div>

          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
            <dt>id</dt>
            <dd class="font-mono text-default">{{ art.id }}</dd>
            <dt>document</dt>
            <dd class="font-mono text-default">{{ art.id }}.character.json</dd>
            <dt>tone</dt>
            <dd class="text-default">{{ look.tone }}</dd>
          </dl>
        </div>
      </div>
    </template>
  </UModal>
</template>
