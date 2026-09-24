<script setup lang="ts">
// The integration branch's worktree row, under the branch on the GitHub panel:
// is this branch connected to a worktree made the codebase's way, and if not,
// the button that asks an agent to do it.
//
// Connecting is AI, not mechanics — the button fires the 'worktree:connect'
// prompt (resolved through the usual layers) into herdr, and the agent follows
// the codebase's worktree guide and POSTs the link back. Before there is a
// guide the button runs the codebase's kickoff instead. "Linked" is git's word:
// GET /api/projects/:id/worktree re-checks the recorded path against `git
// worktree list` on every read, and the live stream refetches it the moment an
// agent writes the link.
import type { Project } from '~/composables/useTracker'
import type { GuideState, WorktreeLink } from '~/composables/useCodebase'

const props = defineProps<{ project: Project }>()

interface WorktreeStatus {
  repo: string
  branch: string
  guide: { state: GuideState; changed: string[]; updatedAt: string; verified: boolean; root: string }
  state: 'linked' | 'broken' | 'unlinked-checked-out' | 'unlinked' | 'no-branch' | 'no-repo'
  link: WorktreeLink | null
  checkedOutAt: string | null
}

const toast = useToast()
const { available: herdrUp } = useHerdr()
const { revision } = useLiveStatus()
const { render } = useMarkdown()
const { codebaseOf, refreshCodebases } = useCodebase()
const { connecting, runConnect, copyConnect, kickingOff, runKickoff } = useWorktrees()

const { data, refresh, pending } = useFetch<WorktreeStatus>(() => `/api/projects/${props.project.id}/worktree`, {
  lazy: true,
  server: false,
  watch: [() => props.project.integrationBranch, () => props.project.repo],
})
watch(revision, () => refresh())

const codebase = computed(() => codebaseOf(props.project))
const showNotes = ref(false)

async function connect() {
  await runConnect(props.project)
}
async function kickoff() {
  if (!codebase.value) await refreshCodebases().catch(() => {})
  if (codebase.value) await runKickoff(codebase.value)
}

async function unlink() {
  await $fetch(`/api/projects/${props.project.id}/worktree`, { method: 'DELETE' })
  toast.add({ title: 'Worktree link forgotten', description: 'The worktree itself is untouched.', icon: 'i-lucide-unlink', color: 'neutral' })
  await refresh()
}
</script>

<template>
  <div
    v-if="data && data.state !== 'no-branch' && data.state !== 'no-repo'"
    class="mt-2 space-y-1.5 border-t border-default/60 pt-2 text-sm"
  >
    <div class="flex flex-wrap items-center gap-2">
      <UIcon name="i-lucide-git-fork" class="size-4 shrink-0 text-muted" />

      <!-- No guide yet: the codebase has to be asked first -->
      <template v-if="data.guide.state === 'missing'">
        <span class="text-xs text-muted">This codebase hasn't said how it does worktrees yet.</span>
        <div class="ml-auto flex gap-1">
          <UButton to="/codebase" size="xs" color="neutral" variant="ghost" icon="i-lucide-sliders-horizontal">
            Codebase settings
          </UButton>
          <UTooltip text="Ask the codebase how it creates, sets up, runs and tears down worktrees (HITL, own herdr tab)">
            <UButton
              size="xs"
              icon="i-lucide-terminal"
              variant="soft"
              :disabled="!herdrUp"
              :loading="kickingOff === data.repo"
              @click="kickoff"
            >
              Set up worktrees
            </UButton>
          </UTooltip>
        </div>
      </template>

      <template v-else>
        <template v-if="data.state === 'linked'">
          <UBadge color="success" variant="subtle" size="sm">worktree linked</UBadge>
          <span class="truncate font-mono text-xs text-muted">{{ data.link?.path }}</span>
        </template>
        <template v-else-if="data.state === 'broken'">
          <UBadge color="warning" variant="subtle" size="sm">link broken</UBadge>
          <span class="text-xs text-muted">
            <span class="font-mono">{{ data.link?.path }}</span>
            no longer has {{ data.branch }} checked out<template v-if="data.checkedOutAt"> — it's at <span class="font-mono">{{ data.checkedOutAt }}</span></template>.
          </span>
        </template>
        <template v-else-if="data.state === 'unlinked-checked-out'">
          <UBadge color="neutral" variant="subtle" size="sm">not linked</UBadge>
          <span class="text-xs text-muted">
            Already checked out at <span class="font-mono">{{ data.checkedOutAt }}</span> — connecting adopts it.
          </span>
        </template>
        <template v-else>
          <UBadge color="neutral" variant="subtle" size="sm">no worktree</UBadge>
          <span class="text-xs text-muted">Not connected to the codebase's worktree setup.</span>
        </template>

        <UTooltip v-if="data.guide.state === 'stale'" :text="`Changed since the guide was written: ${data.guide.changed.join(', ')}`">
          <UBadge color="warning" variant="outline" size="sm" icon="i-lucide-file-diff">guide stale</UBadge>
        </UTooltip>

        <div class="ml-auto flex gap-1">
          <UTooltip text="Check the link against git again">
            <UButton
              icon="i-lucide-refresh-cw"
              size="xs"
              color="neutral"
              variant="ghost"
              :loading="pending"
              aria-label="Check the worktree link"
              @click="refresh()"
            />
          </UTooltip>
          <UTooltip v-if="data.link" text="Forget the link (the worktree stays on disk)">
            <UButton icon="i-lucide-unlink" size="xs" color="neutral" variant="ghost" aria-label="Forget the worktree link" @click="unlink" />
          </UTooltip>
          <UTooltip text="Copy the connect prompt">
            <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" aria-label="Copy the connect prompt" @click="copyConnect(project)" />
          </UTooltip>
          <UTooltip
            v-if="data.state !== 'linked'"
            text="An agent checks this branch out in a worktree the codebase's way, sets it up and records the link (own herdr tab)"
          >
            <UButton
              icon="i-lucide-git-fork"
              size="xs"
              color="secondary"
              variant="soft"
              :disabled="!herdrUp"
              :loading="connecting === project.id"
              @click="connect"
            >
              {{ data.state === 'broken' ? 'Reconnect' : 'Connect worktree' }}
            </UButton>
          </UTooltip>
        </div>
      </template>
    </div>

    <div v-if="data.state === 'linked' && data.link?.notes" class="pl-6">
      <button type="button" class="flex items-center gap-1 text-xs text-primary hover:underline" @click="showNotes = !showNotes">
        <UIcon :name="showNotes ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
        How to run it
      </button>
      <div v-if="showNotes" class="jx-prose jx-prose-sm mt-1 text-muted" v-html="render(data.link.notes)" />
    </div>
  </div>
</template>
