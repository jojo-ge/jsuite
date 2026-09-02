import { renderMarkdown } from '../../app/utils/markdown'
import type { Tour, TourStop, TourVariant } from '../../app/utils/tour'
import type { Cell, FilePayload, Hunk } from './buildDiff'
import type { ParsedTarget, PreparedTarget } from './target'

// Renders a saved tour as ONE standalone HTML file: every stop as a code
// block on the left and the guide's note on the right, in reading order.
// Nothing is fetched at view time — the highlighted code, the notes and the
// styles are all inlined, so the file can be handed to a developer who has
// neither jDiff nor the repo.

export interface TourExportInput {
  repoPath: string
  target: ParsedTarget
  variant: TourVariant
  tour: Tour
  createdAt: string
  // Human label of the change being toured (PR title / branch subject).
  title: string
  // What this tour is *about*, when the variant names one thing: the chain's
  // title + summary, or the hunt issue's.
  topic?: { title: string; summary: string } | null
}

// One rendered source line inside a stop's code block. A diff row becomes a
// unified line (deletions before additions, numbered in the old/new gutters);
// a whole-file window is numbered once.
interface CodeLine {
  leftNum: number | null
  rightNum: number | null
  type: 'ctx' | 'add' | 'del' | 'skip'
  html: string
  hit: boolean
}

interface CodeBlock {
  header: string
  lines: CodeLine[]
  // Set when the stop's lines are nowhere in the diff and the block was read
  // from the file itself (chain and issue tours stop on unchanged code).
  fromFile: boolean
}

// Lines of context kept on each side of the stop when a block has to be
// trimmed, and the size at which trimming kicks in.
const WINDOW = 16
const MAX_LINES = 140

export async function buildTourExport(input: TourExportInput): Promise<string> {
  const files = await diffFilesFor(input.target, input.repoPath)
  // Reading whole files is only needed for stops the diff doesn't cover, and
  // preparing the target costs a fetch — so both are done lazily, once.
  let prepared: PreparedTarget | null = null
  const prepare = async () => (prepared ??= await prepareTarget(input.target, input.repoPath))

  const blocks: (CodeBlock | null)[] = []
  for (const stop of input.tour.stops) {
    blocks.push(await blockFor(stop, files, prepare, input.repoPath))
  }

  return page(input, blocks)
}

// ── Locating a stop's code ──────────────────────────────────────────────────

async function blockFor(
  stop: TourStop,
  files: FilePayload[],
  prepare: () => Promise<PreparedTarget>,
  repoPath: string,
): Promise<CodeBlock | null> {
  const file = files.find((f) => f.path === stop.path || f.oldPath === stop.path)
  const hunks = file ? file.hunks.filter((h) => hunkCovers(h, stop)) : []
  if (hunks.length) return trim(unified(hunks, stop), stop)

  try {
    const target = await prepare()
    const content = await showFile(target, repoPath, stop.path, stop.side === 'LEFT' ? 'left' : 'right')
    const raw = content.split('\n')
    if (raw.at(-1) === '') raw.pop()
    const from = Math.max(1, stop.line - WINDOW)
    const to = Math.min(raw.length, Math.max(stop.line, stop.endLine) + WINDOW)
    if (from > raw.length) return null
    const html = await highlightLines(raw.slice(from - 1, to), stop.path)
    return {
      header: `@@ ${from}-${to} @@`,
      fromFile: true,
      lines: html.map((h, i) => {
        const num = from + i
        return { leftNum: num, rightNum: num, type: 'ctx' as const, html: h, hit: inStop(num, stop) }
      }),
    }
  } catch {
    // File gone at this revision, or unreadable — the note still stands on
    // its own, so the stop renders without code rather than failing the export.
    return null
  }
}

function hunkCovers(hunk: Hunk, stop: TourStop): boolean {
  return hunk.rows.some((r) => {
    const cell = stop.side === 'LEFT' ? r.left : r.right
    return cell.num != null && cell.type !== 'empty' && inStop(cell.num, stop)
  })
}

function inStop(num: number, stop: TourStop): boolean {
  return num >= stop.line && num <= Math.max(stop.line, stop.endLine)
}

// Side-by-side rows collapsed to a unified listing — the export gives half
// its width to the note, and a walkthrough reads better as a single column of
// source with old/new gutters than as two half-width ones. Rows pair
// deletion i with addition i, so each run of changes is re-grouped into all
// its deletions followed by all its additions, the way git prints them.
function unified(hunks: Hunk[], stop: TourStop): CodeBlock {
  const lines: CodeLine[] = []
  const hit = (cell: Cell, side: 'LEFT' | 'RIGHT') =>
    side === stop.side && cell.num != null && inStop(cell.num, stop)

  for (const [i, hunk] of hunks.entries()) {
    if (i > 0) lines.push({ leftNum: null, rightNum: null, type: 'skip', html: '⋯', hit: false })
    let dels: CodeLine[] = []
    let adds: CodeLine[] = []
    const flush = () => {
      lines.push(...dels, ...adds)
      dels = []
      adds = []
    }
    for (const row of hunk.rows) {
      if (row.left.type === 'del' || row.right.type === 'add') {
        if (row.left.type === 'del') {
          dels.push({ leftNum: row.left.num, rightNum: null, type: 'del', html: row.left.html, hit: hit(row.left, 'LEFT') })
        }
        if (row.right.type === 'add') {
          adds.push({ leftNum: null, rightNum: row.right.num, type: 'add', html: row.right.html, hit: hit(row.right, 'RIGHT') })
        }
        continue
      }
      flush()
      if (row.right.type === 'ctx' || row.left.type === 'ctx') {
        lines.push({
          leftNum: row.left.num,
          rightNum: row.right.num,
          type: 'ctx',
          html: row.right.type === 'ctx' ? row.right.html : row.left.html,
          hit: hit(row.left, 'LEFT') || hit(row.right, 'RIGHT'),
        })
      }
    }
    flush()
  }
  return { header: hunks.map((h) => h.header.trim()).join(' · '), lines, fromFile: false }
}

// A stop can sit inside a very long hunk; keep a window around the lines the
// note is actually about rather than pasting hundreds of lines into the page.
function trim(block: CodeBlock, stop: TourStop): CodeBlock {
  if (block.lines.length <= MAX_LINES) return block
  const first = block.lines.findIndex((l) => l.hit)
  if (first < 0) return { ...block, lines: block.lines.slice(0, MAX_LINES) }
  let last = first
  block.lines.forEach((l, i) => { if (l.hit) last = i })
  const from = Math.max(0, first - WINDOW)
  const to = Math.min(block.lines.length, last + WINDOW + 1)
  const skip = (): CodeLine => ({ leftNum: null, rightNum: null, type: 'skip', html: '⋯', hit: false })
  return {
    ...block,
    lines: [
      ...(from > 0 ? [skip()] : []),
      ...block.lines.slice(from, to),
      ...(to < block.lines.length ? [skip()] : []),
    ],
  }
}

// ── The page ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function variantLabel(variant: TourVariant, topicTitle?: string): string {
  if (variant === 'overview') return 'overview tour'
  if (variant === 'detail') return 'detail tour'
  const kind = variant.startsWith('issue:') ? 'issue' : 'chain'
  return `${kind} · ${topicTitle || variant.slice(kind.length + 1)}`
}

export function exportFilename(target: ParsedTarget, variant: TourVariant): string {
  const slug = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  const who = target.kind === 'pr' ? `pr-${target.number}` : slug(target.branch ?? 'branch')
  return `tour-${who}-${slug(variant)}.html`
}

function targetLabel(t: ParsedTarget): string {
  return t.kind === 'pr' ? `PR #${t.number}` : `branch ${t.branch}`
}

function stopRange(stop: TourStop): string {
  const side = stop.side === 'LEFT' ? ' (before)' : ''
  return stop.endLine > stop.line ? `L${stop.line}–${stop.endLine}${side}` : `L${stop.line}${side}`
}

function codeHtml(block: CodeBlock | null): string {
  if (!block) return '<div class="no-code">code not available for this stop</div>'
  // Two number gutters, old then new, the way a unified diff reads: a
  // deletion numbers only on the left, an addition only on the right.
  const rows = block.lines.map((l) => {
    if (l.type === 'skip') {
      const cols = block.fromFile ? 1 : 2
      return '<div class="ln skip">⋯</div>' + '<div class="ln skip"></div>'.repeat(cols - 1) + '<div class="src skip"></div>'
    }
    const cls = `${l.type}${l.hit ? ' hit' : ''}`
    const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '
    const gutters = block.fromFile
      ? `<div class="ln edge ${cls}">${l.rightNum ?? ''}</div>`
      : `<div class="ln edge ${cls}">${l.leftNum ?? ''}</div><div class="ln ${cls}">${l.rightNum ?? ''}</div>`
    return `${gutters}<div class="src ${cls}"><span class="sign">${sign}</span>${l.html}</div>`
  }).join('')
  return `<div class="hunk-head">${esc(block.header)}${block.fromFile ? ' <span class="unchanged">unchanged code</span>' : ''}</div>`
    + `<div class="code${block.fromFile ? ' plain' : ''}">${rows}</div>`
}

function stopHtml(stop: TourStop, i: number, block: CodeBlock | null): string {
  return `
<section class="stop" id="stop-${i + 1}">
  <div class="pane-code">
    <div class="file-head">
      <span class="path">${esc(stop.path)}</span>
      <span class="range">${esc(stopRange(stop))}</span>
    </div>
    ${codeHtml(block)}
  </div>
  <div class="pane-note">
    <div class="stop-no">stop ${i + 1}</div>
    <h2>${esc(stop.title)}</h2>
    <div class="note">${renderMarkdown(stop.note)}</div>
    <a class="top-link" href="#top">↑ contents</a>
  </div>
</section>`
}

function page(input: TourExportInput, blocks: (CodeBlock | null)[]): string {
  const { tour, variant, topic } = input
  const label = variantLabel(variant, topic?.title)
  const heading = `${input.title} — ${label}`
  const toc = tour.stops.map((s, i) => `
    <li>
      <a href="#stop-${i + 1}"><span class="toc-no">${i + 1}</span><span class="toc-title">${esc(s.title)}</span></a>
      <span class="toc-path">${esc(s.path)}:${s.line}</span>
    </li>`).join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<style>${CSS}</style>
</head>
<body>
<header id="top">
  <div class="kicker">jDiff code walkthrough</div>
  <h1>${esc(input.title)}</h1>
  <div class="meta">
    <span class="pill">${esc(label)}</span>
    <span>${esc(targetLabel(input.target))}</span>
    <span>${tour.stops.length} stops</span>
    <span>generated ${esc(new Date(input.createdAt).toLocaleString())}</span>
  </div>
  ${topic ? `<div class="chain-sum">${esc(topic.summary)}</div>` : ''}
  ${tour.overview ? `<div class="overview">${renderMarkdown(tour.overview)}</div>` : ''}
  <ol class="toc">${toc}</ol>
</header>
<main>
${tour.stops.map((s, i) => stopHtml(s, i, blocks[i] ?? null)).join('\n')}
</main>
<footer>walkthrough of ${esc(targetLabel(input.target))} · exported from jDiff · code and notes are a snapshot, not a live view</footer>
</body>
</html>
`
}

const CSS = `
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --panel-2: #1c2129;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --green: #3fb950;
  --red: #f85149;
  --accent: #58a6ff;
  --add-bg: rgba(46, 160, 67, 0.15);
  --add-num-bg: rgba(46, 160, 67, 0.3);
  --del-bg: rgba(248, 81, 73, 0.12);
  --del-num-bg: rgba(248, 81, 73, 0.28);
  --mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
header, main, footer { max-width: 1500px; margin: 0 auto; padding: 0 24px; }
header { padding-top: 40px; padding-bottom: 8px; }
.kicker {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
h1 { font-size: 28px; line-height: 1.2; margin: 8px 0 12px; }
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}
.pill {
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 10px;
  padding: 1px 10px;
}
.chain-sum { margin-top: 16px; color: var(--muted); max-width: 70ch; }
.overview {
  margin-top: 16px;
  max-width: 70ch;
  border-left: 2px solid var(--border);
  padding-left: 16px;
}
.overview p:first-child { margin-top: 0; }
.toc {
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--border);
}
.toc li {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
.toc a { display: flex; gap: 12px; align-items: baseline; }
.toc-no {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  min-width: 20px;
}
.toc-path { font-family: var(--mono); font-size: 11px; color: var(--muted); }
main { padding-top: 8px; padding-bottom: 40px; }
.stop {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  gap: 24px;
  align-items: start;
  padding: 32px 0;
  border-bottom: 1px solid var(--border);
  scroll-margin-top: 16px;
}
.pane-code {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  overflow: hidden;
  min-width: 0;
}
.file-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 8px 12px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
}
.file-head .path { font-family: var(--mono); font-size: 12px; font-weight: 600; word-break: break-all; }
.file-head .range { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-left: auto; }
.hunk-head {
  padding: 4px 12px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  background: rgba(88, 166, 255, 0.06);
  border-bottom: 1px solid var(--border);
  word-break: break-all;
}
.unchanged { color: var(--accent); }
.code {
  display: grid;
  grid-template-columns: minmax(44px, auto) minmax(44px, auto) minmax(0, 1fr);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
  overflow-x: auto;
}
.code.plain { grid-template-columns: minmax(44px, auto) minmax(0, 1fr); }
.ln {
  padding: 0 8px;
  text-align: right;
  color: var(--muted);
  user-select: none;
}
.src { padding: 0 10px 0 0; white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere; }
.sign { display: inline-block; width: 1ch; color: var(--muted); }
.ln.add { background: var(--add-num-bg); }
.src.add { background: var(--add-bg); }
.src.add .sign { color: var(--green); }
.ln.del { background: var(--del-num-bg); }
.src.del { background: var(--del-bg); }
.src.del .sign { color: var(--red); }
.ln.skip, .src.skip { background: var(--panel-2); color: var(--muted); }
/* The stop's own lines: a wash layered over whatever tint the line already
   carries, plus an accent bar in the gutter. */
.ln.hit, .src.hit { background-image: linear-gradient(rgba(88, 166, 255, 0.14), rgba(88, 166, 255, 0.14)); }
.ln.edge.hit { box-shadow: inset 3px 0 0 var(--accent); }
.no-code { padding: 20px; color: var(--muted); font-family: var(--mono); font-size: 12px; }
.pane-note { position: sticky; top: 16px; }
.stop-no {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.pane-note h2 { font-size: 20px; line-height: 1.3; margin: 6px 0 10px; }
.note { max-width: 60ch; }
.note p:first-child { margin-top: 0; }
.note code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--panel-2);
  border-radius: 4px;
  padding: 1px 4px;
}
.note pre {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
}
.note pre code { background: none; padding: 0; }
.top-link { display: inline-block; margin-top: 16px; font-family: var(--mono); font-size: 11px; }
footer {
  padding-top: 20px;
  padding-bottom: 40px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}
@media (max-width: 900px) {
  .stop { grid-template-columns: 1fr; gap: 16px; }
  .pane-note { position: static; order: -1; }
}
@media print {
  .stop { break-inside: avoid; }
  .pane-note { position: static; }
}
`
