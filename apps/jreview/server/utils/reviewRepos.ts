import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { appDataFile } from '@jsuite/data'
import type { KnownRepo } from '../../app/utils/reviewTypes'

// Codebases the human has reviewed before, most recent first, in
// .data/jreview/repos.json. The picker also offers the repos jTicket already
// knows (best-effort — jTicket being down just means a shorter list).
const REPOS_FILE = appDataFile('jreview', 'repos.json')

interface RepoRow {
  path: string
  lastUsedAt: string
}

async function readRows(): Promise<RepoRow[]> {
  if (!existsSync(REPOS_FILE)) return []
  try {
    const rows = JSON.parse(await readFile(REPOS_FILE, 'utf8'))
    return Array.isArray(rows) ? rows.filter((r) => typeof r?.path === 'string') : []
  } catch {
    return []
  }
}

export async function rememberReviewRepo(path: string): Promise<void> {
  const rows = (await readRows()).filter((r) => r.path !== path)
  rows.unshift({ path, lastUsedAt: new Date().toISOString() })
  await writeFile(REPOS_FILE, JSON.stringify(rows.slice(0, 50), null, 2) + '\n', 'utf8')
}

export async function forgetReviewRepo(path: string): Promise<void> {
  const rows = (await readRows()).filter((r) => r.path !== path)
  await writeFile(REPOS_FILE, JSON.stringify(rows, null, 2) + '\n', 'utf8')
}

const isRepo = (path: string) => existsSync(join(path, '.git'))

export async function knownRepos(): Promise<KnownRepo[]> {
  const out = new Map<string, KnownRepo>()
  for (const r of await readRows()) {
    if (isRepo(r.path)) out.set(r.path, { path: r.path, name: basename(r.path), lastUsedAt: r.lastUsedAt })
  }
  try {
    const { repos } = await jticketCall<{ repos: { path: string; exists: boolean; lastUsedAt?: string }[] }>('/api/repos')
    for (const r of repos ?? []) {
      if (!r.exists || out.has(r.path) || !isRepo(r.path)) continue
      out.set(r.path, { path: r.path, name: basename(r.path), lastUsedAt: null })
    }
  } catch {
    // jTicket down — jReview's own history is enough.
  }
  return [...out.values()]
}
