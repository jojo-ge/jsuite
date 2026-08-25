// Sync-flow knobs, read from the environment so the two-instance harness can
// shrink every window. Functions, not constants: the harness boots instances
// with per-process env, and tests that tweak process.env want fresh reads.

import { readFileSync } from 'node:fs'
import { appDataFile } from '@jsuite/data'

/**
 * Base URL of the signaling relay; '' = sync is unconfigured on this machine.
 * JTICKET_RELAY_URL wins when non-empty (harness instances, one-off runs);
 * otherwise the deploy wizard's .data/jticket/sync.json `relayUrl`. The file
 * is read fresh on every call so a wizard run lands without a restart.
 */
export function syncRelayUrl(): string {
  const env = process.env.JTICKET_RELAY_URL?.trim()
  if (env) return env
  try {
    const config: unknown = JSON.parse(readFileSync(appDataFile('jticket', 'sync.json'), 'utf8'))
    const url = (config as { relayUrl?: unknown })?.relayUrl
    return typeof url === 'string' ? url.trim() : ''
  } catch {
    return '' // no file, or one too broken to trust — sync is unconfigured
  }
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

/** How long a started WebRTC handshake may take before the dial fails. */
export function handshakeTimeoutMs(): number {
  return intEnv('JTICKET_HANDSHAKE_TIMEOUT_MS', 10_000)
}
