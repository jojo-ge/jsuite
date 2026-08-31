import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { ChainSummary } from '../../app/utils/tour'

// The chains manifest for a target: how the change decomposes into distinct
// system chains, produced by the /jdiff-chains scoping session. Saving a new
// manifest starts a new generation — per-chain tours from the old one are
// deleted so the UI never mixes chains from different scoping runs.
export interface SavedChains {
  repo: string
  number: string
  overview: string
  chains: ChainSummary[]
  createdAt: string
}

// Latest manifest per resolved repo path + target; regenerating overwrites.
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'chains.json')

export function loadChains(repo: string, number: string): SavedChains | null {
  return loadAll().find((c) => c.repo === repo && c.number === number) ?? null
}

export function saveChains(entry: SavedChains): void {
  mkdirSync(DIR, { recursive: true })
  const rest = loadAll().filter((c) => !(c.repo === entry.repo && c.number === entry.number))
  writeFileSync(FILE, JSON.stringify([...rest, entry], null, 2))
  deleteChainTours(entry.repo, entry.number)
}

function loadAll(): SavedChains[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
