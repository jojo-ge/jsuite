<script setup lang="ts">
// The import screen — where a coworker's share link lands (jTicket sync, spec
// DOC-30). The capability blob rides the URL fragment, which never reaches any
// server on its own; this page posts it to the local validate endpoint, shows
// what confirming would do, and creates the local shared project on confirm.
// Every refusal (expired link, malformed blob, shared-key clash, own link) is
// the server's message, shown verbatim.
import type { Project } from '~/composables/useTracker'
import type { ImportPreviewDto as Preview } from '~~/server/utils/importLink'

useHead({ title: 'Import a shared project' })

const fragment = ref('')
// Pasting the whole link is fine — everything after the # is the fragment.
const pasted = ref('')
const peerName = ref('')
const preview = ref<Preview | null>(null)
const error = ref('')
const checking = ref(false)
const importing = ref(false)

const expiresLabel = computed(() =>
  preview.value ? new Date(preview.value.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
)
const parityLabel = computed(() =>
  preview.value?.side === 'importer' ? 'even ticket numbers' : 'odd ticket numbers',
)

async function validate(frag: string) {
  fragment.value = frag
  preview.value = null
  error.value = ''
  if (!frag) return
  checking.value = true
  try {
    const res = await $fetch<{ preview: Preview }>('/api/shares/validate', {
      method: 'POST',
      body: { fragment: frag },
    })
    preview.value = res.preview
    if (res.preview.peerName) peerName.value = res.preview.peerName
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'that does not look like a share link'
  } finally {
    checking.value = false
  }
}

function onPaste() {
  const raw = pasted.value.trim()
  validate(raw.includes('#') ? raw.split('#').pop()! : raw)
}

async function confirmImport() {
  if (!preview.value || importing.value) return
  importing.value = true
  try {
    const res = await $fetch<{ project: Project; rearmed: boolean }>('/api/shares/import', {
      method: 'POST',
      body: { fragment: fragment.value, peerName: peerName.value.trim() },
    })
    useToast().add({
      title: res.rearmed ? 'Share updated' : `Imported ${res.project.share?.key}`,
      description: res.rearmed
        ? 'Same shared project, fresh room — pulls will use the new link.'
        : `You mint the even ticket numbers; ${res.project.share?.peerName} keeps the odd ones.`,
      color: 'success',
      icon: 'i-lucide-download',
    })
    await navigateTo(`/projects/${res.project.id}`)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? String(e)
  } finally {
    importing.value = false
  }
}

// The fragment survives only in the browser — read it after mount and clear
// the URL so the secret doesn't linger in the address bar.
onMounted(() => {
  const frag = window.location.hash.slice(1)
  if (frag) {
    history.replaceState(null, '', window.location.pathname)
    validate(frag)
  }
})
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="max-w-xl py-12">
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-bold">Import a shared project</h1>
        <p class="mt-1 text-sm text-muted">
          A coworker's share link creates their project here, split into your half and theirs.
        </p>
      </div>

      <div class="space-y-4">
        <div v-if="checking" class="py-10 text-center text-sm text-muted">Checking the link…</div>

        <!-- The link's verdict: one honest error, renegotiation included -->
        <UAlert
          v-else-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-link-2-off"
          title="This link can't be imported"
          :description="error"
        />

        <!-- What confirming will do -->
        <template v-else-if="preview">
          <div class="rounded-lg border border-default bg-elevated/30 p-4 space-y-3">
            <div class="flex items-center gap-2">
              <UBadge color="primary" variant="subtle" size="lg" class="font-mono">{{ preview.sharedKey }}</UBadge>
              <span class="text-sm text-muted">shared project key on both machines</span>
            </div>
            <p class="text-sm">
              <template v-if="preview.existingProjectId">
                You already imported this project — confirming updates its room and expiry from the
                fresh link, nothing else.
              </template>
              <template v-else>
                Confirming creates the shared project locally. Tickets you mint take the
                {{ parityLabel }} under <span class="font-mono">{{ preview.sharedKey }}</span
                >; your coworker's half stays theirs — read-only here and never dispatchable.
              </template>
            </p>
            <p class="text-xs text-muted">Link valid until {{ expiresLabel }}.</p>
          </div>

          <UFormField
            v-if="!preview.existingProjectId"
            label="Your coworker's name"
            help="Shown on their tickets, docs and comments here."
          >
            <UInput v-model="peerName" placeholder="e.g. Ana" class="w-48" @keydown.enter="confirmImport" />
          </UFormField>

          <div class="flex justify-end">
            <UButton
              icon="i-lucide-download"
              :disabled="!preview.existingProjectId && !peerName.trim()"
              :loading="importing"
              @click="confirmImport"
            >
              {{ preview.existingProjectId ? 'Update share' : 'Import project' }}
            </UButton>
          </div>
        </template>

        <!-- No fragment (or a bad one): let them paste the link by hand -->
        <UFormField
          v-if="!preview && !checking"
          label="Share link"
          help="Paste the whole link your coworker sent you."
        >
          <UInput
            v-model="pasted"
            placeholder="https://…/import#…"
            class="w-full font-mono text-xs"
            @keydown.enter="onPaste"
            @paste="nextTick(onPaste)"
          />
        </UFormField>
      </div>
    </UContainer>
  </div>
</template>
