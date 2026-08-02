<script setup lang="ts">
// Every art style and every skin side by side, playing the same clip library —
// the "one skeleton, every clip on every character" property, live. Replaces
// the kraken Storybook stories (Styles + Skins) this page was mined from.
import { ref } from 'vue'

import AvatarRig from '~~/rig/AvatarRig.vue'
import { BUILT_IN_CLIPS } from '~~/rig/clips'
import { SKINS } from '~~/rig/core'
import { ART_STYLES } from '~~/rig/styles'

useHead({ title: 'Gallery' })

const EMOTES = BUILT_IN_CLIPS.filter(clip => clip.layer === 'emote')

const rigs = ref<Record<string, InstanceType<typeof AvatarRig> | null>>({})
const setRig = (id: string, instance: unknown) => {
  rigs.value[id] = instance as InstanceType<typeof AvatarRig> | null
}
const playAll = (clipId: string) => {
  Object.values(rigs.value).forEach(rig => rig?.play(clipId))
}

const base = ref<'idle' | 'talking'>('idle')
const ambient = ref(true)
</script>

<template>
  <div class="mx-auto max-w-6xl p-6 space-y-8">
    <div class="flex items-center gap-4">
      <h1 class="text-xl font-semibold">Gallery</h1>
      <div class="ms-auto flex items-center gap-3">
        <USelect v-model="base" :items="['idle', 'talking']" size="sm" />
        <USwitch v-model="ambient" label="Ambient" size="sm" />
        <UButton to="/" variant="ghost" size="sm" icon="i-lucide-house">Home</UButton>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="emote in EMOTES"
        :key="emote.id"
        size="sm"
        variant="soft"
        @click="playAll(emote.id)"
      >
        {{ emote.name }}
      </UButton>
    </div>

    <section class="space-y-3">
      <h2 class="text-sm font-medium text-muted">Styles — one skeleton, every clip on every character</h2>
      <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <figure v-for="style in ART_STYLES" :key="style.id" class="m-0">
          <AvatarRig
            :ref="instance => setRig(`style-${style.id}`, instance)"
            :art="style"
            :name="style.name"
            :base="base"
            :ambient="ambient"
            class="w-full rounded-lg"
            style="background: #f4f1ea"
          />
          <figcaption class="pt-1.5 text-xs text-muted">{{ style.name }} — {{ style.blurb }}</figcaption>
        </figure>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-medium text-muted">Skins — same style, palette swap</h2>
      <div class="flex flex-wrap gap-4">
        <AvatarRig
          v-for="skin in SKINS"
          :key="skin.id"
          :ref="instance => setRig(`skin-${skin.id}`, instance)"
          :skin="skin"
          :name="skin.name"
          :base="base"
          :ambient="ambient"
          class="w-48 rounded-lg"
          style="background: #f4f1ea"
        />
      </div>
    </section>
  </div>
</template>
