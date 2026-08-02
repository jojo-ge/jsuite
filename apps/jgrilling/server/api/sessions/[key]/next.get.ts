import { runClaude, extractJson, ANALYSIS_TOOLS } from '@jsuite/claude'
import type { GrillTurn } from '../../../../app/utils/grillTypes'

/**
 * SSE: produce the next move in the grilling — either the next question
 * (saved onto the session, pushed as `question`) or, once claude declares the
 * interview complete (or the client forces it with ?wrapup=1), the debrief
 * document in the shared @jsuite/documents pool (pushed as `done`).
 *
 * The claude run is tied to this connection (the jDiff ask pattern): closing
 * the EventSource kills the process. Reconnecting with an already-open
 * question just replays it without spawning anything.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const session = await readGrill(key)
  if (!session) throw createError({ statusCode: 404, message: `No such session: ${key}` })
  if (session.status === 'done') throw createError({ statusCode: 400, message: 'session is already done' })
  const wrapup = String(getQuery(event).wrapup ?? '') === '1'

  const stream = createEventStream(event)
  const abort = new AbortController()
  stream.onClosed(() => abort.abort())
  const started = Date.now()
  const push = (kind: string, data: Record<string, any> = {}) => {
    if (abort.signal.aborted) return
    stream.push(JSON.stringify({ kind, t: ((Date.now() - started) / 1000).toFixed(1), ...data }))
  }
  const log = (text: string) => {
    push('log', { text })
    console.log(`[grill ${key}] ${text}`)
  }

  const claudeOpts = {
    // Only repo-grounded sessions get tools — a plain plan grilling has no
    // repository for claude to wander.
    cwd: session.repoPath,
    allowedTools: session.repoPath ? ANALYSIS_TOOLS : undefined,
    signal: abort.signal,
    log,
    onThinking: (text: string) => push('thinking', { text }),
  }

  ;(async () => {
    try {
      const open = openTurn(session)
      if (open && !wrapup) {
        // Reconnect while a question is pending — replay it, spawn nothing.
        push('question', { turn: open })
        return
      }

      let verdict: string | undefined
      let needWrapup = wrapup

      if (!needWrapup) {
        log('deciding what to ask next…')
        const raw = await runClaude(nextQuestionPrompt(session), claudeOpts)
        const parsed = extractJson(raw)
        if (parsed.done) {
          verdict = String(parsed.verdict ?? 'Shared understanding reached.')
          needWrapup = true
          log('claude declared the grilling complete — drafting the debrief…')
        } else {
          const turn: GrillTurn = {
            id: `q${session.turns.length + 1}`,
            topic: String(parsed.topic ?? 'next decision'),
            question: String(parsed.question ?? '').trim(),
            recommendation: String(parsed.recommendation ?? '').trim(),
            why: parsed.why ? String(parsed.why) : undefined,
            askedAt: new Date().toISOString(),
          }
          if (!turn.question) throw new Error('claude returned an empty question')
          session.turns.push(turn)
          await writeGrill(session)
          push('question', { turn })
          return
        }
      }

      if (needWrapup) {
        if (wrapup) log('wrapping up on request — drafting the debrief…')
        const raw = await runClaude(wrapupPrompt(session), claudeOpts)
        const parsed = extractJson(raw)

        const title = String(parsed.title ?? '').trim() || `${session.title} — grilled`
        const docKey = await uniqueDocKey(docKeyFromTitle(title))
        const now = new Date().toISOString()
        // Same shape POST /api/documents builds — but done here directly (the
        // jTicket pattern) so the session can record the resulting key.
        await writeDoc(docKey, {
          format: 'j-explain',
          version: 1,
          key: docKey,
          title,
          subtitle: typeof parsed.subtitle === 'string' && parsed.subtitle.trim() ? parsed.subtitle.trim() : undefined,
          kicker: typeof parsed.kicker === 'string' && parsed.kicker.trim() ? parsed.kicker.trim() : 'Grilling debrief',
          createdAt: now,
          updatedAt: now,
          blocks: await materialiseBlocks(docKey, Array.isArray(parsed.blocks) ? parsed.blocks : []),
          glossary: cleanGlossary(parsed.glossary),
        })

        session.status = 'done'
        session.verdict = verdict ?? (wrapup ? 'Wrapped up at the user’s request.' : undefined)
        session.documentKey = docKey
        await writeGrill(session)
        log(`debrief published: ${docKey}`)
        push('done', { session })
      }
    } catch (err: any) {
      push('error', { message: String(err.message ?? err).slice(0, 500) })
    } finally {
      await stream.close()
    }
  })()

  return stream.send()
})
