// Codebase-level verification rules: the shape Codebase settings saves and
// the store coerces. Kept apart from verification.ts (pure matching) so the
// store's import graph stays free of the transcript types.
import { VERIFICATION_CATEGORIES, type VerificationRule } from './verification'

const MAX_RULES = 50
const MAX_PATTERN = 400

/** Keep only well-formed rules: a known category, a non-empty pattern that compiles, a short id. */
export function cleanVerificationRules(raw: unknown): VerificationRule[] {
  if (!Array.isArray(raw)) return []
  const out: VerificationRule[] = []
  for (const r of raw.slice(0, MAX_RULES)) {
    if (!r || typeof r !== 'object') continue
    const category = (r as any).category
    const pattern = typeof (r as any).pattern === 'string' ? (r as any).pattern.trim().slice(0, MAX_PATTERN) : ''
    if (!VERIFICATION_CATEGORIES.includes(category) || !pattern) continue
    try {
      new RegExp(pattern, 'i')
    } catch {
      continue
    }
    const id = typeof (r as any).id === 'string' && (r as any).id.trim() ? (r as any).id.trim().slice(0, 60) : `codebase-${out.length + 1}`
    out.push({ id, category, pattern })
  }
  return out
}
