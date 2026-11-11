// The Diff tab's rows, built server-side from a raw `git diff`: parse it, pair
// each run of deletions with the additions that replace it into side-by-side
// rows, and syntax-highlight both sides. Ported from jDiff's buildDiff — the
// viewer (ProjectDiff.vue / DiffFileView.vue) only renders what comes back.
//
// Highlighting runs per side over the whole file's visible lines in order, so
// tokens that span lines (template strings, block comments) colour correctly
// within a hunk.
import parseDiff from 'parse-diff'
import type { DiffCell, DiffFile, DiffHunk, DiffRow } from '../../app/utils/diffRows'
import { highlightLines } from './diffHighlight'

export type { DiffFile }

const EMPTY: DiffCell = { num: null, type: 'empty', html: '' }

// git's marker for a binary change; parse-diff drops it, so read it off the raw diff.
const BINARY_LINE = /^Binary files (?:a\/(.+?)|\/dev\/null) and (?:b\/(.+?)|\/dev\/null) differ$/gm

function binaryPaths(raw: string): Set<string> {
  const out = new Set<string>()
  for (const m of raw.matchAll(BINARY_LINE)) {
    if (m[1]) out.add(m[1])
    if (m[2]) out.add(m[2])
  }
  return out
}

export async function buildDiff(raw: string): Promise<DiffFile[]> {
  const files: DiffFile[] = []
  const binaries = binaryPaths(raw)
  for (const file of parseDiff(raw)) {
    const oldPath = file.from && file.from !== '/dev/null' ? file.from : null
    const newPath = file.to && file.to !== '/dev/null' ? file.to : oldPath
    if (!newPath) continue

    const status: DiffFile['status'] = file.new ? 'added' : file.deleted ? 'deleted'
      : oldPath && oldPath !== newPath ? 'renamed' : 'modified'

    const hunks: DiffHunk[] = []
    const leftTexts: string[] = []
    const rightTexts: string[] = []
    const leftCells: DiffCell[] = []
    const rightCells: DiffCell[] = []

    for (const chunk of file.chunks) {
      const rows: DiffRow[] = []
      let dels: { num: number; text: string }[] = []
      let adds: { num: number; text: string }[] = []

      // A run of deletions followed by additions is a replacement: pair them
      // row by row, padding the shorter side with empty cells.
      const flush = () => {
        const n = Math.max(dels.length, adds.length)
        for (let i = 0; i < n; i++) {
          const d = dels[i]
          const a = adds[i]
          const left: DiffCell = d ? { num: d.num, type: 'del', html: '' } : { ...EMPTY }
          const right: DiffCell = a ? { num: a.num, type: 'add', html: '' } : { ...EMPTY }
          if (d) { leftTexts.push(d.text); leftCells.push(left) }
          if (a) { rightTexts.push(a.text); rightCells.push(right) }
          rows.push({ left, right })
        }
        dels = []
        adds = []
      }

      for (const ch of chunk.changes) {
        // parse-diff keeps the +/-/space marker, and reports git's "\ No newline
        // at end of file" as a change of the previous line's type — not a line.
        if (ch.content.startsWith('\\')) continue
        const text = ch.content.slice(1)
        if (ch.type === 'normal') {
          flush()
          const left: DiffCell = { num: ch.ln1, type: 'ctx', html: '' }
          const right: DiffCell = { num: ch.ln2, type: 'ctx', html: '' }
          leftTexts.push(text); leftCells.push(left)
          rightTexts.push(text); rightCells.push(right)
          rows.push({ left, right })
        } else if (ch.type === 'del') {
          dels.push({ num: ch.ln, text })
        } else if (ch.type === 'add') {
          adds.push({ num: ch.ln, text })
        }
      }
      flush()
      hunks.push({ header: chunk.content, rows })
    }

    const [leftHtml, rightHtml] = await Promise.all([
      highlightLines(leftTexts, oldPath ?? newPath),
      highlightLines(rightTexts, newPath),
    ])
    leftCells.forEach((c, i) => { c.html = leftHtml[i] ?? '' })
    rightCells.forEach((c, i) => { c.html = rightHtml[i] ?? '' })

    files.push({
      path: newPath,
      oldPath: status === 'renamed' ? oldPath : null,
      status,
      additions: file.additions,
      deletions: file.deletions,
      // No hunks is not enough: a pure rename or a mode change has none either.
      binary: binaries.has(newPath) || (!!oldPath && binaries.has(oldPath)),
      hunks,
    })
  }
  return files
}
