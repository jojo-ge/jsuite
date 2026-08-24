import type { LocalRelay } from '@jsuite/relay'
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

/** Mint a room on the local relay → { roomId, secret }. */
export async function createRoom(relay: LocalRelay): Promise<{ roomId: string; secret: string }> {
  const res = await fetch(new URL('/rooms', relay.url), { method: 'POST' })
  if (!res.ok) throw new Error(`room creation failed: ${res.status}`)
  return res.json()
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

/** Open a raw member socket into a relay room (to occupy a slot in tests). */
export async function openSocket(relay: LocalRelay, roomId: string, secret: string): Promise<WebSocket> {
  const url = new URL(`/rooms/${roomId}/ws`, relay.url)
  url.protocol = 'ws:'
  url.searchParams.set('secret', secret)
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('socket failed to open')), { once: true })
  })
  return ws
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
