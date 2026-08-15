<script setup lang="ts">
import type { FilePayload } from '~/utils/agentTypes'

// The lean read-only worktree diff viewer. Same FilePayload the jDiff review
// UI renders, none of the review affordance — this one only has to show the
// tree changing under a live agent. Polls ~2s with the hash it already holds;
// the server re-highlights only when the raw diff actually changed.
const props = defineProps<{ runId: string; active: boolean }>()

const files = ref<FilePayload[]>([])
const hash = ref('')
const loaded = ref(false)
const collapsed = ref<Set<string>>(new Set())

let timer: ReturnType<typeof setInterval> | null = null

async function poll() {
  if (document.hidden) return
  try {
    const res = await $fetch<{ unchanged?: boolean; hash: string; files?: FilePayload[] }>(
      `/api/runs/${props.runId}/diff`,
      { query: hash.value ? { hash: hash.value } : {} },
    )
    hash.value = res.hash
    if (!res.unchanged && res.files) files.value = res.files
    loaded.value = true
  } catch { /* server hiccup — next tick retries */ }
}

watch(
  () => [props.runId, props.active] as const,
  ([, active]) => {
    if (timer) clearInterval(timer)
    timer = null
    if (!active) return
    files.value = []
    hash.value = ''
    loaded.value = false
    void poll()
    timer = setInterval(poll, 2000)
  },
  { immediate: true },
)
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

function toggle(path: string) {
  const next = new Set(collapsed.value)
  next.has(path) ? next.delete(path) : next.add(path)
  collapsed.value = next
}

const STATUS_TINT: Record<FilePayload['status'], string> = {
  added: 'text-emerald-500',
  deleted: 'text-red-500',
  renamed: 'text-amber-500',
  modified: 'text-sky-500',
}
</script>

<template>
  <div class="diff-view">
    <div v-if="!loaded" class="p-8 text-center text-sm opacity-60">Loading diff…</div>
    <div v-else-if="!files.length" class="p-8 text-center text-sm opacity-60">
      No changes yet — the tree still matches the base.
    </div>
    <template v-else>
      <nav class="file-nav">
        <a v-for="f in files" :key="f.path" :href="`#f-${f.path}`" class="file-link">
          <span :class="STATUS_TINT[f.status]">●</span>
          <span class="truncate">{{ f.path }}</span>
          <span class="ml-auto shrink-0 tabular-nums">
            <span class="text-emerald-500">+{{ f.additions }}</span>
            <span class="text-red-500 ml-1">−{{ f.deletions }}</span>
          </span>
        </a>
      </nav>

      <section v-for="f in files" :id="`f-${f.path}`" :key="f.path" class="file">
        <header class="file-head" @click="toggle(f.path)">
          <UIcon :name="collapsed.has(f.path) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="size-4 shrink-0" />
          <span :class="['uppercase text-[10px] font-bold tracking-wider shrink-0', STATUS_TINT[f.status]]">{{ f.status }}</span>
          <span class="font-mono text-xs truncate">{{ f.oldPath ? `${f.oldPath} → ` : '' }}{{ f.path }}</span>
          <span class="ml-auto shrink-0 font-mono text-xs tabular-nums">
            <span class="text-emerald-500">+{{ f.additions }}</span>
            <span class="text-red-500 ml-1">−{{ f.deletions }}</span>
          </span>
        </header>
        <div v-if="!collapsed.has(f.path)" class="overflow-x-auto">
          <div v-if="f.binary" class="p-4 text-xs opacity-60">Binary file.</div>
          <table v-else class="diff-table">
            <tbody>
              <template v-for="(h, hi) in f.hunks" :key="hi">
                <tr class="hunk-row">
                  <td colspan="4">{{ h.header }}</td>
                </tr>
                <tr v-for="(row, ri) in h.rows" :key="ri">
                  <td :class="['num', row.left.type]">{{ row.left.num ?? '' }}</td>
                  <td :class="['code', row.left.type]"><span v-html="row.left.html" /></td>
                  <td :class="['num', row.right.type]">{{ row.right.num ?? '' }}</td>
                  <td :class="['code', row.right.type]"><span v-html="row.right.html" /></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.file-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 0 16px;
}
.file-link {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  opacity: 0.85;
}
.file-link:hover {
  background: rgba(128, 128, 160, 0.12);
  opacity: 1;
}
.file {
  border: 1px solid rgba(128, 128, 160, 0.25);
  border-radius: 10px;
  margin-bottom: 16px;
  overflow: hidden;
}
.file-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: rgba(128, 128, 160, 0.08);
  user-select: none;
}
.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  /* jDiff's palette — the two apps should read as one product. */
  background: #0d1117;
  color: #e6edf3;
}
.diff-table td {
  vertical-align: top;
  white-space: pre;
}
.diff-table .num {
  width: 1%;
  min-width: 42px;
  padding: 0 8px;
  text-align: right;
  color: rgba(230, 237, 243, 0.35);
  user-select: none;
  border-right: 1px solid rgba(240, 246, 252, 0.08);
}
.diff-table .code {
  width: 49%;
  padding: 0 10px;
}
.diff-table .num.add { background: rgba(63, 185, 80, 0.25); }
.diff-table .code.add { background: rgba(46, 160, 67, 0.15); }
.diff-table .num.del { background: rgba(248, 81, 73, 0.25); }
.diff-table .code.del { background: rgba(248, 81, 73, 0.12); }
.diff-table .num.empty,
.diff-table .code.empty { background: rgba(128, 128, 160, 0.06); }
.hunk-row td {
  padding: 4px 12px;
  color: rgba(230, 237, 243, 0.5);
  background: rgba(56, 139, 253, 0.1);
  font-size: 11px;
}
</style>
