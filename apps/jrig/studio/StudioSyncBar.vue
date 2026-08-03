<script setup lang="ts">
// Sync surface for whatever document is open: name + dirty dot, live
// validation chips, Save, and the two-stage conflict banner from
// useDocumentSync (external edit → reload/keep; stale save → reload/overwrite).
// Skeleton in M3; the studio proper adopts it unchanged in M4.
import { computed } from 'vue'

import type { SyncConflict } from './composables/useDocumentSync'
import type { Issue } from '../rig/validator'

const props = defineProps<{
  name: string | null
  dirty: boolean
  conflict: SyncConflict
  issues: Issue[]
}>()

const emit = defineEmits<{
  save: []
  discardMine: []
  keepMine: []
  overwrite: []
}>()

const errors = computed(() => props.issues.filter(issue => issue.level === 'error'))
const warnings = computed(() => props.issues.filter(issue => issue.level === 'warning'))
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-3">
      <span class="font-mono text-sm">
        {{ name ?? 'no document' }}
        <span v-if="dirty" class="text-amber-500" title="unsaved changes">●</span>
      </span>

      <UPopover v-if="errors.length">
        <UBadge color="error" variant="soft" size="sm">{{ errors.length }} errors</UBadge>
        <template #content>
          <ul class="max-w-md space-y-1 p-3 text-xs">
            <li v-for="(issue, i) in errors" :key="i">
              <span class="font-mono">{{ issue.path }}</span> — {{ issue.message }}
            </li>
          </ul>
        </template>
      </UPopover>
      <UPopover v-if="warnings.length">
        <UBadge color="warning" variant="soft" size="sm">{{ warnings.length }} warnings</UBadge>
        <template #content>
          <ul class="max-w-md space-y-1 p-3 text-xs">
            <li v-for="(issue, i) in warnings" :key="i">
              <span class="font-mono">{{ issue.path }}</span> — {{ issue.message }}
            </li>
          </ul>
        </template>
      </UPopover>
      <UBadge v-if="name && !errors.length && !warnings.length" color="success" variant="soft" size="sm">valid</UBadge>

      <UButton class="ms-auto" size="sm" :disabled="!name || !dirty" @click="emit('save')">
        Save <UKbd>⌘S</UKbd>
      </UButton>
    </div>

    <UAlert
      v-if="conflict === 'external'"
      color="warning"
      variant="soft"
      icon="i-lucide-file-diff"
      title="Edited outside the studio"
      description="This document changed on disk while you have unsaved changes."
    >
      <template #actions>
        <UButton size="xs" color="warning" @click="emit('discardMine')">Reload — discard mine</UButton>
        <UButton size="xs" variant="ghost" @click="emit('keepMine')">Keep mine</UButton>
      </template>
    </UAlert>

    <UAlert
      v-if="conflict === 'stale-save'"
      color="error"
      variant="soft"
      icon="i-lucide-file-x"
      title="Save blocked — the file changed underneath"
      description="Reload to take the disk version, or overwrite it with yours."
    >
      <template #actions>
        <UButton size="xs" color="error" @click="emit('overwrite')">Overwrite anyway</UButton>
        <UButton size="xs" variant="ghost" @click="emit('discardMine')">Reload — discard mine</UButton>
      </template>
    </UAlert>
  </div>
</template>
