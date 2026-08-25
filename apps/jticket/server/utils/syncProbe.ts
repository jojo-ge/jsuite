import { useChannelManager } from './syncChannel'
import type { ChannelStatus } from './syncChannel'
import type { PullWireMessage } from './syncWire'

// A hand-drivable sync channel, behind /api/sync/channel. Two uses: the
// two-instance test harness proves frames really cross the configured relay
// between two OS processes, and a human debugging a share can watch the same
// thing happen. It is the successor to the old /api/sync/peer routes.
//
// Deliberately not part of the pull flow — nothing here reads or writes the
// board, and a probe channel carries only what its caller sends.

interface Probe {
  id: string
  received: PullWireMessage[]
}

const probes = new Map<string, Probe>()

export class ProbeError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message)
  }
}

function manager() {
  const m = useChannelManager()
  if (!m) throw new ProbeError('no sync relay configured on this machine', 503)
  return m
}

export function openProbe(roomId: string, roomSecret: string): { id: string } {
  const probe: Probe = { id: '', received: [] }
  probe.id = manager().join({
    roomId,
    roomSecret,
    onMessage: (message) => probe.received.push(message),
  }).id
  probes.set(probe.id, probe)
  return { id: probe.id }
}

export function probeStatus(id: string): ChannelStatus & { received: PullWireMessage[] } {
  const probe = probes.get(id)
  const status = manager().get(id)
  if (!probe || !status) throw new ProbeError(`unknown channel: ${id}`, 404)
  return { ...status, received: probe.received }
}

export async function probeSend(id: string, message: PullWireMessage): Promise<void> {
  if (!probes.has(id)) throw new ProbeError(`unknown channel: ${id}`, 404)
  await manager().send(id, message)
}

export function closeProbe(id: string): void {
  if (!probes.has(id)) throw new ProbeError(`unknown channel: ${id}`, 404)
  manager().close(id)
  probes.delete(id)
}
