// The slice report's hand-off prompt — what one session is told between a
// run plan's steps, so the next implement step's sessions can read what the
// slice built and decided instead of reconstructing it from the diff. Pure
// (no Nuxt, no store): the engine (autoLoop.ts) gathers the inputs; the
// `jslice-report` skill carries the writing contract.
import { SLICE_LABEL, SLICE_WORD_LIMIT } from '../../app/utils/autoLoop'

const API = 'http://localhost:43000'

export interface SliceReportInput {
  project: { key: string; title: string; repo: string; integrationBranch: string }
  /** The implement step (1-based) that reads this report. */
  step: number
  /** The integration tip the slice runs from (the last report's checkpoint, or the plan's start) … */
  from: string
  /** … to the tip now. */
  tip: string
  /** The tickets the slice landed (implement and fix tickets of the steps since the last report). */
  tickets: string[]
  /** The jReview reviews the slice ran (consensus and architectural). */
  reviews: string[]
  /** The previous slice report (DOC-n), for the chain. */
  previousDoc: string | null
}

/** One line — herdr submits the prompt as typed input. */
export function sliceReportPrompt({ project, step, from, tip, tickets, reviews, previousDoc }: SliceReportInput): string {
  const range = from && tip ? `${from.slice(0, 12)}..${tip.slice(0, 12)}` : `the commits since ${from.slice(0, 12) || 'the plan started'}`
  return [
    `/jslice-report ${project.key} step=${step} from=${from} to=${tip}${previousDoc ? ` previous=${previousDoc}` : ''}`,
    `— jTicket's run plan is about to start implement step ${step} and waits on this: write the slice report for what landed on ${project.integrationBranch} in ${range}`,
    `(tickets ${tickets.join(', ') || 'none recorded'}${reviews.length ? `; reviews ${reviews.join(', ')}` : ''}), in ${project.repo}.`,
    `Facts only, at most ${SLICE_WORD_LIMIT} words, labelled "${SLICE_LABEL}"; then POST ${API}/api/projects/${project.key}/auto/slice-report with {"doc": "<DOC key>"}.`,
    `Don't ask questions — nobody is watching this pane.`,
  ].join(' ')
}
