import { RISK_LEVELS, type FileRisk } from '../../app/utils/risk'
import type { Tour, TourStop } from '../../app/utils/tour'
import type { SelfQuestion } from '../../app/utils/askYourself'

// Response formats and result validators for the claude review-guidance
// tools. The single-tool endpoints and the combined analyze endpoint build
// their prompts from the same format blocks and clean the results with the
// same functions, so the two paths cannot drift apart.

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

export const RATING_FORMAT = `{
  "score": <integer 1-10, 10 = trivially easy to review>,
  "effort": <"quick" | "moderate" | "involved" | "heavy">,
  "summary": <one or two sentences a reviewer would want to know before opening the PR>,
  "factors": [
    { "label": <short factor name>, "impact": <"good" | "neutral" | "bad">, "detail": <one short sentence> }
  ],
  "readingOrder": [
    { "path": <file path exactly as it appears in the breakdown above>, "note": <what this file does in the change and what to check, one short sentence> }
  ]
}
Include 3 to 6 factors, most significant first.
For readingOrder, list the files in the order a reviewer should read them to understand the change fastest — start with the file that anchors the change (schema, core logic, interface), then what depends on it, tests near the source they cover. Omit generated files, lockfiles, and files too trivial to need a note; at most 20 entries.`

// Anchored score bands shared by the rating prompt and the consistency
// review pass, so both passes score against the same yardstick instead of
// free-floating judgement (which drifted several points between runs of the
// same diff).
export const RATING_RUBRIC = `Anchor the score to these bands (count only real source-code changes; tests, docs, and generated files cost far less review effort):
- 9-10 (effort "quick"): under ~50 source lines, one file or one tight concern, nothing risky.
- 7-8 (effort "quick" or "moderate"): under ~200 source lines in a few files with straightforward logic, or a larger change that is mostly tests/docs/generated noise.
- 5-6 (effort "moderate"): up to ~500 source lines across a handful of files, ordinary logic changes.
- 3-4 (effort "involved"): roughly 500-1500 source lines, changes scattered across many files, or risky areas (migrations, auth, concurrency, data handling, error paths).
- 1-2 (effort "heavy"): thousands of source lines, sweeping refactors, or multiple risky areas at once.
Pick the band from the measurable numbers first, then move at most 1 point within the band for judgement calls. The effort field must agree with the band.`

// Prompt for the second-pass consistency review: a stronger model audits the
// candidate rating against deterministic diff facts and the rubric, and pins
// the score to the previous rating when the diff has not changed.
export function ratingReviewPrompt(opts: {
  title: string
  facts: string
  candidate: ReviewRating
  previous?: ReviewRating | null
}): string {
  return `You are auditing a reviewability rating that another model produced for a pull request. Your job is CONSISTENCY: the same diff must always land on the same score. Do not re-review the code — verify the rating against the measurable facts below and the rubric, and correct it where it drifted.

PR: ${opts.title}

Measurable facts, computed deterministically from the diff:
${opts.facts}

Candidate rating to audit:
${JSON.stringify(opts.candidate, null, 2)}
${opts.previous ? `
A previous run rated this EXACT same diff (byte-identical — the code has not changed). Score churn between identical runs is a bug, not a judgement call: keep the previous score unless the candidate cites a concrete fact the previous rating got factually wrong, and if you do change it, name that fact in a factor.
Previous rating:
${JSON.stringify(opts.previous, null, 2)}
` : ''}
Checklist:
1. Re-derive the score band from the facts using the rubric below; if the candidate score is outside its band, correct it.
2. Check that the effort field agrees with the band.
3. Drop or fix any factor that contradicts the measurable facts; keep the rest as-is.
4. Keep the summary and readingOrder unless they contradict the facts.

${RATING_RUBRIC}

Respond with ONLY the final JSON object (no prose, no markdown fences), in exactly this shape:
${RATING_FORMAT}`
}

export const RISK_FORMAT = `{
  "files": [
    { "path": <file path exactly as listed above>, "level": <"low" | "medium" | "high">, "note": <one short sentence: why this level, and what to check> }
  ]
}
Rate EVERY file listed above.
- "high": subtle or risky changes that deserve line-by-line scrutiny — core behavior changes, tricky edge cases, concurrency, security-sensitive code, data migrations, error handling that could swallow failures.
- "medium": ordinary logic changes to read normally.
- "low": mechanical, generated, formatting-only, docs, or trivially safe changes the reviewer can skim.`

export function tourFormat(headRef: string): string {
  return `{
  "overview": <2-4 short paragraphs of markdown: what this change does and why, how it is structured, and any concepts the reviewer needs before reading code. Write for someone about to review it, not marketing copy.>,
  "stops": [
    {
      "path": <file path exactly as it appears in the diff>,
      "side": <"RIGHT" for lines in the new version of the file (the usual case), "LEFT" only when pointing at deleted lines>,
      "line": <first line number of the region, in that version of the file>,
      "endLine": <last line number of the region; keep regions under ~40 lines>,
      "title": <short label for this stop, a few words>,
      "note": <1-3 sentences: what this code does in the change, why it is at this point in the tour, and what the reviewer should check>
    }
  ]
}

Guidance for stops:
- 5 to ${MAX_TOUR_STOPS} stops, ordered as a narrative: start where the change is anchored (schema, core logic, key interface), then follow the consequences outward; put tests near the code they cover.
- Anchor every stop on lines the PR actually changes, so it lands on visible diff lines.
- Cover the parts that matter; skip generated files, lockfiles, and repetitive mechanical edits (mention those once in the overview instead).
- Line numbers must be real: count them from the diff hunk headers or read the file at ${headRef}. Do not guess.`
}

export const QUESTIONS_FORMAT = `TOPIC: <2-4 word label for what the question is about, e.g. architecture, new pattern, API contract>
QUESTION: <the question, addressed to the reviewer, that they must answer for themselves before approving>
WHY: <1-2 sentences on why this question matters for this particular PR — what is at stake if it is answered carelessly>
---

Guidance for the questions:
- Exactly ${QUESTION_COUNT} questions, and make them the big ones: the architectural direction this change commits the codebase to, new patterns / abstractions / dependencies it introduces, decisions that will be hard to reverse later, changed boundaries or contracts between parts of the system.
- Do NOT ask nitty-gritty code-level questions (naming, style, off-by-one, missing null check) — those belong as inline comments on the diff, not here.
- Each question must be specific to this PR: name the actual files, modules, or concepts involved. No generic checklist filler like "is this well tested?".
- Ask genuinely open questions a thoughtful reviewer could answer either way — the point is to make them form and defend a judgement, not to hint at a correct answer.`

export function cleanRating(rating: any): ReviewRating {
  if (typeof rating?.score !== 'number' || !Array.isArray(rating.factors)) {
    throw createError({ statusCode: 500, message: 'claude returned an unexpected rating shape' })
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
    throw createError({ statusCode: 500, message: 'claude returned an unexpected risk shape' })
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
    throw createError({ statusCode: 500, message: 'claude returned an unexpected tour shape' })
  }
  return { overview: parsed.overview, stops }
}

// The questions are pure prose, so they come back in a labelled plain-text
// format instead of JSON — quotes and newlines in the text can't corrupt
// the parse (JSON escaping was a recurring failure here). Any prose around
// the blocks is ignored; only TOPIC:/QUESTION:/WHY: groups are read.
export function parseQuestions(text: string): SelfQuestion[] {
  const questions: SelfQuestion[] = []
  for (const block of text.split(/^TOPIC:/m).slice(1)) {
    const m = /^([\s\S]*?)\nQUESTION:([\s\S]*?)\nWHY:([\s\S]*)/.exec(block)
    if (!m) continue
    const question = m[2]!.trim()
    if (!question) continue
    questions.push({
      topic: m[1]!.trim().slice(0, 60),
      question,
      // Drop the --- separator (and any prose after the last block).
      why: m[3]!.split(/\n\s*---/)[0]!.trim(),
      answer: '',
      postedUrl: null,
    })
  }
  return questions
}
