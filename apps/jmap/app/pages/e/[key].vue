<script setup lang="ts">
// Reader for domain walkthrough documents — the same shared-pool page jExplain
// serves, here so the `/e/<key>` links a map produces work inside this app too.
const route = useRoute()
const router = useRouter()
const key = computed(() => String(route.params.key))

const { data: doc, error } = await useFetch(() => `/api/documents/${key.value}`)

const railOpen = ref(false)
const progress = ref(0)
const article = ref<{ writtenCount: number } | null>(null)
const writtenCount = computed(() => article.value?.writtenCount ?? 0)

useHead(() => ({ title: doc.value?.title ?? key.value }))
</script>

<template>
  <div class="flex h-screen flex-col">
    <div class="jx-progress" :style="{ width: `${progress}%` }" />

    <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" aria-label="Back" @click="router.back()" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-muted">{{ doc?.title }}</span>
      <UButton
        :icon="railOpen ? 'i-lucide-panel-right-close' : 'i-lucide-message-square'"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="writtenCount ? String(writtenCount) : 'Notes'"
        @click="railOpen = !railOpen"
      />
    </header>

    <div v-if="error" class="p-8 text-center text-muted">
      <p class="mb-3">No document called <code>{{ key }}</code>.</p>
      <UButton to="/" label="Back to maps" />
    </div>

    <DocumentArticle
      v-else-if="doc"
      ref="article"
      :doc="doc"
      v-model:rail-open="railOpen"
      @progress="progress = $event"
    />
  </div>
</template>
