// @jsuite/herdr's dispatch path: reading claude's screen, getting past the
// folder-trust dialog, making sure a prompt actually started (the Enter-eaten
// race), and the suite-wide dispatch lock. The CLI is a scripted fake
// (tests/fixtures/fake-herdr.mjs) so every failure mode replays exactly.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'herdr-test-'))
const FAKE = join(__dirname, 'fixtures', 'fake-herdr.mjs')
const STATE = join(dir, 'state.json')
const LOG = join(dir, 'calls.log')
// Set before the adapter loads: it resolves the binary once.
process.env.HERDR_BIN = FAKE
process.env.FAKE_HERDR_STATE = STATE
process.env.FAKE_HERDR_LOG = LOG
process.env.JSUITE_HERDR_LOCK = join(dir, 'dispatch.lock')

let herdr: typeof import('@jsuite/herdr')
beforeAll(async () => {
  chmodSync(FAKE, 0o755)
  herdr = await import('@jsuite/herdr')
})

function scenario(s: Record<string, unknown>) {
  writeFileSync(STATE, JSON.stringify({ status: 'idle', input: '', ...s }))
  writeFileSync(LOG, '')
}
const calls = () => readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[])
const sent = (sub: string) => calls().filter((c) => c[0] === 'agent' && c[1] === sub)
const state = () => JSON.parse(readFileSync(STATE, 'utf8'))

const RULE = '─'.repeat(84)
const screenWith = (input: string) => `✻ Churned for 11m 59s\n\n${RULE}\n❯ ${input}\n${RULE}\n  Opus 5.5:high\n  ~/code/jsuite · master\n`

describe('readInputBox', () => {
  it('reads the text sitting in claude’s input', () => {
    expect(herdr.readInputBox(screenWith('commit this')).input).toBe('commit this')
  })
  it('reads an empty input as empty, and keeps what is above it', () => {
    const box = herdr.readInputBox(screenWith(''))
    expect(box.input).toBe('')
    expect(box.before).toContain('Churned for')
  })
  it('reads a pasted prompt placeholder as pending input', () => {
    expect(herdr.readInputBox(screenWith('[Pasted text #1 +40 lines]')).input).toBe('[Pasted text #1 +40 lines]')
  })
  it('says null — not empty — when no input box is on screen', () => {
    expect(herdr.readInputBox('Do you trust the files in this folder?\n ❯ 1. Yes\n   2. No').input).toBeNull()
  })
})

describe('trustDialogKeys', () => {
  const dialog = (yesFirst: boolean, cursorOn: 1 | 2) => {
    const opts = yesFirst ? ['Yes, I trust this folder', 'No, exit'] : ['No, exit', 'Yes, I trust this folder']
    return ['Do you trust the files in this folder?', '/tmp/x', ...opts.map((o, i) => `${i + 1 === cursorOn ? ' ❯' : '  '} ${i + 1}. ${o}`), 'Enter to confirm · Esc to cancel'].join('\n')
  }
  it('moves down to Yes when the cursor starts on No', () => {
    expect(herdr.trustDialogKeys(dialog(true, 2))).toEqual(['up', 'enter'])
    expect(herdr.trustDialogKeys(dialog(false, 1))).toEqual(['down', 'enter'])
  })
  it('just confirms when the cursor is already on Yes', () => {
    expect(herdr.trustDialogKeys(dialog(true, 1))).toEqual(['enter'])
  })
  it('reads claude’s real dialog — unnumbered options, cursor on No', () => {
    // Captured from claude in a never-opened folder, 2026-11-06.
    const real = [
      ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment',
      ' to review what\'s in this folder first.',
      '',
      ' Claude Code\'ll be able to read, edit, and execute files here.',
      '',
      ' Security guide',
      '',
      ' ❯ No, exit',
      '   Yes, I trust this folder',
      '',
      ' Enter to confirm · Esc to cancel',
    ].join('\n')
    expect(herdr.trustDialogKeys(real)).toEqual(['down', 'enter'])
  })
  it('is null for anything that isn’t the trust dialog', () => {
    expect(herdr.trustDialogKeys('Claude Code has been updated — press enter')).toBeNull()
    expect(herdr.trustDialogKeys(screenWith(''))).toBeNull()
  })
})

describe('startClaudeIn', () => {
  const PROMPT = '/jimplement PJ-1 do the thing'

  it('submits once and returns when claude starts working', async () => {
    scenario({ prompt: ['ok'] })
    expect(await herdr.startClaudeIn('w1:p1', 'PJ-1', PROMPT)).toBe('pj-1')
    const prompts = sent('prompt')
    expect(prompts).toHaveLength(1)
    // Always waits for claude to start — without --wait herdr never reports a stall.
    expect(prompts[0]).toEqual(expect.arrayContaining(['--wait', '--until', 'working', 'blocked']))
  })

  it('retries while the fresh pane’s shell is still starting', async () => {
    scenario({ start: ['busy', 'busy', 'ok'], prompt: ['ok'] })
    await herdr.startClaudeIn('w1:p1', 'PJ-1', PROMPT)
    expect(sent('start')).toHaveLength(3)
  })

  it('presses Enter when the prompt sits unsubmitted in the input — never pastes it twice', async () => {
    scenario({ prompt: ['eaten'], enterStarts: true })
    await herdr.startClaudeIn('w1:p1', 'PJ-1', PROMPT)
    expect(sent('prompt')).toHaveLength(1)
    // A '/' prompt may have the command popup open: one esc closes it, then Enter.
    expect(sent('send-keys').map((c) => c[3])).toEqual(['esc', 'enter'])
    expect(state().status).toBe('working')
  })

  it('resubmits when the prompt never reached the input at all', async () => {
    scenario({ prompt: ['lost', 'ok'] })
    await herdr.startClaudeIn('w1:p1', 'PJ-1', PROMPT)
    expect(sent('prompt')).toHaveLength(2)
  })

  it('does not resubmit a prompt that already went through', async () => {
    scenario({ prompt: ['lost'], transcript: `> ${PROMPT}\n  ⎿ done` })
    await herdr.startClaudeIn('w1:p1', 'PJ-1', PROMPT)
    expect(sent('prompt')).toHaveLength(1)
  })

  it('fails loudly, with the screen, when Enter does not start it either', async () => {
    scenario({ prompt: ['eaten'], enterStarts: false })
    await expect(herdr.startClaudeIn('w1:p1', 'PJ-1', PROMPT)).rejects.toMatchObject({
      code: 'agent_prompt_stalled',
      message: expect.stringContaining(PROMPT),
    })
    expect(sent('prompt')).toHaveLength(1)
  })

  it('accepts the folder-trust dialog, then prompts', async () => {
    const dialog = 'Do you trust the files in this folder?\n ❯ 1. No, exit\n   2. Yes, I trust this folder'
    // settleLooks: herdr still says blocked for a few looks while claude repaints.
    scenario({ start: ['not_ready'], dialog, trustKeys: 'down enter', settleLooks: 3, prompt: ['ok'] })
    await herdr.startClaudeIn('w1:p1', 'PJ-1', PROMPT)
    expect(sent('send-keys')[0]!.slice(3)).toEqual(['down', 'enter'])
    expect(state().status).toBe('working')
  })

  it('refuses a startup screen it can’t read, saying what is on it', async () => {
    scenario({ start: ['not_ready'], dialog: 'Approve MCP server "pencil"?\n ❯ 1. Approve\n   2. Deny' })
    await expect(herdr.startClaudeIn('w1:p1', 'PJ-1', PROMPT)).rejects.toMatchObject({
      code: 'agent_not_ready',
      message: expect.stringContaining('Approve MCP server'),
    })
    expect(sent('send-keys')).toHaveLength(0)
    expect(sent('prompt')).toHaveLength(0)
  })
})

describe('withHerdrLock', () => {
  beforeEach(() => scenario({}))

  it('runs dispatches one at a time', async () => {
    const order: string[] = []
    const job = (name: string) => herdr.withHerdrLock(async () => {
      order.push(`${name}:in`)
      await new Promise((r) => setTimeout(r, 30))
      order.push(`${name}:out`)
    })
    await Promise.all([job('a'), job('b'), job('c')])
    expect(order).toEqual(['a:in', 'a:out', 'b:in', 'b:out', 'c:in', 'c:out'])
    expect(existsSync(process.env.JSUITE_HERDR_LOCK!)).toBe(false)
  })

  it('is re-entrant, so a whole sequence can hold it while its steps take it too', async () => {
    const got = await herdr.withHerdrLock(() => herdr.withHerdrLock(async () => 'inner'))
    expect(got).toBe('inner')
  })

  it('releases on failure', async () => {
    await expect(herdr.withHerdrLock(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await herdr.withHerdrLock(async () => 'next')).toBe('next')
  })

  it('takes over a lock left by a process that died', async () => {
    writeFileSync(process.env.JSUITE_HERDR_LOCK!, JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }))
    expect(await herdr.withHerdrLock(async () => 'ok')).toBe('ok')
  })
})
