import { AnsiUp } from 'ansi_up'

// A faithful mirror of the agent's full-screen TUI: for a full-screen app the
// current visible frame IS the whole state, so one capture-pane per poll with
// ANSI intact, converted to HTML, is all it takes.
export default defineEventHandler(async (event) => {
  const state = loadAgentState()
  const r = findRun(state, getRouterParam(event, 'id')!)
  const alive = await tmuxAlive(r.session)
  const pane = alive ? await tmuxCapture(r.session) : ''
  const ansi = new AnsiUp()
  ansi.use_classes = false
  return {
    alive,
    status: r.status,
    needsYou: r.needsYou,
    html: pane ? ansi.ansi_to_html(pane) : '',
  }
})
