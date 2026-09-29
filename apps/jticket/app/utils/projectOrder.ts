// The projects page's manual order. `position` is set by dragging (PUT
// /api/projects/order numbers the whole list); null means the project was never
// placed — new from jReview, jMap or the architecture scan — and those sort
// first, newest first, so fresh work lands where you'll see it.

export interface OrderedProject {
  key: string
  createdAt: string
  position: number | null
}

const keyNumber = (key: string) => Number(key.split('-').pop()) || 0

export function sortByOrder<T extends OrderedProject>(projects: T[]): T[] {
  return [...projects].sort((a, b) => {
    if (a.position === null || b.position === null) {
      if (a.position !== null) return 1
      if (b.position !== null) return -1
      return b.createdAt.localeCompare(a.createdAt)
    }
    return a.position - b.position || keyNumber(a.key) - keyNumber(b.key)
  })
}

// One step up (-1) or down (+1) — the keyboard alternative to dragging.
export function moveBy(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

// Drag feedback: `id` dropped before (or after) `target`.
export function moveTo(ids: string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids
  const next = ids.filter((x) => x !== id)
  const at = next.indexOf(target) + (after ? 1 : 0)
  next.splice(at, 0, id)
  return next
}

// "When did this project last move": its newest ticket edit, as a short age —
// 'today', '3d', '2w'. null when it has no tickets.
export function lastActivity(tickets: { updatedAt: string }[]): string | null {
  return tickets.reduce<string | null>((max, t) => (!max || t.updatedAt > max ? t.updatedAt : max), null)
}
export function shortAge(iso: string | null, now = new Date()): string {
  if (!iso) return '—'
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
  if (!Number.isFinite(days) || days <= 0) return 'today'
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}
