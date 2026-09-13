import { mkdir, writeFile, copyFile, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import type { KataSandbox, SandboxLang } from '../../app/utils/kataTypes'

// A kata's sandbox: its own little environment under .data/jcode/sandbox/<key>/
// with the stub, the cases, optional types, and the app's runner for the
// language. The build session posts the files; the app lays them out and
// owns the runner (copied fresh on every publish, so fixes here reach every
// kata).

export const SANDBOX_LANGS: SandboxLang[] = ['ts', 'js', 'php', 'py']

const RUNNER: Record<SandboxLang, { file: string; command: (bin: SandboxBins) => string }> = {
  ts: { file: 'run.ts', command: (b) => `${b.tsx} run.ts` },
  js: { file: 'run.ts', command: (b) => `${b.tsx} run.ts` },
  php: { file: 'run.php', command: () => 'php run.php' },
  py: { file: 'run.py', command: () => 'python3 run.py' },
}

export interface SandboxBins {
  /** The app's own tsx, so sandboxes need no node_modules of their own. */
  tsx: string
}

export function sandboxBins(): SandboxBins {
  const cfg = useRuntimeConfig()
  return { tsx: JSON.stringify(cfg.jcodeTsx as string) }
}

export function sandboxRunnerSource(lang: SandboxLang): string {
  return join(useRuntimeConfig().jcodeRunners as string, RUNNER[lang].file)
}

/** The entry file name for a language — the one file the human edits. */
export function sandboxEntry(lang: SandboxLang): string {
  return `solution.${lang === 'js' ? 'js' : lang}`
}

const SAFE_NAME = /^[A-Za-z0-9_.-]+$/

/**
 * Lay a sandbox out from posted files. `files` maps name → content; names are
 * flat (no directories), and the runner name is reserved. Returns the sandbox
 * record to store on the kata.
 */
export async function createSandbox(
  key: string,
  lang: SandboxLang,
  files: Record<string, string>,
  fn: string,
): Promise<KataSandbox> {
  const dir = sandboxDir(key)
  await mkdir(dir, { recursive: true })
  const runner = RUNNER[lang]
  const written: string[] = []
  for (const [name, content] of Object.entries(files)) {
    if (!SAFE_NAME.test(name) || name === runner.file) {
      throw createError({ statusCode: 400, message: `sandbox file name not allowed: ${name}` })
    }
    await writeFile(join(dir, name), String(content).replace(/\n?$/, '\n'), 'utf8')
    written.push(name)
  }
  const entry = sandboxEntry(lang)
  if (!written.includes(entry)) throw createError({ statusCode: 400, message: `sandbox.files must include ${entry}` })
  const casesFile = `cases.${lang === 'js' ? 'js' : lang}`
  if (!written.some((f) => f === casesFile || f.startsWith('cases.'))) {
    throw createError({ statusCode: 400, message: `sandbox.files must include ${casesFile}` })
  }
  await copyFile(sandboxRunnerSource(lang), join(dir, runner.file))
  return { lang, dir, entry, fn, run: runner.command(sandboxBins()), files: written.sort() }
}

/** Refresh the runner in an existing sandbox (after an app update). */
export async function refreshSandboxRunner(sb: KataSandbox): Promise<void> {
  await copyFile(sandboxRunnerSource(sb.lang), join(sb.dir, RUNNER[sb.lang].file))
}

/** Read the sandbox's authored files (not the runner) — for the page. */
export async function readSandboxFiles(sb: KataSandbox): Promise<{ name: string; content: string }[]> {
  if (!existsSync(sb.dir)) return []
  const names = (await readdir(sb.dir)).filter((n) => n !== RUNNER[sb.lang].file && SAFE_NAME.test(n)).sort()
  const out: { name: string; content: string }[] = []
  for (const name of names) out.push({ name, content: await readFile(join(sb.dir, name), 'utf8') })
  return out
}

export function sandboxFilePath(sb: KataSandbox, name: string): string {
  const abs = resolve(sb.dir, name)
  if (!abs.startsWith(sb.dir + sep) || basename(abs) !== name) {
    throw createError({ statusCode: 400, message: 'bad sandbox file name' })
  }
  return abs
}
