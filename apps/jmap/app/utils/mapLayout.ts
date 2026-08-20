import type { MapSynthesis } from './mapTypes'

// Deterministic layered layout for the synthesis graph — computed client-side
// on every render, never stored. Claude does not emit coordinates: a pure
// layout function re-runs freely when the user re-synthesizes, and can't go
// stale or drift. Groups become columns; a couple of barycenter sweeps order
// nodes within each column to reduce edge crossings; ties break on node id so
// the same graph always draws the same picture.

export const NODE_W = 200
export const NODE_H = 60
const COL_GAP = 150
const ROW_GAP = 40
const PADDING = 70
const GROUP_PAD = 26

export interface NodePos { x: number; y: number }
export interface GroupBox { id: string; label: string; x: number; y: number; width: number; height: number }
export interface MapLayout {
  positions: Record<string, NodePos>
  groupBoxes: GroupBox[]
  width: number
  height: number
}

export function layoutMap(synthesis: MapSynthesis): MapLayout {
  const nodeIds = synthesis.nodes.map((n) => n.id)
  const idSet = new Set(nodeIds)

  // Columns: one per group (in given order), plus a trailing column for any
  // node the synthesis left ungrouped.
  const grouped = new Set<string>()
  const columns: { id: string; label: string; ids: string[] }[] = []
  for (const g of synthesis.groups) {
    const ids = g.nodeIds.filter((id) => idSet.has(id) && !grouped.has(id))
    ids.forEach((id) => grouped.add(id))
    if (ids.length) columns.push({ id: g.id, label: g.label, ids })
  }
  const rest = nodeIds.filter((id) => !grouped.has(id))
  if (rest.length) columns.push({ id: '__rest', label: 'Other', ids: rest })
  if (!columns.length) return { positions: {}, groupBoxes: [], width: 2 * PADDING, height: 2 * PADDING }

  // Barycenter sweeps: order each column by the average row of its neighbors
  // (in every other column), stable on node id.
  const neighbors = new Map<string, string[]>()
  for (const e of synthesis.edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue
    neighbors.set(e.from, [...(neighbors.get(e.from) ?? []), e.to])
    neighbors.set(e.to, [...(neighbors.get(e.to) ?? []), e.from])
  }
  const row = new Map<string, number>()
  const recordRows = () => columns.forEach((c) => c.ids.forEach((id, i) => row.set(id, i)))
  recordRows()
  for (let sweep = 0; sweep < 3; sweep++) {
    for (const col of columns) {
      const inCol = new Set(col.ids)
      col.ids = [...col.ids].sort((a, b) => {
        const bary = (id: string) => {
          const ns = (neighbors.get(id) ?? []).filter((n) => !inCol.has(n))
          if (!ns.length) return row.get(id) ?? 0
          return ns.reduce((s, n) => s + (row.get(n) ?? 0), 0) / ns.length
        }
        return bary(a) - bary(b) || a.localeCompare(b)
      })
    }
    recordRows()
  }

  // Coordinates: columns left to right, each vertically centered on the
  // tallest column.
  const colHeight = (c: { ids: string[] }) => c.ids.length * NODE_H + (c.ids.length - 1) * ROW_GAP
  const maxHeight = Math.max(...columns.map(colHeight))
  const positions: Record<string, NodePos> = {}
  const groupBoxes: GroupBox[] = []
  columns.forEach((col, ci) => {
    const x = PADDING + ci * (NODE_W + COL_GAP)
    const top = PADDING + (maxHeight - colHeight(col)) / 2
    col.ids.forEach((id, ri) => {
      positions[id] = { x, y: top + ri * (NODE_H + ROW_GAP) }
    })
    if (col.id !== '__rest' || columns.length > 1) {
      groupBoxes.push({
        id: col.id,
        label: col.label,
        x: x - GROUP_PAD,
        y: top - GROUP_PAD - 14,
        width: NODE_W + 2 * GROUP_PAD,
        height: colHeight(col) + 2 * GROUP_PAD + 14,
      })
    }
  })

  return {
    positions,
    groupBoxes,
    width: 2 * PADDING + columns.length * NODE_W + (columns.length - 1) * COL_GAP,
    height: 2 * PADDING + maxHeight,
  }
}
