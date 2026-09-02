import { RISK_LEVELS, type FileRisk } from '../../app/utils/risk'
import { FINDING_SEVERITIES, type Finding } from '../../app/utils/findings'
import { HUNT_KINDS, type ChainsManifest, type HuntManifest, type Tour, type TourStop, type TourVariant } from '../../app/utils/tour'
import type { SelfQuestion } from '../../app/utils/askYourself'

// Result validators for the review-guidance artifacts. The artifacts are
// produced by a claude session dispatched into herdr (the globally-installed
// `jdiff-review` skill carries the prompts and JSON shapes) and POSTed back
// to /api/review-artifact, which cleans every payload through these before
// saving — the skill and this file must agree on the shapes.

export interface ReviewRating {
  score: number
  effort: 'quick' | 'moderate' | 'involved' | 'heavy'
  summary: string
  factors: { label: string; impact: 'good' | 'neutral' | 'bad'; detail: string }[]
  readingOrder: { path: string; note: string }[]
}

export const MAX_TOUR_STOPS = 20
export const MAX_DETAIL_STOPS = 40
export const MAX_CHAINS = 8
export const MAX_ISSUES = 12
export const QUESTION_COUNT = 3

// Chain and issue ids travel from a scoping manifest into herdr prompts and
// tour variants; the slug grammar is the sanitization boundary (like
// JTICKET_KEY).
export const CHAIN_SLUG = /^[a-z][a-z0-9-]{0,39}$/

/** Stop cap for a tour variant: overview 20, detail 40, 20 per chain/issue. */
export function maxStopsFor(variant: TourVariant): number {
  return variant === 'detail' ? MAX_DETAIL_STOPS : MAX_TOUR_STOPS
}

// The tour POST's optional `variant` sibling field. Chain and issue variants
// must name something from the target's saved manifest — an agent posting for
// a chain the scoping run never defined, or an issue the hunt never found, is
// a bug, not a new chain. `known` holds the full variant strings the manifests
// currently define ("chain:<slug>" / "issue:<slug>").
export function parseTourVariant(raw: unknown, known: Set<string>): TourVariant {
  if (raw === undefined || raw === null || raw === 'overview') return 'overview'
  if (raw === 'detail') return 'detail'
  for (const prefix of ['chain:', 'issue:'] as const) {
    if (typeof raw !== 'string' || !raw.startsWith(prefix)) continue
    const slug = raw.slice(prefix.length)
    if (CHAIN_SLUG.test(slug) && known.has(raw)) return raw as TourVariant
    // Hunt walkers only exist for HIGH issues, so `known` holds only those —
    // say which rule was missed rather than claiming the issue isn't there.
    throw createError({
      statusCode: 400,
      message: prefix === 'chain:'
        ? `unknown chain "${slug}" — not in the saved chains manifest`
        : `no walkthrough for issue "${slug}" — not a high-severity issue in the saved hunt manifest`,
    })
  }
  throw createError({ statusCode: 400, message: 'unexpected tour variant' })
}

// numstat prints renames as "dir/{old => new}/file" or "old => new";
// collapse to the new path so entries match the diff view's paths.
export function newPathOf(numstatPath: string): string {
  if (numstatPath.includes('{')) {
    return numstatPath.replace(/\{[^{}]* => ([^{}]*)\}/g, '$1').replace(/\/\/+/g, '/')
  }
  const parts = numstatPath.split(' => ')
  return parts.length === 2 ? parts[1]! : numstatPath
}

export function cleanRating(rating: any): ReviewRating {
  if (typeof rating?.score !== 'number' || !Array.isArray(rating.factors)) {
    throw createError({ statusCode: 400, message: 'unexpected rating shape' })
  }
  return {
    score: Math.max(1, Math.min(10, Math.round(rating.score))),
    effort: rating.effort,
    summary: String(rating.summary ?? ''),
    factors: rating.factors.slice(0, 6),
    readingOrder: (Array.isArray(rating.readingOrder) ? rating.readingOrder : [])
      .filter((e: any) => typeof e?.path === 'string')
      .map((e: any) => ({ path: e.path, note: String(e.note ?? '') }))
      .slice(0, 20),
  }
}

export function cleanRisks(parsed: any, knownPaths: Set<string>): FileRisk[] {
  if (!Array.isArray(parsed?.files)) {
    throw createError({ statusCode: 400, message: 'unexpected risk shape' })
  }
  return parsed.files
    .filter((f: any) => knownPaths.has(f?.path) && RISK_LEVELS.includes(f?.level))
    .map((f: any) => ({ path: f.path, level: f.level, note: String(f.note ?? '') }))
}

export function cleanTour(parsed: any, variant: TourVariant = 'overview'): Tour {
  // Chain and issue tours walk unchanged code rendered head-version only, so
  // LEFT-side stops have nothing to land on there — coerce to RIGHT.
  const forceRight = variant.startsWith('chain:') || variant.startsWith('issue:')
  const stops: TourStop[] = (Array.isArray(parsed?.stops) ? parsed.stops : [])
    .filter((s: any) => typeof s?.path === 'string' && Number.isInteger(s?.line) && s.line >= 1)
    .map((s: any) => ({
      path: s.path,
      side: !forceRight && s.side === 'LEFT' ? 'LEFT' as const : 'RIGHT' as const,
      line: s.line,
      endLine: Number.isInteger(s.endLine) && s.endLine >= s.line ? s.endLine : s.line,
      title: String(s.title ?? '').slice(0, 120),
      note: String(s.note ?? ''),
    }))
    .slice(0, maxStopsFor(variant))
  if (!stops.length || typeof parsed?.overview !== 'string') {
    throw createError({ statusCode: 400, message: 'unexpected tour shape' })
  }
  return { overview: parsed.overview, stops }
}

export function cleanChains(parsed: any): ChainsManifest {
  if (!Array.isArray(parsed?.chains)) {
    throw createError({ statusCode: 400, message: 'unexpected chains shape' })
  }
  const chains = parsed.chains
    .filter((c: any) => typeof c?.id === 'string' && typeof c?.title === 'string' && c.title.trim())
    .map((c: any) => ({
      id: c.id,
      title: String(c.title).trim().slice(0, 80),
      summary: String(c.summary ?? '').trim(),
      seedPaths: (Array.isArray(c.seedPaths) ? c.seedPaths : [])
        .filter((p: any) => typeof p === 'string' && p.trim())
        .slice(0, 10),
    }))
    .slice(0, MAX_CHAINS)
  if (!chains.length) {
    throw createError({ statusCode: 400, message: 'unexpected chains shape' })
  }
  for (const c of chains) {
    if (!CHAIN_SLUG.test(c.id)) {
      throw createError({ statusCode: 400, message: `bad chain id "${c.id}" — must match ${CHAIN_SLUG}` })
    }
  }
  if (new Set(chains.map((c: any) => c.id)).size !== chains.length) {
    throw createError({ statusCode: 400, message: 'duplicate chain ids' })
  }
  return { overview: String(parsed.overview ?? ''), chains }
}

// The hunt manifest: every suspected bug/vulnerability the hunt session found,
// in severity order. Same slug discipline as chains — the high-severity ids
// become herdr prompts and tour variants.
export function cleanHunt(parsed: any): HuntManifest {
  if (!Array.isArray(parsed?.issues)) {
    throw createError({ statusCode: 400, message: 'unexpected hunt shape' })
  }
  const issues = parsed.issues
    .filter((i: any) =>
      typeof i?.id === 'string'
      && FINDING_SEVERITIES.includes(i?.severity)
      && typeof i?.title === 'string' && i.title.trim()
      && typeof i?.path === 'string' && i.path.trim())
    .map((i: any) => ({
      id: i.id,
      severity: i.severity,
      kind: HUNT_KINDS.includes(i.kind) ? i.kind : 'bug',
      title: String(i.title).trim().slice(0, 120),
      summary: String(i.summary ?? '').trim(),
      path: i.path,
      line: Number.isInteger(i.line) && i.line >= 1 ? i.line : null,
      seedPaths: (Array.isArray(i.seedPaths) ? i.seedPaths : [])
        .filter((p: any) => typeof p === 'string' && p.trim())
        .slice(0, 10),
    }))
    // Severity order, so the walkers (and the panel) lead with the worst.
    .sort((a: any, b: any) => FINDING_SEVERITIES.indexOf(a.severity) - FINDING_SEVERITIES.indexOf(b.severity))
    .slice(0, MAX_ISSUES)
  for (const i of issues) {
    if (!CHAIN_SLUG.test(i.id)) {
      throw createError({ statusCode: 400, message: `bad issue id "${i.id}" — must match ${CHAIN_SLUG}` })
    }
  }
  if (new Set(issues.map((i: any) => i.id)).size !== issues.length) {
    throw createError({ statusCode: 400, message: 'duplicate issue ids' })
  }
  // A clean hunt is a real result: zero issues saves as an empty manifest.
  return { overview: String(parsed.overview ?? ''), issues }
}

export const MAX_FINDINGS = 50

// Unlike the other cleaners, an empty list is a valid artifact here — a clean
// review has zero findings and must still be POSTable (and saved) as such.
export function cleanFindings(parsed: any, knownPaths: Set<string>): Finding[] {
  if (!Array.isArray(parsed?.findings)) {
    throw createError({ statusCode: 400, message: 'unexpected findings shape' })
  }
  return parsed.findings
    .filter((f: any) =>
      FINDING_SEVERITIES.includes(f?.severity)
      && knownPaths.has(f?.path)
      && typeof f?.title === 'string' && f.title.trim())
    .map((f: any) => ({
      severity: f.severity,
      path: f.path,
      line: Number.isInteger(f.line) && f.line >= 1 ? f.line : null,
      title: String(f.title).trim().slice(0, 120),
      detail: String(f.detail ?? '').trim(),
    }))
    .slice(0, MAX_FINDINGS)
}

export function cleanQuestions(parsed: any): SelfQuestion[] {
  const questions: SelfQuestion[] = (Array.isArray(parsed?.questions) ? parsed.questions : [])
    .filter((q: any) => typeof q?.question === 'string' && q.question.trim())
    .map((q: any) => ({
      topic: String(q.topic ?? '').trim().slice(0, 60),
      question: String(q.question).trim(),
      why: String(q.why ?? '').trim(),
      answer: '',
      postedUrl: null,
    }))
    .slice(0, QUESTION_COUNT)
  if (!questions.length) {
    throw createError({ statusCode: 400, message: 'unexpected questions shape' })
  }
  return questions
}
