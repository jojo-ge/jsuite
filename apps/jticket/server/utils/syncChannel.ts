import { roomKey, openFrame, sealFrame } from './syncCrypto'
import type { SyncRelayConfig } from './syncConfig'
import { syncRelayConfig } from './syncConfig'
import type { SyncTransport } from './syncTransport'
import { createLocalTransport, createSupabaseTransport } from './syncTransport'
import type { PullWireMessage } from './syncWire'
import { encodeWireMessage, parseWireMessage } from './syncWire'

// jTicket's end of a sync connection — the module that replaced the WebRTC
// peer manager (TICK-3xx).
//
// A channel is one share room: join it with the room's id and secret, and you
// get typed wire messages in and out. Everything underneath — which relay,
// how frames are sealed, how the topic is named — is this module's business.
// Lives in the Nuxt server process, no browser tab involved; framework-free so
// tests can drive two managers in one process against a local relay.
//
// What is gone, compared with the peer manager: ICE, the SDP handshake and its
// timeout, the initiator/responder split, the redial-on-failure ladder, and
// the "room full" race. A broadcast topic has no handshake to lose, so joining
// either works or reports why.

export type ChannelState = 'joining' | 'joined' | 'closed' | 'failed'

export interface JoinOptions {
  roomId: string
  roomSecret: string
  /** Fires once when the topic is live. */
  onJoined?: () => void
  /** Every readable message from the other side, in arrival order. */
  onMessage?: (message: PullWireMessage) => void
  /** Fires once when the channel ends — closed by us, or failed. */
  onClose?: () => void
}

export interface ChannelStatus {
  id: string
  state: ChannelState
  /** Why the channel failed ('' unless state is 'failed'). */
  reason: string
}

export interface ChannelManager {
  /** Join a room; returns immediately. Progress is polled via get(). */
  join(options: JoinOptions): { id: string }
  get(id: string): ChannelStatus | undefined
  /** Send over the channel. Rejects if it isn't joined. */
  send(id: string, message: PullWireMessage): Promise<void>
  close(id: string): void
  closeAll(): void
}

/**
 * The broadcast topic a room maps to. The room id is 96 random bits and never
 * leaves the link fragment, so the topic name is itself unguessable — but
 * nothing rests on that, because the frames inside are sealed.
 */
export function roomTopic(roomId: string): string {
  return `jticket-sync-${roomId}`
}

interface Channel {
  id: string
  state: ChannelState
  reason: string
  key: Buffer
  topic: { send(sealed: string): Promise<void>; leave(): void }
  onClose?: () => void
  closeNotified: boolean
  /** onJoined fires once per channel, not once per underlying re-subscribe. */
  joinNotified: boolean
}

let nextId = 1

export function createChannelManager(config: SyncRelayConfig): ChannelManager {
  const transport: SyncTransport = config.kind === 'supabase'
    ? createSupabaseTransport(config.url, config.key)
    : createLocalTransport(config.url)
  const channels = new Map<string, Channel>()

  function notifyClose(channel: Channel) {
    if (channel.closeNotified) return
    channel.closeNotified = true
    try {
      channel.onClose?.()
    } catch {}
  }

  function join(options: JoinOptions): { id: string } {
    const id = `chan_${nextId++}`
    const { roomId, roomSecret, onJoined, onMessage, onClose } = options
    const key = roomKey(roomSecret)

    const channel: Channel = {
      id,
      state: 'joining',
      reason: '',
      key,
      topic: { async send() {}, leave() {} }, // replaced below, once join() returns
      onClose,
      closeNotified: false,
      joinNotified: false,
    }
    channels.set(id, channel)

    channel.topic = transport.join(roomTopic(roomId), {
      onJoined() {
        if (channel.state === 'closed' || channel.state === 'failed') return
        const first = channel.state === 'joining' && !channel.joinNotified
        channel.state = 'joined'
        if (!first) return // a reconnect re-subscribing; the caller already knows
        channel.joinNotified = true
        try {
          onJoined?.()
        } catch {}
      },
      onFrame(sealed) {
        // Unreadable frames are dropped without a word. On a public topic the
        // only frames we can read are ones sealed with this room's secret, so
        // anything else is a stranger's noise or a forgery — not an error and
        // not something to surface.
        const plaintext = openFrame(channel.key, sealed)
        if (plaintext === null) return
        const message = parseWireMessage(plaintext)
        if (!message) return
        try {
          onMessage?.(message)
        } catch {}
      },
      onError(reason) {
        if (channel.state === 'closed' || channel.state === 'failed') return
        // An error before the topic ever came up is fatal — wrong URL, dead
        // relay, bad key. One after it was live is a dropped connection, which
        // realtime-js is already retrying; drop back to 'joining' and let it,
        // bounded by whatever timeout the caller is running anyway.
        if (channel.state === 'joined') {
          channel.state = 'joining'
          channel.reason = reason
          return
        }
        channel.state = 'failed'
        channel.reason = reason
        try {
          channel.topic.leave()
        } catch {}
        notifyClose(channel)
      },
    })

    return { id }
  }

  function mustGet(id: string): Channel {
    const channel = channels.get(id)
    if (!channel) throw new Error(`unknown channel: ${id}`)
    return channel
  }

  return {
    join,
    get(id) {
      const channel = channels.get(id)
      if (!channel) return undefined
      return { id, state: channel.state, reason: channel.reason }
    },
    async send(id, message) {
      const channel = mustGet(id)
      if (channel.state !== 'joined') {
        throw new Error(`channel ${id} is not joined (state: ${channel.state})`)
      }
      await channel.topic.send(sealFrame(channel.key, encodeWireMessage(message)))
    },
    close(id) {
      const channel = mustGet(id)
      if (channel.state !== 'failed') channel.state = 'closed'
      try {
        channel.topic.leave()
      } catch {}
      notifyClose(channel)
    },
    closeAll() {
      for (const channel of channels.values()) {
        if (channel.state !== 'failed') channel.state = 'closed'
        try {
          channel.topic.leave()
        } catch {}
        notifyClose(channel)
      }
      transport.dispose()
    },
  }
}

/**
 * The server process's one manager, shared by every sync route. Null when the
 * machine has no relay configured — callers refuse the operation rather than
 * pretend. Rebuilt when the configured relay changes, so a wizard run lands
 * without a restart (syncRelayConfig re-reads the file every call).
 */
let managerSingleton: ChannelManager | undefined
let managerKey = ''

export function useChannelManager(): ChannelManager | null {
  const config = syncRelayConfig()
  if (!config) return null
  const key = JSON.stringify(config)
  if (!managerSingleton || managerKey !== key) {
    managerSingleton?.closeAll()
    managerSingleton = createChannelManager(config)
    managerKey = key
  }
  return managerSingleton
}
