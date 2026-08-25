import { randomBytes } from 'node:crypto'
import type { Instance } from './harness/instance'

/** Raw HTTP call against a harness instance → { status, body } — for asserting refusals. */
export async function api(instance: Instance, method: string, path: string, body?: unknown) {
  const res = await fetch(`${instance.url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

/** Like api, but throws on any 4xx/5xx — for steps that must succeed. */
export async function ok(instance: Instance, method: string, path: string, body?: unknown) {
  const res = await api(instance, method, path, body)
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(res.body)}`)
  return res.body
}

/**
 * A fresh room — the same shape shares.ts mints. Nothing registers it
 * anywhere: since sync moved to broadcast topics a room is just a name plus
 * the secret that seals its frames, so minting one is pure local randomness.
 */
export function newRoom(): { roomId: string; secret: string } {
  return { roomId: randomBytes(12).toString('base64url'), secret: randomBytes(24).toString('base64url') }
}

/**
 * Poll until the predicate holds for whatever getStatus returns; throws on
 * timeout. Shared by the in-process tests (getStatus reads a manager) and the
 * two-instance harness (getStatus hits an instance's HTTP API).
 */
export async function waitFor<S>(
  getStatus: () => S | undefined | Promise<S | undefined>,
  predicate: (status: S) => boolean,
  { timeoutMs = 15_000, intervalMs = 50, label = 'condition' } = {},
): Promise<S> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await getStatus()
    if (status !== undefined && predicate(status)) return status
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}; last status: ${JSON.stringify(status)}`)
    }
    await sleep(intervalMs)
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
