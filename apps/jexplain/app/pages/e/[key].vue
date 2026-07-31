<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const key = computed(() => String(route.params.key))

const { data: doc, error } = await useFetch(() => `/api/documents/${key.value}`)

const railOpen = ref(false)
const progress = ref(0)
const article = ref<{ writtenCount: number } | null>(null)
const writtenCount = computed(() => article.value?.writtenCount ?? 0)

async function removeDoc() {
  if (!window.confirm(`Delete "${doc.value?.title}" and its notes? Charts stay in jChart.`)) return
  await $fetch(`/api/documents/${key.value}`, { method: 'DELETE' })
  router.push('/')
}

useHead(() => ({ title: doc.value?.title ?? key.value }))
</script>

<template>
  <div class="flex h-screen flex-col">
    <div class="jx-progress" :style="{ width: `${progress}%` }" />

    <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" aria-label="All explainers" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-muted">{{ doc?.title }}</span>
      <UButton
        :icon="railOpen ? 'i-lucide-panel-right-close' : 'i-lucide-message-square'"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="writtenCount ? String(writtenCount) : 'Notes'"
        @click="railOpen = !railOpen"
      />
      <UButton
        icon="i-lucide-trash-2"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Delete explainer"
        @click="removeDoc"
      />
    </header>

    <div v-if="error" class="p-8 text-center text-muted">
      <p class="mb-3">No explainer called <code>{{ key }}</code>.</p>
      <UButton to="/" label="Back to all explainers" />
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
