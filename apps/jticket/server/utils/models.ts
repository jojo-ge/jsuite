// The claude models jTicket pins its herdr sessions to. Only the auto loop
// pins — a hand dispatch still runs whatever the claude CLI defaults to.
import { PLAN_MODELS, type PlanModel } from '../../app/utils/runPlan'

/** Auto-loop implementation and fix sessions — the latest Opus. */
export const IMPLEMENT_MODEL = process.env.JTICKET_IMPLEMENT_MODEL?.trim() || 'claude-opus-5-5'

/** Auto-loop merge sweeps — the latest Sonnet: rebasing and POSTing merges. */
export const MERGE_MODEL = process.env.JTICKET_MERGE_MODEL?.trim() || 'claude-sonnet-5'

/** The auto loop's outcome report — the latest Opus: it reads the project's code and explains it. */
export const REPORT_MODEL = process.env.JTICKET_REPORT_MODEL?.trim() || 'claude-opus-5-5'

/** A run plan's slice reports — Opus at medium effort: facts off a diff and a few docs, nothing to reason out. */
export const SLICE_MODEL = process.env.JTICKET_SLICE_MODEL?.trim() || 'claude-opus-5-5'
export const SLICE_EFFORT = process.env.JTICKET_SLICE_EFFORT?.trim() || 'medium'

/** Orchestrated auto loops — one session per phase that runs the tickets through subagents (Opus unless the run says otherwise). */
export const ORCHESTRATE_MODEL = process.env.JTICKET_ORCHESTRATE_MODEL?.trim() || 'claude-fable-5-2'

/**
 * The CLI model id a run's chosen model pins its sessions to. Opus and Fable
 * go through the env pins above, so JTICKET_*_MODEL still wins for them.
 */
export function modelIdFor(model: PlanModel): string {
  if (model === 'opus') return IMPLEMENT_MODEL
  if (model === 'fable') return ORCHESTRATE_MODEL
  return PLAN_MODELS[model].id
}

/** The Run setup tab's Build button — one Fable 5.2 session at high effort reads the project and writes its run plan. */
export const RUNPLAN_MODEL = process.env.JTICKET_RUNPLAN_MODEL?.trim() || 'claude-fable-5-2'
export const RUNPLAN_EFFORT = process.env.JTICKET_RUNPLAN_EFFORT?.trim() || 'high'

/** The Diff tab's Build tour — the latest Opus: it reads the whole change and writes 20–40 notes on its logic. */
export const TOUR_MODEL = process.env.JTICKET_TOUR_MODEL?.trim() || 'claude-opus-5-5'
