// The outcome report's hand-off prompt — what the auto loop's last session is
// told once a project has no open ticket left. Pure (no Nuxt, no store): the
// engine (autoLoop.ts) gathers the inputs. See outcomeReport.test.ts.
import { OUTCOME_LABEL, OUTCOME_WORD_LIMIT } from '../../app/utils/autoLoop'

const API = 'http://localhost:43000'
/** Enough commits to find the project's work; beyond this the session asks the API. */
const COMMIT_CAP = 40

export interface OutcomeReportInput {
  project: { key: string; title: string; repo: string; integrationBranch: string }
  /** The project's existing outcome report (DOC-n) — rewritten in place, not duplicated. */
  existingDoc: string | null
  /** The project's merged local PRs, oldest first — its own squash commits on the branch. */
  merged: Array<{ pr: string; sha: string; title: string }>
}

/** One line — herdr submits the prompt as typed input. */
export function outcomeReportPrompt({ project, existingDoc, merged }: OutcomeReportInput): string {
  const { key, title } = project
  const shown = merged.slice(-COMMIT_CAP)
  const commits = merged.length
    ? `Its own work is the squash commits its merged PRs landed on ${project.integrationBranch}: ` +
      shown.map((m) => `${m.pr} ${m.sha.slice(0, 12)} "${m.title}"`).join('; ') +
      (merged.length > shown.length ? ` (the latest ${shown.length} of ${merged.length}; GET ${API}/api/prs for the rest)` : '') +
      ` — read those, not the whole branch, which may carry other projects' work.`
    : `No local PR of its was merged; read its tickets' resolutions and the code on ${project.integrationBranch} to see what it did.`
  const publish = existingDoc
    ? `The project already has an outcome report, ${existingDoc}: rewrite it in place to cover the project as it stands now — PATCH ${API}/api/docs/${existingDoc} with the new "blocks" (keep its "${OUTCOME_LABEL}" label).`
    : `Create it: POST ${API}/api/docs with {"title": "${key} outcome report — ${title}", "project": "${key}", "labels": ["${OUTCOME_LABEL}"], "status": "ready", "blocks": [...]}.`
  return [
    `Write the outcome report for jTicket project ${key} "${title}": the auto loop has finished every ticket, and this report is how a reviewer learns what the project achieved before reading its diff.`,
    `In at most ${OUTCOME_WORD_LIMIT} words, explain what was built and how it works: what now exists, how the pieces fit together and where they live, and anything deliberately left out or surprising. No ticket-by-ticket changelog, no padding.`,
    `Read the project and its tickets (GET ${API}/api/projects/${key}) and the code in ${project.repo}.`,
    commits,
    `Publish it as a jTicket doc in the block-document format (the /to-jspec skill has the block shapes). ${publish}`,
    `Then report back to the auto loop, which waits on this before it finishes: POST ${API}/api/projects/${key}/auto/outcome-report with JSON {"doc": "<the doc's DOC key>"}.`,
  ].join(' ')
}
