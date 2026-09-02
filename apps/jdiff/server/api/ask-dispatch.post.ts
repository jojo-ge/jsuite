import { basename } from 'node:path'
import { ASK_QUESTIONS } from '../../app/utils/askQuestions'

// Fire a preset per-line question by dispatching a claude session into herdr
// (same topology as analyze-dispatch: repo workspace, own job tab, Opus 5,
// focused on dispatch). The session runs the globally-installed `jdiff-ask`
// skill, which answers grounded in the repo and POSTs the answer back to
// /api/ask-result; the diff view polls /api/asks until it lands.
//
// Body: { repo, number | branch (+ base?), path, line, side, question }
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const repo = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)
  requireCommittedScope(target, 'an ask')
  const filePath = String(body?.path ?? '')
  if (!filePath) throw createError({ statusCode: 400, message: 'missing path' })
  const line = Number(body?.line)
  if (!Number.isInteger(line) || line < 1) throw createError({ statusCode: 400, message: 'bad line' })
  const side = String(body?.side ?? '')
  if (!['LEFT', 'RIGHT'].includes(side)) throw createError({ statusCode: 400, message: 'bad side' })
  const question = ASK_QUESTIONS.find((q) => q.id === body?.question)
  if (!question) throw createError({ statusCode: 400, message: 'unknown question' })

  const prepared = await prepareTarget(target, repo)

  const label = targetLabel(target)
  const { workspaceId, freshTab } = await ensureHerdrWorkspace(`jdiff · ${basename(repo)}`, repo)
  const tabLabel = `ask ${label} · L${line}`
  let tabId: string, paneId: string
  if (freshTab) {
    await herdrJson(['tab', 'rename', freshTab.tabId, tabLabel])
    ;({ tabId, paneId } = freshTab)
  } else {
    ;({ tabId, paneId } = await createJobTab(workspaceId, tabLabel, repo))
  }

  const targetArgs = target.kind === 'pr'
    ? `number=${target.number}`
    : `branch=${target.branch} base=${prepared.base}`
  // path is quoted — it's the one arg that can contain spaces.
  const prompt = `/jdiff-ask ${targetArgs} range=${prepared.range} head=${prepared.headRef} `
    + `path="${filePath}" line=${line} side=${side} question=${question.id}`

  const agent = await startClaudeIn(paneId, `jdiff-ask-${target.storeKey}`, prompt, {
    args: ['--model', REVIEW_MODEL],
  })

  await herdrJson(['tab', 'focus', tabId]).catch(() => {})
  await focusHerdrWindow()

  return { agent, workspaceId, tabId, dispatchedAt: Date.now() }
})
