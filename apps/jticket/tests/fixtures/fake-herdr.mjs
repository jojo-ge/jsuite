#!/usr/bin/env node
// A scripted stand-in for the herdr CLI, for tests/herdr.test.ts. Every call
// is appended to $FAKE_HERDR_LOG; behaviour comes from the JSON scenario in
// $FAKE_HERDR_STATE, which this script also mutates (the agent's status and
// screen move as keys are "pressed"). Only the commands @jsuite/herdr's
// start/prompt path uses are implemented.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const [cmd, sub, ...rest] = process.argv.slice(2)
const statePath = process.env.FAKE_HERDR_STATE
const s = JSON.parse(readFileSync(statePath, 'utf8'))
appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify([cmd, sub, ...rest]) + '\n')
const save = () => writeFileSync(statePath, JSON.stringify(s))
const ok = (result) => { process.stdout.write(JSON.stringify({ result })); process.exit(0) }
const fail = (code, message) => { process.stderr.write(JSON.stringify({ error: { code, message } })); process.exit(1) }
const agent = () => ({ name: 'pj-1', agent: 'claude', agent_status: s.status })
const box = (input) => `${s.transcript ?? ''}\n${'─'.repeat(40)}\n❯ ${input}\n${'─'.repeat(40)}\n  Opus 5.5:high`

if (cmd === '--version') { process.stdout.write('herdr 0.9.1'); process.exit(0) }

// After the trust dialog is answered claude repaints: herdr keeps saying
// 'blocked' for a few looks (s.settling) and the screen shows the shell line.
function settle() {
  if (s.settling > 0 && --s.settling === 0) s.status = 'idle'
  save()
}

if (cmd === 'agent' && sub === 'list') ok({ agents: [] })
if (cmd === 'agent' && sub === 'get') { settle(); ok({ agent: agent() }) }

if (cmd === 'agent' && sub === 'start') {
  const next = (s.start ?? ['ok']).shift() ?? 'ok'
  save()
  if (next === 'busy') fail('agent_pane_busy', 'agent target pane w1:p1 is not an available shell')
  if (next === 'not_ready') { s.status = 'blocked'; save(); fail('agent_not_ready', 'agent pj-1 is blocked during startup and is not ready for prompts') }
  s.status = 'idle'; save()
  ok({ agent: agent(), type: 'agent_started' })
}

if (cmd === 'agent' && sub === 'read') {
  if (s.status === 'blocked' && s.dialog) process.stdout.write(s.dialog)
  else if (s.status === 'blocked') process.stdout.write('$ claude --model claude-haiku-5-5\n')
  else process.stdout.write(box(s.input ?? ''))
  process.exit(0)
}

if (cmd === 'agent' && sub === 'prompt') {
  const next = (s.prompt ?? ['ok']).shift() ?? 'ok'
  // 'eaten': text lands in the input, Enter is lost. 'lost': nothing lands.
  if (next === 'eaten') { s.input = rest[1]; save(); fail('agent_prompt_stalled', 'no agent activity observed after prompt submission') }
  if (next === 'lost') { save(); fail('agent_prompt_stalled', 'no agent activity observed after prompt submission') }
  s.status = 'working'; s.input = ''; save()
  ok({ agent: agent() })
}

if (cmd === 'agent' && sub === 'send-keys') {
  const keys = rest.slice(1)
  if (s.status === 'blocked' && s.dialog) {
    // The trust dialog: only down+enter trusts; a bare enter exits claude.
    if (keys.join(' ') === (s.trustKeys ?? 'down enter')) { s.dialog = null; s.settling = s.settleLooks ?? 0; if (!s.settling) s.status = 'idle' }
    else s.status = 'exited'
  } else if (keys.includes('enter') && s.input && s.enterStarts) {
    s.status = 'working'; s.input = ''
  }
  save()
  ok({ type: 'ok' })
}

if (cmd === 'agent' && sub === 'wait') {
  settle()
  const until = rest.filter((_, i) => rest[i - 1] === '--until')
  if (until.includes(s.status)) ok({ agent: agent() })
  fail('timeout', 'timed out waiting for agent state')
}

if (cmd === 'pane' && sub === 'read') { process.stdout.write('$ '); process.exit(0) }

fail('unsupported', `fake herdr: ${cmd} ${sub}`)
