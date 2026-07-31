<script setup lang="ts">
import { CATEGORY_LABELS, CATEGORY_ORDER, categorize } from '~/utils/fileCategories'
import type { FileRisk } from '~/utils/risk'

interface DiffFileMeta {
  path: string
  additions: number
  deletions: number
}

const props = defineProps<{
  files: DiffFileMeta[]
  closedFiles: string[]
  anchorFor: (path: string) => string
  risks?: Record<string, FileRisk>
  // When true a "todo" mode is offered first (content comes from the #todo
  // slot) and becomes the default view for reviewers with guidance artifacts.
  hasChecklist?: boolean
}>()

const hasRisks = computed(() => Object.keys(props.risks ?? {}).length > 0)

function fileTitle(path: string): string {
  const base = props.closedFiles.includes(path) ? 'click to restore' : path
  const r = props.risks?.[path]
  return r ? `${base}\n${r.level} risk — ${r.note}` : base
}

const emit = defineEmits<{
  (e: 'open', ev: MouseEvent, path: string): void
}>()

type Mode = 'todo' | 'list' | 'folders' | 'type' | 'churn'
const FILE_MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'list', label: 'list', title: 'flat list in diff order' },
  { id: 'folders', label: 'dirs', title: 'group by folder' },
  { id: 'type', label: 'type', title: 'group by kind: source, tests, docs, data, assets…' },
  { id: 'churn', label: 'churn', title: 'flat list, biggest change first' },
]
const TODO_MODE = { id: 'todo' as Mode, label: 'todo', title: 'review checklist: tour stops, risks, questions' }

const MODES = computed(() => (props.hasChecklist ? [TODO_MODE, ...FILE_MODES] : FILE_MODES))

const mode = ref<Mode>('folders')
onMounted(() => {
  const saved = localStorage.getItem('jdiff:filenav-mode') as Mode | null
  if (saved && (saved === 'todo' ? props.hasChecklist : FILE_MODES.some((m) => m.id === saved))) {
    mode.value = saved
  } else if (props.hasChecklist) {
    mode.value = 'todo'
  }
})
// Checklist artifacts can arrive after mount (restored from the local
// store); adopt todo as the default once they do, unless the user has
// explicitly picked a file view before.
watch(
  () => props.hasChecklist,
  (has) => {
    const saved = localStorage.getItem('jdiff:filenav-mode')
    if (has && !saved) mode.value = 'todo'
    if (!has && mode.value === 'todo') mode.value = 'folders'
  },
)
watch(mode, (m) => {
  localStorage.setItem('jdiff:filenav-mode', m)
  collapsed.value = new Set()
})

const collapsed = ref(new Set<string>())
function toggleGroup(key: string) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

interface Row {
  kind: 'group' | 'file'
  key: string
  depth: number
  additions: number
  deletions: number
  // group rows
  label?: string
  count?: number
  isCollapsed?: boolean
  // file rows
  path?: string
  display?: string
}

function fileRow(f: DiffFileMeta, depth: number, display?: string): Row {
  return {
    kind: 'file',
    key: 'f:' + f.path,
    depth,
    additions: f.additions,
    deletions: f.deletions,
    path: f.path,
    display: display ?? f.path,
  }
}

interface DirNode {
  name: string
  path: string
  dirs: Map<string, DirNode>
  files: DiffFileMeta[]
}

function buildTree(files: DiffFileMeta[]): DirNode {
  const root: DirNode = { name: '', path: '', dirs: new Map(), files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let child = node.dirs.get(part)
      if (!child) {
        child = {
          name: part,
          path: node.path ? node.path + '/' + part : part,
          dirs: new Map(),
          files: [],
        }
        node.dirs.set(part, child)
      }
      node = child
    }
    node.files.push(f)
  }
  return root
}

function dirStats(node: DirNode): { count: number; additions: number; deletions: number } {
  let count = node.files.length
  let additions = node.files.reduce((s, f) => s + f.additions, 0)
  let deletions = node.files.reduce((s, f) => s + f.deletions, 0)
  for (const child of node.dirs.values()) {
    const s = dirStats(child)
    count += s.count
    additions += s.additions
    deletions += s.deletions
  }
  return { count, additions, deletions }
}

function walkTree(node: DirNode, depth: number, rows: Row[]) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (let dir of dirs) {
    // Collapse single-child directory chains into one row (a/b/c).
    let label = dir.name
    while (dir.dirs.size === 1 && dir.files.length === 0) {
      const only = dir.dirs.values().next().value as DirNode
      label += '/' + only.name
      dir = only
    }
    const stats = dirStats(dir)
    const isCollapsed = collapsed.value.has(dir.path)
    rows.push({ kind: 'group', key: dir.path, depth, label, isCollapsed, ...stats })
    if (!isCollapsed) walkTree(dir, depth + 1, rows)
  }
  const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path))
  for (const f of files) rows.push(fileRow(f, depth, f.path.split('/').pop()))
}

const rows = computed<Row[]>(() => {
  const files = props.files
  if (mode.value === 'list') return files.map((f) => fileRow(f, 0))

  if (mode.value === 'churn') {
    return [...files]
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
      .map((f) => fileRow(f, 0))
  }

  if (mode.value === 'folders') {
    const out: Row[] = []
    walkTree(buildTree(files), 0, out)
    return out
  }

  // type
  const out: Row[] = []
  for (const cat of CATEGORY_ORDER) {
    const group = files.filter((f) => categorize(f.path) === cat)
    if (!group.length) continue
    const isCollapsed = collapsed.value.has(cat)
    out.push({
      kind: 'group',
      key: cat,
      depth: 0,
      label: CATEGORY_LABELS[cat],
      count: group.length,
      additions: group.reduce((s, f) => s + f.additions, 0),
      deletions: group.reduce((s, f) => s + f.deletions, 0),
      isCollapsed,
    })
    if (isCollapsed) continue
    for (const f of [...group].sort((a, b) => a.path.localeCompare(b.path))) {
      out.push(fileRow(f, 1))
    }
  }
  return out
})
</script>

<template>
  <nav class="filenav">
    <div class="modes">
      <button
        v-for="m in MODES"
        :key="m.id"
        :class="{ on: mode === m.id }"
        :title="m.title"
        @click="mode = m.id"
      >
        {{ m.label }}
      </button>
    </div>
    <div v-if="hasRisks && mode !== 'todo'" class="risk-legend" title="claude's risk heatmap: how much review attention each file needs">
      <span><span class="rdot low" /> skim</span>
      <span><span class="rdot medium" /> read</span>
      <span><span class="rdot high" /> scrutinize</span>
    </div>

    <slot v-if="mode === 'todo'" name="todo" />
    <template v-else v-for="row in rows" :key="row.key">
      <button
        v-if="row.kind === 'group'"
        class="group"
        :style="{ paddingLeft: 8 + row.depth * 12 + 'px' }"
        @click="toggleGroup(row.key)"
      >
        <span class="chev">{{ row.isCollapsed ? '▸' : '▾' }}</span>
        <span class="glabel">{{ row.label }}</span>
        <span class="gcount">{{ row.count }}</span>
        <span class="fstats">
          <span class="add">+{{ row.additions }}</span>
          <span class="del">−{{ row.deletions }}</span>
        </span>
      </button>
      <a
        v-else
        :href="'#' + anchorFor(row.path!)"
        class="file-link"
        :style="{ paddingLeft: 8 + row.depth * 12 + 'px' }"
        :class="{ closed: closedFiles.includes(row.path!) }"
        :title="fileTitle(row.path!)"
        @click="emit('open', $event, row.path!)"
      >
        <span v-if="risks?.[row.path!]" class="rdot" :class="risks[row.path!]!.level" />
        <span class="fname">{{ row.display }}</span>
        <span class="fstats">
          <span class="add">+{{ row.additions }}</span>
          <span class="del">−{{ row.deletions }}</span>
        </span>
      </a>
    </template>
  </nav>
</template>

<style scoped>
.modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
}
.modes button {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  padding: 3px 0;
  border-radius: 4px;
  cursor: pointer;
}
.modes button.on {
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--border);
}
.group {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 5px;
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.group:hover {
  background: var(--panel-2);
}
.chev {
  font-size: 9px;
  width: 10px;
  flex: none;
}
.glabel {
  color: var(--text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gcount {
  flex: 1;
  font-size: 10px;
}
.file-link {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 5px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 11px;
}
.file-link:hover {
  background: var(--panel-2);
  text-decoration: none;
}
.file-link.closed {
  opacity: 0.4;
}
.file-link.closed .fname {
  text-decoration: line-through;
}
.risk-legend {
  display: flex;
  gap: 10px;
  padding: 0 8px 6px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
}
.risk-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rdot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  align-self: center;
}
.rdot.low { background: var(--green); }
.rdot.medium { background: #d29922; }
.rdot.high { background: var(--red); }
.fname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.fstats {
  white-space: nowrap;
}
.add {
  color: var(--green);
}
.del {
  color: var(--red);
  margin-left: 6px;
}
</style>
