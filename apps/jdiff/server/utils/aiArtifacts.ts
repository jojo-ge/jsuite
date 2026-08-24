import { RISK_LEVELS, type FileRisk } from '../../app/utils/risk'
import { FINDING_SEVERITIES, type Finding } from '../../app/utils/findings'
import type { Tour, TourStop } from '../../app/utils/tour'
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
export const QUESTION_COUNT = 3

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

export function cleanTour(parsed: any): Tour {
  const stops: TourStop[] = (Array.isArray(parsed?.stops) ? parsed.stops : [])
    .filter((s: any) => typeof s?.path === 'string' && Number.isInteger(s?.line) && s.line >= 1)
    .map((s: any) => ({
      path: s.path,
      side: s.side === 'LEFT' ? 'LEFT' as const : 'RIGHT' as const,
      line: s.line,
      endLine: Number.isInteger(s.endLine) && s.endLine >= s.line ? s.endLine : s.line,
      title: String(s.title ?? '').slice(0, 120),
      note: String(s.note ?? ''),
    }))
    .slice(0, MAX_TOUR_STOPS)
  if (!stops.length || typeof parsed?.overview !== 'string') {
    throw createError({ statusCode: 400, message: 'unexpected tour shape' })
  }
  return { overview: parsed.overview, stops }
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
