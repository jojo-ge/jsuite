<script setup lang="ts">
// A project's herdr presence: a button that focuses its workspace, one chip per
// open tab (dotted by agent status), and the brush that closes them all. Shared
// by the board's recap banner and the project page's Agents tab; renders
// nothing while herdr is down or the project has no workspace yet.
import type { Project } from '~/composables/useTracker'

const props = defineProps<{ project: Project }>()

const { herdrUp, workspaceFor, projectTabs, focusHerdr, cleaningUp, cleanupHerdr } = useHerdrDispatch()
const herdrWorkspace = computed(() => workspaceFor(props.project))
const herdrTabs = computed(() => projectTabs(props.project))
</script>

<template>
  <template v-if="herdrUp && herdrWorkspace">
    <UTooltip :text="`Go to the ${project.title} workspace in herdr`">
      <UButton
        icon="i-lucide-app-window"
        color="neutral"
        variant="soft"
        size="xs"
        :aria-label="`Focus the ${project.title} workspace in herdr`"
        @click="focusHerdr({ workspace: herdrWorkspace.workspaceId })"
      >
        herdr
      </UButton>
    </UTooltip>
    <UButton
      v-for="tab in herdrTabs"
      :key="tab.tabId"
      size="xs"
      color="neutral"
      variant="ghost"
      class="font-mono text-xs"
      :aria-label="`Focus herdr tab ${tab.label}`"
      @click="focusHerdr({ tab: tab.tabId })"
    >
      <span
        class="mr-1 inline-block size-1.5 rounded-full"
        :class="{
          'bg-info': tab.agentStatus === 'working',
          'bg-warning': tab.agentStatus === 'blocked',
          'bg-success': tab.agentStatus === 'idle' || tab.agentStatus === 'done',
          'bg-neutral-400': !tab.agentStatus || tab.agentStatus === 'unknown',
        }"
      />
      {{ tab.label }}
    </UButton>
    <UTooltip
      v-if="herdrTabs.length"
      :text="`Close ${project.key}'s herdr tabs (asks first if an agent is still busy)`"
    >
      <UButton
        icon="i-lucide-paintbrush"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="cleaningUp === project.id"
        :aria-label="`Close ${project.key}'s herdr tabs`"
        @click="cleanupHerdr(project)"
      />
    </UTooltip>
  </template>
</template>
