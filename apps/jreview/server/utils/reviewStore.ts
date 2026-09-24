import { readFile, writeFile, readdir, rm, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { Review, ReviewMeta } from '../../app/utils/reviewTypes'

// One review per pretty-printed file in .data/jreview/<key>.json — the jMap/
// jCode store layout, so an LLM can read a review straight off disk.
// Function names are deliberately distinct from the charting and documents
// stores (readChart, readDoc, …), which are auto-imported into this server
// context too via the extended layers.
const DATA_DIR = appDataDir('jreview')

export type * from '../../app/utils/reviewTypes'

export function sanitizeReviewKey(key: unknown): string {
  return String(key ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const reviewPath = (key: string) => join(DATA_DIR, sanitizeReviewKey(key) + '.json')

export async function uniqueReviewKey(base: string): Promise<string> {
  const root = sanitizeReviewKey(base) || 'review'
  if (!existsSync(reviewPath(root))) return root
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`
    if (!existsSync(reviewPath(candidate))) return candidate
  }
  return `${root}-${Date.now()}`
}

export async function readReview(key: string): Promise<Review | null> {
  const p = reviewPath(key)
  if (!existsSync(p)) return null
  try {
    const review = JSON.parse(await readFile(p, 'utf8')) as Review
    return review.format === 'j-review' ? review : null
  } catch {
    return null
  }
}

/**
 * Write via a temp file + rename, so the /watch SSE and the watcher never
 * read a half-written review.
 */
export async function writeReview(review: Review): Promise<void> {
  review.updatedAt = new Date().toISOString()
  const p = reviewPath(review.key)
  const tmp = `${p}.tmp`
  await writeFile(tmp, JSON.stringify(review, null, 2) + '\n', 'utf8')
  await rename(tmp, p)
}

/**
 * Read-modify-write one review, serialised per key. Dispatch, the watcher
 * and the triage POST all mutate the same file seconds apart — without the
 * queue a slow herdr call would write back a stale copy over the others.
 * `fn` returning false means "nothing changed" — the file isn't rewritten.
 */
const queues = new Map<string, Promise<unknown>>()
export function updateReview(
  key: string,
  fn: (r: Review) => void | boolean | Promise<void | boolean>,
): Promise<Review> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(async () => {
    const review = await readReview(key)
    if (!review) throw createError({ statusCode: 404, message: `No such review: ${key}` })
    if ((await fn(review)) !== false) await writeReview(review)
    return review
  })
  queues.set(key, next.catch(() => {}))
  return next
}

export async function deleteReview(key: string): Promise<void> {
  const p = reviewPath(key)
  if (existsSync(p)) await rm(p)
}

export async function listReviews(): Promise<Review[]> {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json'))
  const out: Review[] = []
  for (const f of files) {
    try {
      const r = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8')) as Review
      if (r.format === 'j-review') out.push(r)
    } catch {
      // An unparseable file just doesn't appear in the list.
    }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export function reviewMeta(r: Review): ReviewMeta {
  return {
    key: r.key,
    title: r.title,
    repoPath: r.repoPath,
    branch: r.branch,
    prNumber: r.pr?.number,
    base: r.base,
    status: r.status,
    findingCount: r.findings.length,
    projectKey: r.tickets?.projectKey,
    consensus: r.consensus ? true : undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}
