import { afterAll, describe, expect, it } from 'vitest'
import { createChannelManager, type ChannelManager } from '../server/utils/syncChannel'
import type { PullWireMessage } from '../server/utils/syncWire'
import { newRoom, waitFor } from './helpers'

// The one piece the offline suites cannot cover: the Supabase Realtime adapter
// itself. Everything above the transport port is exercised against the local
// broadcast relay; this proves the production adapter really speaks to a real
// project — that a channel subscribes, that a frame crosses, and that the
// sender is not echoed its own.
//
// Skipped unless credentials are in the environment, so it never fails a CI
// run or an offline checkout. To run it against your own project:
//
//   JTICKET_SUPABASE_URL=https://<ref>.supabase.co \
//   JTICKET_SUPABASE_KEY=<publishable key> \
//   npx vitest run test/supabaseTransport.live.test.ts
//
// It creates nothing and leaves nothing behind: broadcast topics are ephemeral
// and the room id is random.

const url = process.env.JTICKET_SUPABASE_URL?.trim() ?? ''
const key = process.env.JTICKET_SUPABASE_KEY?.trim() ?? ''
const configured = !!url && !!key

const managers: ChannelManager[] = []

afterAll(() => {
  for (const m of managers.splice(0)) m.closeAll()
})

function manager(): ChannelManager {
  const m = createChannelManager({ kind: 'supabase', url, key })
  managers.push(m)
  return m
}

const request = (requestId: string): PullWireMessage =>
  ({ v: 1, kind: 'pull-request', requestId, projectUuid: 'live-check' })

describe.skipIf(!configured)('supabase transport (live)', () => {
  it('joins a topic and carries a sealed frame between two members', async () => {
    const room = newRoom()
    const [a, b] = [manager(), manager()]
    const seenByA: PullWireMessage[] = []
    const seenByB: PullWireMessage[] = []
    const idA = a.join({ roomId: room.roomId, roomSecret: room.secret, onMessage: (m) => seenByA.push(m) }).id
    const idB = b.join({ roomId: room.roomId, roomSecret: room.secret, onMessage: (m) => seenByB.push(m) }).id

    const settled = await waitFor(
      () => {
        const [sa, sb] = [a.get(idA), b.get(idB)]
        if (sa?.state === 'failed') return sa
        if (sb?.state === 'failed') return sb
        return sa?.state === 'joined' && sb?.state === 'joined' ? sa : undefined
      },
      (s) => s.state === 'joined' || s.state === 'failed',
      { label: 'both channels to reach the project', timeoutMs: 30_000, intervalMs: 250 },
    )
    // A failure here is a configuration problem, not a flake — say which.
    expect(settled.state, `channel failed: ${settled.reason}`).toBe('joined')

    await a.send(idA, request('live-1'))

    await waitFor(() => (seenByB.length ? seenByB : undefined), (m) => m.length > 0, {
      label: 'the frame to cross Supabase',
      timeoutMs: 30_000,
      intervalMs: 250,
    })
    expect(seenByB[0]).toEqual(request('live-1'))
    expect(seenByA).toEqual([]) // self:false, as the pull protocol requires
  }, 60_000)
})

describe.skipIf(configured)('supabase transport (live)', () => {
  it.skip('needs JTICKET_SUPABASE_URL and JTICKET_SUPABASE_KEY to run', () => {})
})
