import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'

// Draft review comments left on a LOCAL branch before any PR exists. They live
// only on this machine (under ~/.jdiff), keyed by repo path + branch name, and
// are meant to be flushed onto the PR all at once when the branch is opened as
// a pull request (see branch-create-pr.post.ts).
export interface BranchComment {
  id: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
  createdAt: string
}

const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'branch-comments.json')

interface Row extends BranchComment {
  repo: string
  branch: string
}

function loadAll(): Row[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}

function writeAll(rows: Row[]): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(rows, null, 2))
}

export function loadBranchComments(repo: string, branch: string): BranchComment[] {
  return loadAll()
    .filter((r) => r.repo === repo && r.branch === branch)
    .map(({ repo: _r, branch: _b, ...c }) => c)
}

export function addBranchComment(
  repo: string,
  branch: string,
  c: Omit<BranchComment, 'id' | 'createdAt'> & { id: string; createdAt: string },
): BranchComment {
  const row: Row = { repo, branch, ...c }
  writeAll([...loadAll(), row])
  const { repo: _r, branch: _b, ...saved } = row
  return saved
}

export function deleteBranchComment(repo: string, branch: string, id: string): void {
  writeAll(loadAll().filter((r) => !(r.repo === repo && r.branch === branch && r.id === id)))
}

export function clearBranchComments(repo: string, branch: string): void {
  writeAll(loadAll().filter((r) => !(r.repo === repo && r.branch === branch)))
}
