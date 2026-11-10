// What a session's tokens cost. Rates are $ per million tokens, per model,
// seeded from Anthropic's first-party API prices and kept in
// .data/jticket/pricing.json so a price change is an edit, not a release.
// Cache writes bill at 1.25× input (5-minute TTL) and 2× (1-hour TTL); cache
// reads at the model's own read rate. An unknown model prices at zero and is
// flagged, never guessed.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { appDataFile } from '@jsuite/data'
import type { TranscriptUsage } from './transcripts'

export interface ModelPrice {
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  output: number
}
export type PriceTable = Record<string, ModelPrice>

const price = (input: number, output: number, cacheRead: number): ModelPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
})

/** Seed rates (first-party API, 2026-10). Keys match by exact id, then longest prefix. */
export const DEFAULT_PRICES: PriceTable = {
  'claude-fable-5-2': price(10, 50, 0.25),
  'claude-fable-5-1': price(10, 50, 0.25),
  'claude-fable-5': price(10, 50, 0.25),
  'claude-mythos-5-1': price(10, 50, 0.25),
  'claude-opus-5-5': price(4, 20, 0.2),
  'claude-opus-5': price(5, 25, 0.5),
  'claude-opus-4-8': price(5, 25, 0.5),
  'claude-opus-4-7': price(5, 25, 0.5),
  'claude-opus-4-6': price(5, 25, 0.5),
  'claude-sonnet-5-5': price(2, 10, 0.2),
  'claude-sonnet-5': price(2, 10, 0.2),
  'claude-sonnet-4-6': price(3, 15, 0.3),
  'claude-haiku-5-5': price(0.1, 0.5, 0.01),
  'claude-haiku-4-5': price(1, 5, 0.1),
}

export const PRICING_FILE = appDataFile('jticket', 'pricing.json')

let loaded: { mtimeMs: number; table: PriceTable } | null = null

/**
 * The price table: the file's rates over the defaults. Written out with the
 * defaults on first use so there is something to edit. Re-read when the file
 * changes.
 */
export function loadPrices(): PriceTable {
  if (!existsSync(PRICING_FILE)) {
    try {
      mkdirSync(dirname(PRICING_FILE), { recursive: true })
      writeFileSync(PRICING_FILE, JSON.stringify({ unit: 'USD per million tokens', models: DEFAULT_PRICES }, null, 2) + '\n', 'utf8')
    } catch {
      /* read-only data dir: defaults still apply */
    }
    return { ...DEFAULT_PRICES }
  }
  try {
    const mtimeMs = statSync(PRICING_FILE).mtimeMs
    if (loaded && loaded.mtimeMs === mtimeMs) return loaded.table
    const parsed = JSON.parse(readFileSync(PRICING_FILE, 'utf8')) as { models?: Record<string, Partial<ModelPrice>> }
    const table: PriceTable = { ...DEFAULT_PRICES }
    for (const [model, p] of Object.entries(parsed.models ?? {})) {
      const base = table[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
      const input = num(p.input, base.input)
      table[model] = {
        input,
        output: num(p.output, base.output),
        cacheRead: num(p.cacheRead, base.cacheRead),
        cacheWrite5m: num(p.cacheWrite5m, table[model] ? base.cacheWrite5m : input * 1.25),
        cacheWrite1h: num(p.cacheWrite1h, table[model] ? base.cacheWrite1h : input * 2),
      }
    }
    loaded = { mtimeMs, table }
    return table
  } catch {
    return { ...DEFAULT_PRICES }
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

/** The rate for a model id: exact, else the longest key the id starts with (dated ids, `[1m]` suffixes). */
export function priceFor(model: string, table: PriceTable = DEFAULT_PRICES): ModelPrice | null {
  if (!model) return null
  if (table[model]) return table[model]!
  const id = model.toLowerCase()
  let best: string | null = null
  for (const key of Object.keys(table)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key
  }
  return best ? table[best]! : null
}

export interface PricedUsage {
  usd: number
  /** False when the model had no rate — usd is then 0, not an estimate. */
  priced: boolean
}

/** Dollars for one model's usage line. */
export function priceUsage(u: TranscriptUsage, table: PriceTable = DEFAULT_PRICES): PricedUsage {
  const p = priceFor(u.model, table)
  if (!p) return { usd: 0, priced: false }
  const M = 1_000_000
  const usd =
    (u.input * p.input + u.cacheWrite5m * p.cacheWrite5m + u.cacheWrite1h * p.cacheWrite1h + u.cacheWriteOther * p.cacheWrite5m + u.cacheRead * p.cacheRead + u.output * p.output) / M
  return { usd, priced: true }
}
