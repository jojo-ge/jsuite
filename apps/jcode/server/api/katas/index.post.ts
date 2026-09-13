import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Kata, SandboxLang } from '../../../app/utils/kataTypes'

/**
 * Publish a kata. Body:
 *   { title, repoPath, feature, target: { file, symbol, signature?, lang? },
 *     sandbox: { lang: 'ts'|'js'|'php'|'py', files: { 'solution.ts': …, 'cases.ts': …, 'types.ts'?: … }, fn? },
 *     tests?: { command, files? }, brief: Block[], hints?: Block[][],
 *     solution: Block[], branch?, ticket?, scaffoldCommit?, key? }
 *
 * The caller is the Claude session that built the feature (skill `jcode`).
 * The feature is built and committed as usual; the kata is the feature's core
 * piece posed as a standalone problem in its own sandbox under
 * .data/jcode/sandbox/<key>/ — the stub the human fills in, the cases, and
 * the app's runner. `solution` is Claude's own implementation in the
 * sandbox's terms: stored in full, served to the browser only once the human
 * reveals it, always readable by the marker via /full.
 *
 * Without `sandbox` the kata is a legacy repo kata: the stub lives in the
 * repo at target.file and `tests.command` is required.
 * Returns { key, path: "/k/<key>", url, sandbox? }.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const bad = (m: string) => createError({ statusCode: 400, message: m })

  const title = String(body.title ?? '').trim()
  if (!title) throw bad('missing `title`')

  const rawRepo = String(body.repoPath ?? '').trim()
  if (!rawRepo) throw bad('missing `repoPath`')
  const repoPath = resolve(rawRepo.replace(/^~(?=$|\/)/, homedir()))
  if (!existsSync(repoPath)) throw bad(`repoPath does not exist: ${repoPath}`)

  const target = body.target ?? {}
  const file = String(target.file ?? '').trim()
  const symbol = String(target.symbol ?? '').trim()
  if (!file || !symbol) throw bad('missing `target.file` / `target.symbol`')

  const sandboxIn = body.sandbox
  const lang = String(sandboxIn?.lang ?? '').trim() as SandboxLang
  if (sandboxIn && !SANDBOX_LANGS.includes(lang)) throw bad(`sandbox.lang must be one of ${SANDBOX_LANGS.join(', ')}`)
  if (sandboxIn && (!sandboxIn.files || typeof sandboxIn.files !== 'object')) throw bad('sandbox.files must map file name → content')

  const command = String(body.tests?.command ?? '').trim()
  if (!sandboxIn && !command) throw bad('missing `tests.command` (or a `sandbox`)')

  if (!Array.isArray(body.brief) || !body.brief.length) throw bad('`brief` must be a non-empty block array')
  if (!Array.isArray(body.solution) || !body.solution.length) throw bad('`solution` must be a non-empty block array')
  const rawHints: unknown[] = Array.isArray(body.hints) ? body.hints : []
  for (const [i, h] of rawHints.entries()) {
    if (!Array.isArray(h) || !h.length) throw bad(`hints[${i}] must be a non-empty block array`)
  }

  const key = await uniqueKataKey(String(body.key ?? '') || title)

  const fn = String(sandboxIn?.fn ?? '').trim() || symbol.split(/[.#:]/).pop() || symbol
  const sandbox = sandboxIn ? await createSandbox(key, lang, sandboxIn.files, fn) : undefined

  // Blocks go through the shared materialiser so a mermaid chart in the brief
  // (or the answer's walkthrough) lands in the jChart pool like any document's.
  const brief = await materialiseBlocks(`${key}-brief`, body.brief)
  const hints = await Promise.all(rawHints.map((h, i) => materialiseBlocks(`${key}-hint-${i + 1}`, h as unknown[])))
  const solution = await materialiseBlocks(`${key}-answer`, body.solution)

  const now = new Date().toISOString()
  const kata: Kata = {
    format: 'j-code',
    version: 1,
    key,
    title,
    repoPath,
    branch: String(body.branch ?? '').trim() || undefined,
    ticket: String(body.ticket ?? '').trim() || undefined,
    scaffoldCommit: String(body.scaffoldCommit ?? '').trim() || undefined,
    feature: String(body.feature ?? '').trim(),
    target: {
      file,
      symbol,
      signature: String(target.signature ?? '').trim() || undefined,
      lang: String(target.lang ?? '').trim() || undefined,
    },
    sandbox,
    tests: {
      command: command || sandbox!.run,
      files: Array.isArray(body.tests?.files) ? body.tests.files.map(String).filter(Boolean) : undefined,
    },
    brief,
    hints,
    solution,
    hintsUnlocked: 0,
    hintsUnlockedAt: [],
    revealed: false,
    status: 'open',
    attempts: [],
    createdAt: now,
    updatedAt: now,
  }
  await writeKata(kata)
  return { key, title, path: `/k/${key}`, url: `https://jcode.local/k/${key}`, sandbox: sandbox && { dir: sandbox.dir, entry: sandbox.entry, run: sandbox.run } }
})
