import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { FilePayload } from './buildDiff'

export interface CachedDiff {
  headOid: string
  createdAt: string
  files: FilePayload[]
}

// Parsed + highlighted diff per resolved repo path + target key, valid while
// the target's head commit is unchanged; a push overwrites on the next open.
// This cache serves pr/branch targets only — worktree targets have no stable
// head to key on and never touch it. The data dir stays 'jdiff' on purpose:
// it is jDiff's review cache, wherever the code lives.
const DIR = join(appDataDir('jdiff'), 'diff-cache')

function fileFor(repo: string, number: string): string {
  const hash = createHash('sha1').update(`${repo}\n${number}`).digest('hex')
  return join(DIR, `${hash}.json`)
}

export function loadDiff(repo: string, number: string, headOid: string): CachedDiff | null {
  try {
    const cached: CachedDiff = JSON.parse(readFileSync(fileFor(repo, number), 'utf8'))
    return cached.headOid === headOid ? cached : null
  } catch {
    return null
  }
}

export function saveDiff(repo: string, number: string, entry: CachedDiff): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(fileFor(repo, number), JSON.stringify(entry))
}
