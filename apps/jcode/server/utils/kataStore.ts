import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { Kata, KataMeta, KataView } from '../../app/utils/kataTypes'
import { kataStage } from '../../app/utils/kataTypes'

// One kata per pretty-printed file in .data/jcode/<key>.json — the
// jChart/jExplain/jGrilling store layout, so an LLM (the marker) can read a
// kata straight off disk. Function names are deliberately distinct from the
// charting and documents stores (readChart, readDoc, …), which are
// auto-imported into this server context too via the extended layers.
const DATA_DIR = appDataDir('jcode')

export type * from '../../app/utils/kataTypes'
export { kataStage }

export function sanitizeKataKey(key: unknown): string {
  return String(key ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

const kataPath = (key: string) => join(DATA_DIR, sanitizeKataKey(key) + '.json')

export async function uniqueKataKey(base: string): Promise<string> {
  const root = sanitizeKataKey(base) || 'kata'
  if (!existsSync(kataPath(root))) return root
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`
    if (!existsSync(kataPath(candidate))) return candidate
  }
  return `${root}-${Date.now()}`
}

/** The whole record, answer included — server-side and the marker's /full only. */
export async function readKata(key: string): Promise<Kata | null> {
  const p = kataPath(key)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Kata
  } catch {
    return null
  }
}

export async function writeKata(kata: Kata): Promise<void> {
  kata.updatedAt = new Date().toISOString()
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(kataPath(kata.key), JSON.stringify(kata, null, 2) + '\n', 'utf8')
}

export async function deleteKata(key: string): Promise<void> {
  const p = kataPath(key)
  if (existsSync(p)) await rm(p)
  const sandbox = sandboxDir(key)
  if (existsSync(sandbox)) await rm(sandbox, { recursive: true, force: true })
}

/** Where a kata's sandbox lives: .data/jcode/sandbox/<key>/ */
export function sandboxDir(key: string): string {
  return join(DATA_DIR, 'sandbox', sanitizeKataKey(key))
}

/**
 * Progressive disclosure happens HERE, not in the UI: the browser is handed
 * only the rungs the human has reached. Hints beyond `hintsUnlocked` and the
 * solution before `revealed` never leave the server, so the page can't leak
 * them by accident (devtools included).
 */
export function kataView(kata: Kata): KataView {
  const { hints, solution, ...rest } = kata
  return {
    ...rest,
    hints: hints.slice(0, kata.hintsUnlocked),
    hintCount: hints.length,
    solution: kata.revealed ? solution : null,
  }
}

export function kataMeta(k: Kata): KataMeta {
  return {
    key: k.key,
    title: k.title,
    repoPath: k.repoPath,
    lang: k.sandbox?.lang,
    ticket: k.ticket,
    target: k.target,
    status: k.status,
    stage: kataStage(k),
    hintsUnlocked: k.hintsUnlocked,
    hintCount: k.hints.length,
    revealed: k.revealed,
    attemptCount: k.attempts.length,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  }
}

export async function listKatas(): Promise<KataMeta[]> {
  if (!existsSync(DATA_DIR)) return []
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json'))
  const out: KataMeta[] = []
  for (const f of files) {
    try {
      const k = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8')) as Kata
      if (k.format !== 'j-code') continue
      out.push(kataMeta(k))
    } catch {
      // An unparseable file just doesn't appear in the list.
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

/** The attempt the marker is working on, if any. */
export function markingAttempt(kata: Kata) {
  return kata.attempts.find((a) => a.status === 'marking') ?? null
}
