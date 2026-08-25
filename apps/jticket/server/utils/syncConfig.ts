import { readFileSync } from 'node:fs'
import { appDataFile } from '@jsuite/data'

// Sync-flow knobs, read from the environment so the two-instance harness can
// shrink every window. Functions, not constants: the harness boots instances
// with per-process env, and tests that tweak process.env want fresh reads.

/**
 * Which relay this machine's sync rides.
 *   supabase — the production transport, from the wizard's
 *              .data/jticket/sync.json or JTICKET_SUPABASE_URL/_KEY.
 *   local    — a plain WebSocket broadcast server (JTICKET_SYNC_RELAY_URL),
 *              which only the tests and the two-instance harness point at.
 */
export type SyncRelayConfig =
  | { kind: 'supabase'; url: string; key: string }
  | { kind: 'local'; url: string }

interface SyncFile {
  supabaseUrl?: unknown
  supabaseKey?: unknown
  /** The Cloudflare-worker field. Present only in files the old wizard wrote. */
  relayUrl?: unknown
}

function readSyncFile(): SyncFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(appDataFile('jticket', 'sync.json'), 'utf8'))
    return (parsed ?? {}) as SyncFile
  } catch {
    return {} // no file, or one too broken to trust — sync is unconfigured
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * The configured relay, or null when sync is unconfigured on this machine.
 * The file is read fresh on every call so a wizard run lands without a
 * restart.
 *
 * A sync.json carrying only the retired `relayUrl` reads as unconfigured: that
 * URL is a signaling-only Cloudflare worker, which the current transport
 * cannot speak to at all. Better an honest "run the wizard" than a pull that
 * dials a dead relay and times out.
 */
export function syncRelayConfig(): SyncRelayConfig | null {
  const localUrl = str(process.env.JTICKET_SYNC_RELAY_URL)
  if (localUrl) return { kind: 'local', url: localUrl }

  const file = readSyncFile()
  const url = str(process.env.JTICKET_SUPABASE_URL) || str(file.supabaseUrl)
  const key = str(process.env.JTICKET_SUPABASE_KEY) || str(file.supabaseKey)
  if (url && key) return { kind: 'supabase', url, key }
  return null
}

/** Whether sync can connect at all — the share panel and pulls both ask. */
export function syncConfigured(): boolean {
  return syncRelayConfig() !== null
}

const intEnv = (name: string, fallback: number): number => {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** How long the serving side holds an unanswered pull request. */
export function pullRequestTtlMs(): number {
  return intEnv('JTICKET_PULL_REQUEST_TTL_MS', 120_000)
}

/** The importer's overall ceiling on one pull attempt. */
export function pullTimeoutMs(): number {
  return intEnv('JTICKET_PULL_TIMEOUT_MS', 180_000)
}

/** Cadence of the serving side's presence loop. */
export function syncTickMs(): number {
  return intEnv('JTICKET_SYNC_TICK_MS', 2_000)
}

/**
 * How long a pull waits for the serving side to acknowledge its request before
 * giving up. Nobody home is the common failure now that there is no room
 * registry to 404 us: the peer's app is closed, or their share is revoked and
 * their channel is gone. Failing here beats spinning out the full pull timeout
 * with nothing to show for it.
 */
export function pullAckTimeoutMs(): number {
  return intEnv('JTICKET_PULL_ACK_TIMEOUT_MS', 25_000)
}

/** How often an unacknowledged pull request is re-sent while it waits. */
export function pullRetryMs(): number {
  return intEnv('JTICKET_PULL_RETRY_MS', 2_000)
}
