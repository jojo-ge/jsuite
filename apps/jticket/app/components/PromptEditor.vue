<script setup lang="ts">
// The hand-off prompt editor, used at two scopes: the suite-wide defaults
// (/prompts) and one project's overrides (the project page's Prompts panel).
// Same rows either way — what changes is where a save lands and what an empty
// box falls through to, which is the whole point of the layering.
import type { Project } from '~/composables/useTracker'
import type { PromptKind, PromptOverrides, PromptVars } from '~/utils/prompts'

const props = defineProps<{
  // 'global' edits store.promptDefaults; 'project' edits project.prompts.
  scope: 'global' | 'project'
  project?: Project | null
}>()

const toast = useToast()
const { defaults, loaded, saveDefaults, templateFor } = usePrompts()
const { updateProject } = useTracker()

// What this scope has stored right now — the box's saved value.
const stored = computed<PromptOverrides>(() =>
  props.scope === 'project' ? (props.project?.prompts ?? {}) : defaults.value,
)

// What an empty box falls through to. At project scope that is the global
// default (or the built-in); at global scope it is always the built-in.
function inherited(kind: PromptKind) {
  return props.scope === 'project'
    ? templateFor(kind, null)
    : { template: PROMPT_KIND_META[kind].template, layer: 'built-in' as const }
}

const LAYER_LABEL = {
  project: 'This project',
  default: 'Global default',
  'built-in': 'Built-in',
} as const

// One draft per kind, filled from what's stored. The stored map changes under
// us often — the defaults land after SSR, and saving one kind refetches the
// whole project — so a refill only touches the boxes still holding exactly
// what it last put there. Anything typed since is yours to keep.
const drafts = reactive<Record<string, string>>({})
const seeded = reactive<Record<string, string>>({})
function seed() {
  for (const kind of PROMPT_KINDS) {
    const next = stored.value[kind] ?? ''
    if (drafts[kind] === undefined || drafts[kind] === seeded[kind]) {
      drafts[kind] = next
      seeded[kind] = next
    }
  }
}
seed()
watch([stored, loaded], seed)

const open = ref<Record<string, boolean>>({})
function toggle(kind: PromptKind) {
  open.value = { ...open.value, [kind]: !open.value[kind] }
}

const dirty = (kind: PromptKind) => (drafts[kind] ?? '') !== (stored.value[kind] ?? '')
const overridden = (kind: PromptKind) => !!stored.value[kind]

// The values a preview renders with: this project's real ones where we have
// them, stand-ins for the ticket (there is no ticket at either scope).
const sampleVars = computed<PromptVars>(() => ({
  key: 'TICK-42',
  title: 'Persist the cart across sessions',
  branch: 'tick-42-persist-the-cart',
  onBranch: ' on the existing branch tick-42-persist-the-cart',
  projectKey: props.project?.key ?? 'PROJ-1',
  projectTitle: props.project?.title ?? 'Checkout',
  repo: props.project?.repo || '~/code/checkout',
  integrationBranch: props.project?.integrationBranch || 'proj-1-integration',
  prs: 'PR-3, PR-4',
}))

// What this kind fires today, at this scope — the draft if you've typed one,
// otherwise whatever it inherits.
function preview(kind: PromptKind) {
  const text = drafts[kind]?.trim() || inherited(kind).template
  return renderPrompt(text, sampleVars.value)
}

const saving = ref<PromptKind | null>(null)
async function save(kind: PromptKind) {
  if (saving.value) return
  saving.value = kind
  try {
    const patch = { [kind]: drafts[kind] ?? '' } as PromptOverrides
    if (props.scope === 'project') {
      if (!props.project) return
      await updateProject(props.project.id, { prompts: patch })
    } else {
      await saveDefaults(patch)
    }
    // This box now holds what's stored again, so a later refill may touch it.
    seeded[kind] = drafts[kind] ?? ''
    toast.add({
      title: drafts[kind]?.trim() ? `${PROMPT_KIND_META[kind].label} prompt saved` : `${PROMPT_KIND_META[kind].label} prompt reset`,
      description: drafts[kind]?.trim()
        ? props.scope === 'project'
          ? `${props.project?.key} fires your text for this hand-off.`
          : 'Every project without its own override fires your text.'
        : `Back to the ${inherited(kind).layer === 'built-in' ? 'built-in' : 'global default'} text.`,
      icon: 'i-lucide-message-square-code',
      color: 'success',
    })
  } catch (err: any) {
    toast.add({
      title: 'Could not save the prompt',
      description: err?.statusMessage ?? err?.message ?? 'Unknown error',
      icon: 'i-lucide-triangle-alert',
      color: 'error',
    })
  } finally {
    saving.value = null
  }
}

/** Drop the override — an empty box is how the layer below takes over again. */
function clear(kind: PromptKind) {
  drafts[kind] = ''
  return save(kind)
}

/** Start from the inherited text rather than a blank box. */
function fillFromInherited(kind: PromptKind) {
  drafts[kind] = inherited(kind).template
}
</script>

<template>
  <div class="space-y-6">
    <div
      v-for="group in PROMPT_GROUPS"
      :key="group"
      class="space-y-2"
    >
      <h3 class="text-xs font-semibold uppercase tracking-wide text-dimmed">{{ group }}</h3>
      <div class="divide-y divide-default overflow-hidden rounded-lg border border-default">
        <div v-for="kind in promptKindsInGroup(group)" :key="kind">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-elevated/50"
            :aria-expanded="!!open[kind]"
            @click="toggle(kind)"
          >
            <UIcon
              :name="open[kind] ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-4 shrink-0 text-dimmed"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ PROMPT_KIND_META[kind].label }}</p>
              <p class="truncate text-xs text-muted">{{ PROMPT_KIND_META[kind].hint }}</p>
            </div>
            <UBadge
              v-if="overridden(kind)"
              color="primary"
              variant="subtle"
              size="sm"
            >
              {{ scope === 'project' ? 'This project' : 'Custom' }}
            </UBadge>
            <UBadge v-else color="neutral" variant="subtle" size="sm">
              {{ LAYER_LABEL[inherited(kind).layer] }}
            </UBadge>
          </button>

          <div v-if="open[kind]" class="space-y-3 border-t border-default bg-elevated/30 px-3 py-3">
            <UFormField
              :label="`${PROMPT_KIND_META[kind].label} prompt`"
              :help="
                overridden(kind)
                  ? 'Clear the box and save to fall back to the layer below.'
                  : `Empty — this uses the ${LAYER_LABEL[inherited(kind).layer].toLowerCase()} text shown as the placeholder.`
              "
            >
              <UTextarea
                v-model="drafts[kind]"
                :rows="4"
                autoresize
                :maxrows="14"
                class="w-full font-mono"
                :ui="{ base: 'text-xs' }"
                :placeholder="inherited(kind).template"
              />
            </UFormField>

            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-xs text-dimmed">Variables:</span>
              <UTooltip
                v-for="v in PROMPT_KIND_META[kind].vars"
                :key="v"
                :text="PROMPT_VAR_HINTS[v]"
              >
                <code class="cursor-help rounded bg-elevated px-1.5 py-0.5 font-mono text-xs text-muted">{{ promptVarToken(v) }}</code>
              </UTooltip>
            </div>

            <div>
              <p class="mb-1 text-xs text-dimmed">
                What {{ scope === 'project' ? project?.key : 'a project with no override' }} would fire:
              </p>
              <pre class="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-default bg-default p-2 font-mono text-xs text-muted">{{ preview(kind) }}</pre>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UButton
                size="xs"
                icon="i-lucide-save"
                :loading="saving === kind"
                :disabled="!dirty(kind) || !!saving"
                @click="save(kind)"
              >
                Save
              </UButton>
              <UButton
                v-if="overridden(kind)"
                size="xs"
                variant="soft"
                color="neutral"
                icon="i-lucide-rotate-ccw"
                :disabled="!!saving"
                @click="clear(kind)"
              >
                Reset to {{ LAYER_LABEL[inherited(kind).layer].toLowerCase() }}
              </UButton>
              <UButton
                v-if="!drafts[kind]"
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-copy"
                @click="fillFromInherited(kind)"
              >
                Start from the current text
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
