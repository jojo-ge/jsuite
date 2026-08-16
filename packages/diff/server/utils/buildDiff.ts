import parseDiff from 'parse-diff'

// Parsing + side-by-side alignment + syntax highlighting for a raw `git diff`.
// Shared by the PR diff endpoint and the local-branch diff endpoint so the two
// paths render byte-identical output — only the git range that produced the
// raw diff differs.

export interface Cell {
  num: number | null
  type: 'ctx' | 'add' | 'del' | 'empty'
  html: string
}
export interface Row {
  left: Cell
  right: Cell
}
export interface Hunk {
  header: string
  rows: Row[]
}
export interface FilePayload {
  path: string
  oldPath: string | null
  status: 'added' | 'deleted' | 'renamed' | 'modified'
  additions: number
  deletions: number
  binary: boolean
  hunks: Hunk[]
}

const EMPTY: Cell = { num: null, type: 'empty', html: '' }

export async function buildDiff(raw: string): Promise<FilePayload[]> {
  const files: FilePayload[] = []
  for (const file of parseDiff(raw)) {
    const oldPath = file.from && file.from !== '/dev/null' ? file.from : null
    const newPath = file.to && file.to !== '/dev/null' ? file.to : oldPath
    if (!newPath) continue

    const status = file.new ? 'added' : file.deleted ? 'deleted'
      : oldPath && oldPath !== newPath ? 'renamed' : 'modified'

    // Build aligned rows per hunk, pairing runs of deletions with additions.
    const hunks: Hunk[] = []
    const leftTexts: string[] = []
    const rightTexts: string[] = []
    const leftCells: Cell[] = []
    const rightCells: Cell[] = []

    for (const chunk of file.chunks) {
      const rows: Row[] = []
      let dels: { num: number; text: string }[] = []
      let adds: { num: number; text: string }[] = []

      const flush = () => {
        const n = Math.max(dels.length, adds.length)
        for (let i = 0; i < n; i++) {
          const d = dels[i]
          const a = adds[i]
          const left: Cell = d ? { num: d.num, type: 'del', html: '' } : { ...EMPTY }
          const right: Cell = a ? { num: a.num, type: 'add', html: '' } : { ...EMPTY }
          if (d) { leftTexts.push(d.text); leftCells.push(left) }
          if (a) { rightTexts.push(a.text); rightCells.push(right) }
          rows.push({ left, right })
        }
        dels = []
        adds = []
      }

      for (const ch of chunk.changes) {
        const text = ch.content.slice(1)
        if (ch.type === 'normal') {
          flush()
          const left: Cell = { num: ch.ln1!, type: 'ctx', html: '' }
          const right: Cell = { num: ch.ln2!, type: 'ctx', html: '' }
          leftTexts.push(text); leftCells.push(left)
          rightTexts.push(text); rightCells.push(right)
          rows.push({ left, right })
        } else if (ch.type === 'del') {
          dels.push({ num: ch.ln!, text })
        } else if (ch.type === 'add') {
          adds.push({ num: ch.ln!, text })
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
      binary: file.chunks.length === 0,
      hunks,
    })
  }
  return files
}
