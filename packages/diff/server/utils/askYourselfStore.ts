import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { SelfQuestion } from '../../app/utils/askYourself'

export interface SavedAskYourself {
  repo: string
  number: string
  questions: SelfQuestion[]
  createdAt: string
}

// Latest question set per resolved repo path + PR number, answers included;
// regenerating overwrites (and drops old answers with the old questions).
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'ask-yourself.json')

export function loadAskYourself(repo: string, number: string): SavedAskYourself | null {
  return loadAll().find((t) => t.repo === repo && t.number === number) ?? null
}

export function saveAskYourself(entry: SavedAskYourself): void {
  mkdirSync(DIR, { recursive: true })
  const rest = loadAll().filter((t) => !(t.repo === entry.repo && t.number === entry.number))
  writeFileSync(FILE, JSON.stringify([...rest, entry], null, 2))
}

function loadAll(): SavedAskYourself[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
