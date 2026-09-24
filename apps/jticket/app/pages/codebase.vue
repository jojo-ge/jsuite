<script setup lang="ts">
// Codebase settings — everything jTicket knows about how THIS codebase wants
// agents to work in it, as opposed to what any one project is doing:
//
//   Worktrees — the codebase's worktree guide (written by the kickoff agent,
//               read by every worktree consumer) and the branches connected
//               to worktrees made from it.
//   Prompts   — the codebase's hand-off overrides, the layer between a
//               project's own and the global defaults.
//
// Scoped to the selected codebase, like every other page.
useHead({ title: 'Codebase settings' })

const { refresh } = useTracker()
const { current, refreshCodebases, label, scopedProjects } = useCodebase()
const { available: herdrUp } = useHerdr()
const { revision } = useLiveStatus()
const { render } = useMarkdown()
const { kickingOff, runKickoff, copyKickoff, clearGuide } = useWorktrees()

onMounted(() => {
  refresh().catch(() => {})
  refreshCodebases().catch(() => {})
})
// The kickoff agent PUTs the guide, a connect agent POSTs a link — both land
// in the store, and the stream says so.
watch(revision, () => refreshCodebases().catch(() => {}))

const guide = computed(() => current.value?.worktreeGuide ?? null)
const state = computed(() => current.value?.worktree.state ?? 'missing')
const showGuide = ref(false)

const STATE_BADGE = {
  missing: { color: 'neutral', label: 'Not set up' },
  ready: { color: 'success', label: 'Ready' },
  stale: { color: 'warning', label: 'Stale' },
} as const

// Which of this codebase's projects each link belongs to — links are keyed by
// branch, and a project names its integration branch.
function projectsOn(branch: string) {
  return scopedProjects.value.filter((p) => p.integrationBranch === branch)
}

function when(iso: string) {
  return iso ? new Date(iso).toLocaleString() : ''
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />
    <UContainer class="space-y-6 py-6">
      <div>
        <h1 class="text-xl font-semibold">Codebase settings</h1>
        <p v-if="current" class="mt-1 text-sm text-muted">
          <span class="font-medium text-default">{{ label(current) }}</span>
          <span class="ml-2 font-mono text-xs">{{ current.path }}</span>
        </p>
      </div>

      <div v-if="!current" class="flex items-center gap-2 py-10 text-sm text-muted">
        <UIcon name="i-lucide-loader-2" class="animate-spin" /> Loading the codebase…
      </div>

      <template v-else>
        <!-- ── Worktrees ── -->
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center gap-3">
              <UIcon name="i-lucide-git-fork" class="size-4 text-muted" />
              <div class="min-w-0 flex-1">
                <h2 class="text-sm font-semibold">Worktrees</h2>
                <p class="text-xs text-muted">
                  How this codebase creates, sets up, runs and tears down worktrees — asked of the codebase
                  itself. /jimplement, /jreproduce, jReview and integration branches all follow it.
                </p>
              </div>
              <UBadge :color="STATE_BADGE[state].color" variant="subtle">{{ STATE_BADGE[state].label }}</UBadge>
              <UBadge v-if="guide?.verified" color="success" variant="outline" size="sm">verified</UBadge>
              <UBadge v-else-if="guide" color="warning" variant="outline" size="sm">unverified</UBadge>
            </div>
          </template>

          <div class="space-y-4">
            <p v-if="!guide" class="text-sm text-muted">
              No guide yet. The kickoff runs an agent in this repo that reads how it's built, asks you in its
              herdr pane for anything the repo can't say (secrets, services, ports), proves the recipe on a
              throwaway worktree, and records it here.
            </p>

            <div v-else class="space-y-2 text-sm">
              <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                <span>Updated {{ when(guide.updatedAt) }}<template v-if="guide.author"> by {{ guide.author }}</template></span>
                <span>
                  Worktrees live in
                  <span class="font-mono text-default">{{ guide.root || 'wherever the guide says' }}</span>
                </span>
                <span>{{ guide.sources.length }} source file{{ guide.sources.length === 1 ? '' : 's' }} watched</span>
              </div>
              <UAlert
                v-if="state === 'stale'"
                color="warning"
                variant="subtle"
                icon="i-lucide-file-diff"
                title="Files the guide rests on have changed since it was written"
                :description="`${current.worktree.changed.join(', ')} — re-run the kickoff to bring it up to date.`"
              />
              <button
                type="button"
                class="flex items-center gap-1.5 text-xs text-primary hover:underline"
                @click="showGuide = !showGuide"
              >
                <UIcon :name="showGuide ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
                {{ showGuide ? 'Hide the guide' : 'Read the guide' }}
              </button>
              <div
                v-if="showGuide"
                class="jx-prose jx-prose-sm rounded-lg border border-default bg-elevated/30 px-4 py-3"
                v-html="render(guide.body)"
              />
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UTooltip text="Dispatch the kickoff into a herdr tab in this codebase's workspace — it's HITL, so it gets its own tab">
                <UButton
                  icon="i-lucide-terminal"
                  size="sm"
                  :disabled="!herdrUp"
                  :loading="kickingOff === current.path"
                  @click="runKickoff(current)"
                >
                  {{ guide ? 'Re-run kickoff' : 'Run kickoff' }} in herdr
                </UButton>
              </UTooltip>
              <UButton icon="i-lucide-copy" size="sm" color="neutral" variant="soft" @click="copyKickoff(current)">
                Copy prompt
              </UButton>
              <UButton
                v-if="guide"
                icon="i-lucide-trash-2"
                size="sm"
                color="neutral"
                variant="ghost"
                @click="clearGuide(current)"
              >
                Clear guide
              </UButton>
              <span v-if="!herdrUp" class="text-xs text-muted">herdr isn't running — copy the prompt instead.</span>
            </div>

            <!-- Connected branches -->
            <div v-if="current.worktreeLinks.length" class="space-y-2 border-t border-default pt-4">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Connected branches</h3>
              <div class="divide-y divide-default overflow-hidden rounded-lg border border-default">
                <div v-for="link in current.worktreeLinks" :key="link.branch" class="space-y-1 px-3 py-2.5">
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <UIcon name="i-lucide-git-branch" class="size-4 text-muted" />
                    <span class="font-mono text-xs">{{ link.branch }}</span>
                    <NuxtLink
                      v-for="p in projectsOn(link.branch)"
                      :key="p.id"
                      :to="`/projects/${p.key}`"
                      class="text-xs text-primary hover:underline"
                    >
                      {{ p.key }}
                    </NuxtLink>
                    <span class="ml-auto truncate font-mono text-xs text-muted">{{ link.path }}</span>
                  </div>
                  <div v-if="link.notes" class="jx-prose jx-prose-sm text-muted" v-html="render(link.notes)" />
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <!-- ── Prompts ── -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-message-square-code" class="size-4 text-muted" />
              <div class="min-w-0 flex-1">
                <h2 class="text-sm font-semibold">Prompts</h2>
                <p class="text-xs text-muted">
                  What this codebase's hand-offs say. First answer wins:
                  <span class="whitespace-nowrap font-mono">ticket → project → these →
                    <NuxtLink to="/prompts" class="text-primary hover:underline">global defaults</NuxtLink> → built-in</span>.
                </p>
              </div>
              <UBadge v-if="Object.keys(current.prompts).length" color="primary" variant="subtle" size="sm">
                {{ Object.keys(current.prompts).length }} overridden
              </UBadge>
            </div>
          </template>
          <PromptEditor scope="codebase" :codebase="current" />
        </UCard>
      </template>
    </UContainer>
  </div>
</template>
