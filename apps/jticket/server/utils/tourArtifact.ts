// Validation for the tour a `jdiff-tour` session POSTs back. Ported from
// jDiff's aiArtifacts.ts (cleanTour), detail tours only. The skill
// (.claude/skills/jdiff-tour/SKILL.md) and this file must agree on the shape.
import type { Tour, TourStop } from '../../app/utils/tour'

/** A detail tour walks the change at review depth: 20–40 stops; more are dropped. */
export const MAX_DETAIL_STOPS = 40

const MAX_TITLE = 120

/** A posted tour → the stored shape. Throws 400 when nothing walkable is left. */
export function cleanTour(parsed: any): Tour {
  const stops: TourStop[] = (Array.isArray(parsed?.stops) ? parsed.stops : [])
    .filter((s: any) => typeof s?.path === 'string' && s.path && Number.isInteger(s?.line) && s.line >= 1)
    .map((s: any) => ({
      path: s.path,
      side: s.side === 'LEFT' ? 'LEFT' as const : 'RIGHT' as const,
      line: s.line,
      endLine: Number.isInteger(s.endLine) && s.endLine >= s.line ? s.endLine : s.line,
      title: String(s.title ?? '').slice(0, MAX_TITLE),
      note: String(s.note ?? ''),
    }))
    .slice(0, MAX_DETAIL_STOPS)
  if (!stops.length || typeof parsed?.overview !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'unexpected tour shape — need { overview: string, stops: [{ path, side, line, endLine, title, note }] }' })
  }
  return { overview: parsed.overview, stops }
}
