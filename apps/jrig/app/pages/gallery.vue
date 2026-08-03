<script setup lang="ts">
// Every character in `.data/jrig/documents/`, side by side, playing the same
// clip library — the "one skeleton, every clip on every character" property,
// live. Compiled client-side and re-read on a 2s mtime poll, so editing a JSON
// on disk moves the character in front of you.
//
// Documents are the only thing this page renders. The TS styles in
// `rig/styles.ts` are the seeder's source, not gallery content, and the clip
// buttons come from the clip documents rather than `BUILT_IN_CLIPS` for the
// same reason.
import { computed, onMounted, ref, watch } from 'vue'

import type { ArtStyle } from '~~/rig/styles'
import type { AvatarTreatment } from '~~/studio/avatarBackgrounds'

import AvatarRig from '~~/rig/AvatarRig.vue'
import { CAST_TONES, lookFor, PROFILE_TONES, toneFor } from '~~/studio/avatarBackgrounds'
import { useDocumentPool } from '~~/studio/composables/useDocumentPool'

useHead({ title: 'Gallery' })

const route = useRoute()

// The document pool, compiled live off `.data/jrig/`. Shared with the editor
// and the still page; `onScopeDispose` stops the interval with the page.
const pool = useDocumentPool()
const characters = computed(() => [...pool.styles.value].sort((a, b) => a.name.localeCompare(b.name)))
const emotes = computed(() => pool.clips.value.filter(clip => clip.layer === 'emote'))

const rigs = ref<Record<string, InstanceType<typeof AvatarRig> | null>>({})
const setRig = (id: string, instance: unknown) => {
  rigs.value[id] = instance as InstanceType<typeof AvatarRig> | null
}
const playAll = (clipId: string) => {
  Object.values(rigs.value).forEach(rig => rig?.play(clipId))
}

const base = ref<'idle' | 'talking'>('idle')
const ambient = ref(true)

// Avatar preview: the round chest-up cut-out, the way the product shows these
// in a cast list. A view over the same documents — nothing about them changes —
// so it is a toggle, and off is the full drawing exactly as before.
// Seeded from the query so the view is linkable: `?avatar=1&treatment=filled`.
const avatarMode = ref(route.query.avatar === '1')
const treatment = ref<AvatarTreatment>(route.query.treatment === 'filled' ? 'filled' : 'story')
const frame = computed(() => (avatarMode.value ? 'avatar' as const : 'bust' as const))

const palette = computed(() => (treatment.value === 'filled' ? PROFILE_TONES : CAST_TONES))
const look = (id: string) => lookFor(toneFor(id, palette.value), treatment.value)
const backdrop = (id: string) => (avatarMode.value ? look(id).background : null)
const ring = (id: string) => (avatarMode.value ? look(id).ring : null)

// One character across the whole set, so the palette reads as a palette rather
// than as a colour per card.
const swatchStyle = computed(() => characters.value[0])
const swatches = computed(() => palette.value.map(tone => lookFor(tone, treatment.value)))

// Clicking a card opens that one character on its own, with the clip library on
// buttons — the gallery compares, the modal interrogates.
const selected = ref<ArtStyle | null>(null)
const modalOpen = computed({
  get: () => selected.value !== null,
  set: (value: boolean) => {
    if (!value) {
      selected.value = null
    }
  },
})

// Deep link into a character: `?character=hoodieGuy`. Watched rather than read
// once, because a character does not exist until the pool has compiled.
watch([() => route.query.character, pool.styles], ([id]) => {
  if (typeof id !== 'string' || selected.value) {
    return
  }
  selected.value = pool.styles.value.find(style => style.id === id) ?? null
}, { immediate: true })

onMounted(() => pool.start())
</script>

<template>
  <div class="mx-auto max-w-6xl p-6 space-y-8">
    <div class="flex items-center gap-4">
      <h1 class="text-xl font-semibold">Gallery</h1>
      <div class="ms-auto flex items-center gap-3">
        <USelect v-model="base" :items="['idle', 'talking']" size="sm" />
        <USwitch v-model="ambient" label="Ambient" size="sm" />
        <USwitch v-model="avatarMode" label="Avatar" size="sm" />
        <USelect
          v-if="avatarMode"
          v-model="treatment"
          :items="[{ label: 'Story asset — white, coloured ring', value: 'story' }, { label: 'Filled — colour behind', value: 'filled' }]"
          value-key="value"
          size="sm"
        />
        <UButton to="/" variant="ghost" size="sm" icon="i-lucide-house">Home</UButton>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="emote in emotes"
        :key="emote.id"
        size="sm"
        variant="soft"
        @click="playAll(emote.id)"
      >
        {{ emote.name }}
      </UButton>
    </div>

    <section v-if="avatarMode && swatchStyle" class="space-y-3">
      <h2 class="text-sm font-medium text-muted">
        Backgrounds — {{ swatchStyle.name }} across the set kraken assigns round-robin by cast index
      </h2>
      <div class="flex flex-wrap gap-4">
        <figure v-for="swatch in swatches" :key="swatch.tone" class="m-0 w-28">
          <button
            type="button"
            class="w-full cursor-pointer rounded-full transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :aria-label="`Open ${swatchStyle.name} on ${swatch.tone}`"
            @click="selected = swatchStyle"
          >
            <AvatarRig
              :art="swatchStyle"
              :clips="pool.clips.value"
              :name="`${swatchStyle.name} on ${swatch.tone}`"
              :base="base"
              :ambient="ambient"
              frame="avatar"
              :background="swatch.background"
              :ring="swatch.ring"
              class="w-full"
            />
          </button>
          <figcaption class="pt-1.5 text-center text-xs">
            <span class="rounded-full px-2 py-0.5 text-neutral-900" :style="{ background: swatch.ring }">{{ swatch.tone }}</span>
          </figcaption>
        </figure>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-medium text-muted">Characters — compiled live from .data/jrig/documents</h2>
        <UBadge v-if="pool.errorCount.value" color="error" variant="soft" size="sm">
          {{ pool.errorCount.value }} validation errors
        </UBadge>
      </div>
      <p v-if="characters.length === 0" class="text-sm text-dimmed">
        No character documents yet — the server seeds house + hoodie + the clip library on first boot.
      </p>
      <div v-else class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <figure v-for="style in characters" :key="style.id" class="m-0">
          <button
            type="button"
            class="w-full cursor-pointer rounded-xl transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :aria-label="`Open ${style.name}`"
            @click="selected = style"
          >
            <AvatarRig
              :ref="instance => setRig(style.id, instance)"
              :art="style"
              :clips="pool.clips.value"
              :name="style.name"
              :base="base"
              :ambient="ambient"
              :frame="frame"
              :background="backdrop(style.id)"
              :ring="ring(style.id)"
              class="w-full"
              :class="avatarMode ? '' : 'rounded-lg'"
              :style="avatarMode ? undefined : 'background: #f4f1ea'"
            />
          </button>
          <figcaption class="pt-1.5 text-xs text-muted">{{ style.name }} — {{ style.blurb }}</figcaption>
        </figure>
      </div>
    </section>

    <CharacterModal
      v-model:open="modalOpen"
      :art="selected"
      :clips="pool.clips.value"
      :avatar="avatarMode"
      :treatment="treatment"
    />
  </div>
</template>
