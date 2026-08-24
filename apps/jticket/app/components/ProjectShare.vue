<script setup lang="ts">
// The share panel for a project (jTicket sync, DOC-30): create a share and get
// the link to paste to a coworker, re-share to re-arm it with a fresh room and
// expiry, stop sharing to revoke immediately. State comes from
// /api/projects/:id/share; the header button opens the modal, which fetches on
// open so the button itself costs nothing. On a project this machine IMPORTED
// (share.side 'importer') the panel is informational only — it names the
// creator; the share is theirs to rotate or revoke.
import type { Project } from '~/composables/useTracker'
import type { ShareViewDto as ShareView } from '~~/server/utils/shares'

const props = defineProps<{ project: Project }>()

const toast = useToast()
const { refresh } = useTracker()
const open = ref(false)
const loading = ref(false)
const busy = ref(false)
const share = ref<ShareView | null>(null)
// The 1–4 char key the shared project uses on both machines. Fixed for the
// share's lifetime once a share exists — the input locks to the record's key.
const sharedKey = ref('')
// The coworker's name — it badges their half of the project on this machine.
// Required until the project is armed; a later share can refresh it.
const peerName = ref(props.project.share?.peerName ?? '')

const armed = computed(() => !!props.project.share)
// This machine imported the project from a share link: the room is the
// creator's to rotate, so the panel offers no share actions here (the API
// would 409 them anyway) and names the creator instead.
const imported = computed(() => props.project.share?.side === 'importer')
// On the importer side, peerName is the creator's name (typed at import).
const creatorName = computed(() => props.project.share?.peerName ?? '')
const keyValid = computed(() => /^[A-Z][A-Z0-9]{0,3}$/.test(sharedKey.value))
const canShare = computed(() => keyValid.value && (armed.value || !!peerName.value.trim()))
const expiresLabel = computed(() =>
  share.value ? new Date(share.value.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
)

const STATUS_META = {
  active: { label: 'Sharing', color: 'success' as const },
  revoked: { label: 'Stopped', color: 'neutral' as const },
  expired: { label: 'Expired', color: 'warning' as const },
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ share: ShareView | null }>(`/api/projects/${props.project.id}/share`)
    share.value = res.share
    if (res.share) sharedKey.value = res.share.sharedKey
  } catch {
    share.value = null
  } finally {
    loading.value = false
  }
}

watch(open, (v) => {
  // No fetch on an imported project: the panel is informational there, and the
  // record's derived link would claim the creator side.
  if (v && !imported.value) load()
})

async function createOrRearm() {
  if (!canShare.value || busy.value) return
  busy.value = true
  try {
    const res = await $fetch<{ share: ShareView }>(`/api/projects/${props.project.id}/share`, {
      method: 'POST',
      body: { sharedKey: sharedKey.value, peerName: peerName.value.trim() },
    })
    share.value = res.share
    // Sharing arms the project (share side, ownership stamps) — pull the
    // armed state in so badges and the key change show without a reload.
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Could not share', description: e?.data?.statusMessage ?? String(e), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function stopSharing() {
  if (busy.value) return
  busy.value = true
  try {
    const res = await $fetch<{ share: ShareView }>(`/api/projects/${props.project.id}/share`, { method: 'DELETE' })
    share.value = res.share
    toast.add({ title: 'Sharing stopped', description: 'The link is dead from now on.', color: 'neutral', icon: 'i-lucide-link-2-off' })
  } catch (e: any) {
    toast.add({ title: 'Could not stop sharing', description: e?.data?.statusMessage ?? String(e), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function copyLink() {
  if (!share.value?.link) return
  await navigator.clipboard.writeText(share.value.link)
  toast.add({ title: 'Link copied', description: `Valid until ${expiresLabel.value}.`, color: 'success', icon: 'i-lucide-clipboard-check' })
}
</script>

<template>
  <UTooltip :text="imported ? `Imported from ${creatorName}'s share` : 'Share this project with a coworker'">
    <UButton
      :icon="imported ? 'i-lucide-download' : 'i-lucide-share-2'"
      size="sm"
      color="neutral"
      variant="ghost"
      :aria-label="imported ? 'Sharing details' : 'Share project'"
      @click="open = true"
    />
  </UTooltip>

  <UModal v-model:open="open" :title="imported ? `${project.key} is shared by ${creatorName}` : `Share ${project.key}`" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <!-- Importer side: informational only — creating, re-sharing and
           stopping are the creator's; the API refuses them from here. -->
      <div v-if="imported" class="space-y-4">
        <div class="flex items-center gap-2">
          <UBadge color="info" variant="subtle" size="sm">Imported</UBadge>
          <span class="text-xs text-muted">From {{ creatorName }}</span>
        </div>
        <p class="text-sm text-muted">
          You imported this project from {{ creatorName }}'s share link. The share is
          theirs to manage — only they can re-share it or stop sharing. Ask them for a fresh link
          if the room has gone quiet.
        </p>
      </div>

      <div v-else-if="loading" class="py-10 text-center text-sm text-muted">Loading…</div>

      <div v-else class="space-y-4">
        <div v-if="share" class="flex items-center gap-2">
          <UBadge :color="STATUS_META[share.status].color" variant="subtle" size="sm">
            {{ STATUS_META[share.status].label }}
          </UBadge>
          <span v-if="share.status === 'active'" class="text-xs text-muted">
            {{ project.share ? `With ${project.share.peerName} — link` : 'Link' }} valid until {{ expiresLabel }}
          </span>
        </div>

        <!-- Active: the link to paste, plus re-share / stop -->
        <template v-if="share?.status === 'active' && share.link">
          <UFieldGroup class="w-full">
            <UInput :model-value="share.link" readonly class="grow font-mono text-xs" aria-label="Share link" />
            <UButton icon="i-lucide-clipboard" color="neutral" variant="outline" @click="copyLink">Copy</UButton>
          </UFieldGroup>
          <p class="text-xs text-muted">
            Paste this to your coworker — it opens their jTicket's import screen. The secret rides the
            link itself; re-sharing makes a fresh link and kills this one's room.
          </p>
          <div class="flex justify-end gap-2">
            <UButton color="error" variant="soft" icon="i-lucide-link-2-off" :loading="busy" @click="stopSharing">
              Stop sharing
            </UButton>
            <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="busy" @click="createOrRearm">
              Re-share
            </UButton>
          </div>
        </template>

        <!-- Not shared (never, stopped, or expired): pick the key, share -->
        <template v-else>
          <UFormField
            label="Shared project key"
            :help="share ? 'The key is fixed for this share — re-sharing makes a fresh link and 2-hour window.' : '1–4 characters, used as the ticket prefix on both machines (like TICK, but yours).'"
          >
            <UInput
              v-model="sharedKey"
              placeholder="e.g. CART"
              maxlength="4"
              :disabled="!!share"
              class="w-32 font-mono uppercase"
              @update:model-value="sharedKey = String($event).toUpperCase()"
              @keydown.enter="createOrRearm"
            />
          </UFormField>
          <UFormField
            label="Coworker's name"
            :help="armed ? 'Leave as is, or update how their half is badged.' : 'Their tickets, docs and comments will be badged with this name here.'"
          >
            <UInput
              v-model="peerName"
              placeholder="e.g. Sam"
              class="w-48"
              @keydown.enter="createOrRearm"
            />
          </UFormField>
          <div class="flex justify-end">
            <UButton icon="i-lucide-share-2" :disabled="!canShare" :loading="busy" @click="createOrRearm">
              {{ share ? 'Re-share' : 'Create share link' }}
            </UButton>
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
