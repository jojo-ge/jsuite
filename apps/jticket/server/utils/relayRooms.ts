import type { Share } from './shares'

// The relay half of the share lifecycle. Shares mint their room id + secret
// locally (shares.ts), so the room must be registered on the relay before a
// dial can join — both sides "ensure" it with the share's own credentials.
// The relay refreshes a matching room's expiry, 403s a different secret, and
// 409s a killed room (a re-armed share is a new room, so killed stays dead).

type RelayRoom = Pick<Share, 'roomId' | 'roomSecret' | 'expiresAt'>

/**
 * How long a room registration may take before it counts as a refusal. The
 * presence loop runs one tick at a time (syncServe), so an unbounded POST to
 * an unreachable-but-not-refusing relay would stall serving for every share,
 * not just this one — a timeout keeps the loop turning (TICK-311).
 */
const ENSURE_TIMEOUT_MS = 10_000

/** Register (or expiry-refresh) a share's room. Throws when the relay refuses. */
export async function ensureRelayRoom(relayUrl: string, room: RelayRoom, nowMs: () => number = Date.now): Promise<void> {
  const ttlMs = Date.parse(room.expiresAt) - nowMs()
  if (!(ttlMs > 0)) throw new Error('share link expired')
  const res = await fetch(new URL('/rooms', relayUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId: room.roomId, secret: room.roomSecret, ttlMs }),
    signal: AbortSignal.timeout(ENSURE_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`relay refused the room: ${res.status} ${await res.text()}`)
}

/** Kill a share's room now (stop-sharing). Best effort — never throws. */
export async function killRelayRoom(relayUrl: string, room: Pick<Share, 'roomId' | 'roomSecret'>): Promise<void> {
  try {
    const url = new URL(`/rooms/${room.roomId}`, relayUrl)
    url.searchParams.set('secret', room.roomSecret)
    await fetch(url, { method: 'DELETE' })
  } catch {}
}
