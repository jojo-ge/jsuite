import { spawn } from 'node:child_process'
import { prCoordinates, type Finding, type Review } from '../../app/utils/reviewTypes'
import { assertCommandAllowed } from './sandbox'

// Posting a review's findings to its GitHub PR — the human's "Post to PR"
// button (the review room or jTicket's Review tab), never a session's.
//
// It goes out as ONE pull-request review through `gh api`, so it is posted
// with the human's own gh auth, as them. The review event is always COMMENT:
// it is hard-coded here and no caller can change it. the review engine may RECOMMEND
// approval (review.assessment) but never approves — or requests changes —
// on anyone's behalf; that click stays the human's, on GitHub.
//
// A finding whose file:line is a line the PR adds or changes goes inline;
// every other one goes into the review body. GitHub refuses the whole review
// (422) when one inline anchor isn't in its diff — the merge base it uses
// can differ from ours — so a refusal is retried once with everything in the
// body.

/** The only review event the review engine ever sends. Not a parameter, on purpose. */
const REVIEW_EVENT = 'COMMENT' as const

function gh(args: string[], input: string, cwd: string): Promise<string> {
  // A sandbox never posts to GitHub outside its writable repos.
  assertCommandAllowed('gh', args, cwd)
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), 60_000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(Object.assign(new Error(err.trim() || out.trim() || `gh exited ${code}`), { stdout: out, stderr: err }))
    })
    child.stdin.end(input)
  })
}

/** One finding as a comment: what's wrong, then the detail the triager wrote. */
export function findingComment(f: Finding): string {
  const head = `**[${f.severity}] ${f.title}**${f.category ? ` · ${f.category}` : ''}`
  return [head, f.summary, f.detail].filter((x) => x && x.trim()).join('\n\n')
}

/** Where a finding sits, for the body list: `path:line`, or nothing. */
const where = (f: Finding) => (f.file ? ` — \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '')

export interface PrReviewPayload {
  commit_id?: string
  event: typeof REVIEW_EVENT
  body: string
  comments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }>
}

/**
 * The review GitHub receives. `anchors` is what the PR changes (changedLines);
 * `inline: false` puts every finding in the body (the 422 retry).
 */
export function buildPrReview(
  review: Pick<Review, 'headSha'>,
  findings: Finding[],
  body: string,
  anchors: Map<string, Set<number>>,
  inline = true,
): PrReviewPayload {
  const comments: PrReviewPayload['comments'] = []
  const rest: Finding[] = []
  for (const f of findings) {
    if (inline && f.file && f.line && anchors.get(f.file)?.has(f.line)) {
      comments.push({ path: f.file, line: f.line, side: 'RIGHT', body: findingComment(f) })
    } else rest.push(f)
  }
  const parts = [body.trim()]
  if (rest.length) {
    parts.push(
      [
        comments.length ? '### Other findings' : '### Findings',
        ...rest.map((f) => `<details><summary><b>[${f.severity}] ${escapeHtml(f.title)}</b>${escapeHtml(where(f))}</summary>\n\n${[f.summary, f.detail].filter(Boolean).join('\n\n')}\n\n</details>`),
      ].join('\n\n'),
    )
  }
  return {
    ...(review.headSha ? { commit_id: review.headSha } : {}),
    event: REVIEW_EVENT,
    body: parts.filter(Boolean).join('\n\n'),
    comments,
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Post `findings` (with `body` on top) to the review's PR as one COMMENT
 * review. Returns the GitHub review's URL and how many went inline.
 */
export async function postPrReview(review: Review, findings: Finding[], body: string): Promise<{ url: string; inline: number }> {
  if (!review.pr) throw createError({ statusCode: 409, message: `review ${review.key} has no pull request to post to` })
  const pr = prCoordinates(review.pr.url)
  if (!pr) throw createError({ statusCode: 409, message: `not a GitHub pull request URL: ${review.pr.url}` })
  if (!findings.length && !body.trim()) throw createError({ statusCode: 400, message: 'nothing to post — pick a finding or write a summary' })

  const anchors = review.headSha ? await changedLines(review.repoPath, review.base, review.headSha) : new Map<string, Set<number>>()
  const path = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`
  const send = async (payload: PrReviewPayload) => JSON.parse(await gh(['api', '--method', 'POST', path, '--input', '-'], JSON.stringify(payload), review.repoPath))

  let payload = buildPrReview(review, findings, body, anchors)
  try {
    const res = await send(payload)
    return { url: String(res?.html_url ?? review.pr.url), inline: payload.comments.length }
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    // An anchor GitHub won't take: everything into the body, once.
    if (payload.comments.length && /422|Unprocessable|line must be part of the diff|pull_request_review_thread/i.test(msg)) {
      payload = buildPrReview(review, findings, body, anchors, false)
      try {
        const res = await send(payload)
        return { url: String(res?.html_url ?? review.pr.url), inline: 0 }
      } catch (again: any) {
        throw createError({ statusCode: 502, message: `GitHub refused the review: ${String(again?.message ?? again).slice(0, 300)}` })
      }
    }
    throw createError({ statusCode: 502, message: `GitHub refused the review: ${msg.slice(0, 300)}` })
  }
}
