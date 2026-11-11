// The Diff tab's expandable context — the lines git hides between hunks,
// revealed in place. Pure, so the viewer (DiffFileView.vue) only renders.
//
// Gap i sits before hunk i; the last gap runs from the final hunk to the end
// of the file, and its size is unknown until the whole file has been fetched.
// Content comes from the head version of the file (the region between hunks
// is unchanged by definition, so both sides read the same text); each side's
// line numbers are mapped from the hunk headers.

export const EXPAND_STEP = 20

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export interface DiffGap {
  /** The last line shown before the gap, per side (0 = top of file). */
  leftEnd: number
  rightEnd: number
  /** Hidden lines; null for the trailing gap (file length unknown). */
  hidden: number | null
}

export interface GapExpansion { top: number; bottom: number }

export interface GapRow { leftNum: number; rightNum: number; html: string }

export interface GapView {
  /** Revealed downward from the hunk above. */
  topRows: GapRow[]
  /** Revealed upward from the hunk below (never for the trailing gap). */
  bottomRows: GapRow[]
  /** Lines still hidden; null = trailing gap, file length not fetched yet. */
  remaining: number | null
  first: boolean
  trailing: boolean
}

/** Every gap of a file, from its hunk headers. Added/deleted/binary files have none worth expanding. */
export function diffGaps(file: { status: string; binary: boolean; hunks: { header: string }[] }): DiffGap[] {
  if (file.binary || file.status === 'deleted') return []
  const out: DiffGap[] = []
  let leftEnd = 0
  let rightEnd = 0
  for (const h of file.hunks) {
    const m = HUNK_HEADER.exec(h.header)
    if (!m) return []
    const oldStart = Number(m[1])
    const oldCount = m[2] == null ? 1 : Number(m[2])
    const newStart = Number(m[3])
    const newCount = m[4] == null ? 1 : Number(m[4])
    out.push({ leftEnd, rightEnd, hidden: Math.max(0, newStart - rightEnd - 1) })
    leftEnd = oldCount === 0 ? oldStart : oldStart + oldCount - 1
    rightEnd = newCount === 0 ? newStart : newStart + newCount - 1
  }
  if (file.status !== 'added') out.push({ leftEnd, rightEnd, hidden: null })
  return out
}

/** How many lines a gap hides, once the file's length is known (null otherwise). */
export function gapTotal(g: DiffGap, fileLines: number | null): number | null {
  return g.hidden ?? (fileLines == null ? null : Math.max(0, fileLines - g.rightEnd))
}

/** What to render for each gap: null where nothing is hidden. */
export function gapViews(
  gaps: DiffGap[],
  expansion: Record<number, GapExpansion>,
  fullLines: string[] | null,
): (GapView | null)[] {
  const trailingIndex = gaps.length && gaps.at(-1)!.hidden == null ? gaps.length - 1 : -1
  return gaps.map((g, gi) => {
    const trailing = gi === trailingIndex
    const total = gapTotal(g, fullLines ? fullLines.length : null)
    if (total === 0) return null
    const st = expansion[gi] ?? { top: 0, bottom: 0 }
    const rows = (from: number, count: number): GapRow[] => {
      const out: GapRow[] = []
      for (let n = from; n < from + count; n++) {
        out.push({ leftNum: g.leftEnd + (n - g.rightEnd), rightNum: n, html: fullLines?.[n - 1] ?? '' })
      }
      return out
    }
    return {
      topRows: rows(g.rightEnd + 1, st.top),
      bottomRows: total == null || trailing ? [] : rows(g.rightEnd + total - st.bottom + 1, st.bottom),
      remaining: total == null ? null : Math.max(0, total - st.top - st.bottom),
      first: gi === 0,
      trailing,
    }
  })
}

/** One expand click: 20 more down from above, 20 more up from below, or everything. */
export function expandGap(total: number, current: GapExpansion | undefined, dir: 'down' | 'up' | 'all'): GapExpansion {
  const st = { ...(current ?? { top: 0, bottom: 0 }) }
  if (dir === 'all') st.top = total - st.bottom
  else if (dir === 'down') st.top = Math.min(st.top + EXPAND_STEP, total - st.bottom)
  else st.bottom = Math.min(st.bottom + EXPAND_STEP, total - st.top)
  return st
}

/**
 * Which gap hides a head-version (RIGHT) line, or null when it sits in a hunk
 * or past the end. The trailing gap's size is unknown until the file is
 * fetched, so before then anything past the last hunk lands in it. A guided
 * tour's stop on unchanged code expands that gap to show itself.
 */
export function gapForLine(gaps: DiffGap[], line: number, fileLines: number | null): number | null {
  for (let gi = 0; gi < gaps.length; gi++) {
    const g = gaps[gi]!
    const total = gapTotal(g, fileLines)
    if (total == null) {
      if (line > g.rightEnd) return gi
      continue
    }
    if (line > g.rightEnd && line <= g.rightEnd + total) return gi
  }
  return null
}
