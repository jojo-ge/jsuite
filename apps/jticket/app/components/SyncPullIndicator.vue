<script setup lang="ts">
// The global face of pending pull approvals (TICK-307). A pull request
// surfaces on its project's page (SyncPullRequests), but the human may be on
// any page when it arrives — and it expires unanswered. So the header shows
// a badge that leads to the project page, where approve/deny lives.
// Requester names come from the server's own record (project.share.peerName),
// never wire text.
//
// 5s against a 120s request TTL: prompt enough to be seen, and the endpoint
// is an in-memory read.
const { pulls } = usePendingPulls(5000)

// All pending pulls on one project → the button links straight to it;
// several projects → a menu, one row per pull, each landing on its page.
const soleProjectPull = computed(() => {
  const ids = new Set(pulls.value.map((p) => p.projectId))
  return ids.size === 1 ? pulls.value[0]! : null
})
const soleProjectHint = computed(() => {
  const p = soleProjectPull.value
  if (!p) return ''
  return pulls.value.length === 1
    ? `${p.requester} wants to pull ${p.projectKey} — answer on the project page`
    : `${pulls.value.length} pending pull requests on ${p.projectKey} — answer on the project page`
})
const items = computed(() =>
  pulls.value.map((p) => ({
    label: `${p.requester} — ${p.projectKey} ${p.projectTitle}`,
    icon: 'i-lucide-download-cloud',
    to: `/projects/${p.projectId}`,
  })),
)
</script>

<template>
  <div v-if="pulls.length" class="shrink-0">
    <UTooltip v-if="soleProjectPull" :text="soleProjectHint">
      <UButton
        icon="i-lucide-download-cloud"
        color="primary"
        variant="soft"
        size="sm"
        :to="`/projects/${soleProjectPull.projectId}`"
        aria-label="Pending pull request — open the project page"
      >
        <span class="hidden lg:inline">Pull request</span>
        <UBadge color="primary" variant="subtle" size="sm">{{ pulls.length }}</UBadge>
      </UButton>
    </UTooltip>
    <UDropdownMenu v-else :items="items">
      <UButton
        icon="i-lucide-download-cloud"
        color="primary"
        variant="soft"
        size="sm"
        aria-label="Pending pull requests"
      >
        <span class="hidden lg:inline">Pull requests</span>
        <UBadge color="primary" variant="subtle" size="sm">{{ pulls.length }}</UBadge>
      </UButton>
    </UDropdownMenu>
  </div>
</template>
