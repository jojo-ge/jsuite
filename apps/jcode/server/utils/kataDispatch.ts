import { basename } from 'node:path'
import type { KataAttempt } from '../../app/utils/kataTypes'

export interface DispatchOutcome {
  attempt: KataAttempt
  dispatched: boolean
  error?: string
  /** The prompt to run by hand when dispatch failed. */
  prompt: string
}

/**
 * Hand an attempt to a marking session in herdr: one workspace per repo
 * (`jcode · <repo>`), one single-pane job tab per attempt, claude started
 * with `/jcode-mark <key> attempt=<n>`. The tab is focused; the window is
 * not — the human is watching the kata page, where the verdict lands.
 *
 * Always re-reads the kata around the herdr calls (they take seconds, and the
 * marker may already be writing) and never fails the attempt: a herdr error
 * is recorded on the attempt as `marker.error` so the page can offer a retry
 * or the manual command.
 */
export async function dispatchMarker(key: string, attemptId: string): Promise<DispatchOutcome> {
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })
  const attempt = kata.attempts.find((a) => a.id === attemptId || String(a.n) === attemptId)
  if (!attempt) throw createError({ statusCode: 404, message: `No such attempt: ${attemptId}` })
  if (attempt.status !== 'marking') {
    throw createError({ statusCode: 409, message: `attempt ${attempt.n} is already ${attempt.status}` })
  }

  const prompt = `/jcode-mark ${kata.key} attempt=${attempt.n}`
  // Sandbox katas are marked from the sandbox — the marker needs the
  // cases and the entry file, not the repo. Repo katas run in the repo.
  const cwd = kata.sandbox?.dir ?? kata.repoPath
  const label = kata.sandbox ? `jcode · ${kata.key}` : `jcode · ${basename(cwd)}`
  try {
    const { workspaceId, freshTab } = await ensureHerdrWorkspace(label, cwd)
    const tabLabel = `mark ${kata.key} · #${attempt.n}`
    let tabId: string, paneId: string
    if (freshTab) {
      await herdrJson(['tab', 'rename', freshTab.tabId, tabLabel])
      ;({ tabId, paneId } = freshTab)
    } else {
      ;({ tabId, paneId } = await createJobTab(workspaceId, tabLabel, cwd))
    }
    await renamePane(paneId, `${kata.target.symbol} · attempt ${attempt.n}`)
    const agent = await startClaudeIn(paneId, `jcode-${kata.key}`, prompt, {
      args: MARK_MODEL ? ['--model', MARK_MODEL] : [],
    })
    await herdrJson(['tab', 'focus', tabId]).catch(() => {})

    const fresh = (await readKata(key)) ?? kata
    const a = fresh.attempts.find((x) => x.id === attempt.id) ?? attempt
    a.marker = { agent, workspaceId, tabId }
    await writeKata(fresh)
    return { attempt: a, dispatched: true, prompt }
  } catch (err: any) {
    const error = String(err.message ?? err).slice(0, 300)
    const fresh = (await readKata(key)) ?? kata
    const a = fresh.attempts.find((x) => x.id === attempt.id) ?? attempt
    a.marker = { error }
    await writeKata(fresh)
    return { attempt: a, dispatched: false, error, prompt }
  }
}
