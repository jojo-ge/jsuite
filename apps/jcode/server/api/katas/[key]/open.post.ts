import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const pExecFile = promisify(execFile)

/**
 * Open the kata's target file in VS Code, cursor on the held-back symbol.
 * The repo is opened as the workspace so the editor has the right root; the
 * line is found by looking for the symbol's last segment (`refill` of
 * `TokenBucket.refill`) in the file — best effort, line 1 otherwise.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })

  // Sandbox katas open the sandbox folder on its entry file; repo katas the
  // repo on the target file.
  const repo = kata.sandbox?.dir ?? kata.repoPath
  const abs = resolve(repo, kata.sandbox?.entry ?? kata.target.file)
  if (abs !== repo && !abs.startsWith(repo + sep)) {
    throw createError({ statusCode: 400, message: 'target file escapes the repo' })
  }

  let line = 1
  try {
    const name = kata.sandbox?.fn ?? kata.target.symbol.split(/[.#:]/).pop() ?? ''
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // A definition: the name at the start of a line after any modifiers
    // (`refill(now) {`, `export function refill(`, `const refill =`,
    // `def refill(`), not a call like `this.refill(now)`.
    const definition = new RegExp(
      `^\\s*(?:(?:export|default|async|function|public|private|protected|static|override|readonly|abstract|const|let|var|def|fn|func|pub)\\s+)*${esc}\\s*[(<=:]`,
    )
    const mention = new RegExp(`(^|[^A-Za-z0-9_$.])${esc}\\s*[(<=:]`)
    const lines = (await readFile(abs, 'utf8')).split('\n')
    let i = name ? lines.findIndex((l) => definition.test(l)) : -1
    if (i < 0 && name) i = lines.findIndex((l) => mention.test(l))
    if (i >= 0) line = i + 1
  } catch {
    // Missing file: still open the repo; VS Code will say so.
  }

  try {
    await pExecFile('code', [repo, '-g', `${abs}:${line}`], { cwd: repo })
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      message: `could not launch VS Code: ${String(err.stderr || err.message || err).trim().slice(0, 200)} — is the \`code\` command on PATH?`,
    })
  }
  return { ok: true, file: kata.sandbox?.entry ?? kata.target.file, line }
})
