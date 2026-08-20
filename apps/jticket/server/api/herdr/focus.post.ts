// The "go to herdr" buttons: focus something in the running herdr session AND
// bring the hosting terminal window to the front of macOS. This is the ONE
// place jTicket is allowed to move focus — everything the dispatch endpoints
// create is --no-focus by design.
//
// Body: { agent?: string, tab?: string, workspace?: string }
// Tried most-specific-first, falling through to the next given target — an
// agent that has since exited still lands you on its project's workspace.
import { focusHerdrWindow } from '../../utils/herdr'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ agent?: string; tab?: string; workspace?: string }>(event)
  const agent = (body?.agent ?? '').trim()
  const tab = (body?.tab ?? '').trim()
  const workspace = (body?.workspace ?? '').trim()
  if (!agent && !tab && !workspace) throw createError({ statusCode: 400, statusMessage: 'pass agent, tab, or workspace' })

  const attempts: { args: string[]; label: string }[] = []
  if (agent) attempts.push({ args: ['agent', 'focus', agent], label: agent })
  if (tab) attempts.push({ args: ['tab', 'focus', tab], label: tab })
  if (workspace) attempts.push({ args: ['workspace', 'focus', workspace], label: workspace })

  let focused = ''
  let lastErr: unknown
  for (const { args, label } of attempts) {
    try {
      await herdrJson(args)
      focused = label
      break
    } catch (err) {
      lastErr = err
    }
  }
  if (!focused) throw lastErr

  invalidateHerdrState()
  const windowFocused = await focusHerdrWindow()
  return { focused, windowFocused }
})
