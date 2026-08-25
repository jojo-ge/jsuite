// The pull flow's wire protocol (TICK-294, spec DOC-30): what actually
// travels over the relay, inside the seal. Typed JSON frames, one per
// message; a snapshot is split into bounded chunks because a broadcast
// payload has a size ceiling and a whole board's JSON can pass it. Pure — no
// networking, no clock — so framing and reassembly are unit-testable.

export type PullWireMessage =
  // The importer speaks first and re-sends until acknowledged: on a broadcast
  // topic there is no way to know whether the serving side has joined yet, and
  // a request that lands before it does is simply not delivered. Retrying is
  // the whole synchronisation mechanism, which is why the serving side keys
  // pending requests by requestId and answers a repeat with another ack.
  | { v: 1; kind: 'pull-request'; requestId: string; projectUuid: string }
  // "I have your request and I am asking my human." Turns the importer's
  // spinner from 'dialing' to 'awaiting-approval' and stops the retries.
  | { v: 1; kind: 'pull-received'; requestId: string }
  | { v: 1; kind: 'pull-denied'; requestId: string }
  | { v: 1; kind: 'pull-refused'; requestId: string; reason: string }
  | { v: 1; kind: 'pull-expired'; requestId: string }
  | { v: 1; kind: 'snapshot-chunk'; requestId: string; seq: number; total: number; data: string }
  // Stop-sharing, announced to whoever is listening. The Cloudflare relay used
  // to kill the room out from under both peers; with no room registry to kill,
  // the serving side says so itself on its way out, so a waiting importer
  // fails fast with the real reason instead of timing out.
  | { v: 1; kind: 'room-closed'; reason: string }

export type SnapshotChunk = Extract<PullWireMessage, { kind: 'snapshot-chunk' }>

export function encodeWireMessage(message: PullWireMessage): string {
  return JSON.stringify(message)
}

/** Decode one incoming frame; null for anything that isn't a valid message. */
export function parseWireMessage(raw: string): PullWireMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  // Deliberately loose: the guards below are what turn this into a typed
  // message. Narrowing the cast to one variant's shape (as it once was) made
  // every other kind's case unreachable to the compiler.
  const m = parsed as {
    v?: unknown
    kind?: string
    requestId?: unknown
    reason?: unknown
    projectUuid?: unknown
    seq?: unknown
    total?: unknown
    data?: unknown
  } | null
  if (!m || typeof m !== 'object' || m.v !== 1) return null
  if (m.kind === 'room-closed') {
    return typeof m.reason === 'string' ? { v: 1, kind: 'room-closed', reason: m.reason } : null
  }
  if (typeof m.requestId !== 'string' || !m.requestId) return null
  switch (m.kind) {
    case 'pull-request':
      if (typeof m.projectUuid !== 'string' || !m.projectUuid) return null
      return { v: 1, kind: 'pull-request', requestId: m.requestId, projectUuid: m.projectUuid }
    case 'pull-received':
      return { v: 1, kind: 'pull-received', requestId: m.requestId }
    case 'pull-denied':
      return { v: 1, kind: 'pull-denied', requestId: m.requestId }
    case 'pull-refused':
      if (typeof m.reason !== 'string') return null
      return { v: 1, kind: 'pull-refused', requestId: m.requestId, reason: m.reason }
    case 'pull-expired':
      return { v: 1, kind: 'pull-expired', requestId: m.requestId }
    case 'snapshot-chunk':
      if (
        typeof m.seq !== 'number' || !Number.isInteger(m.seq) || m.seq < 0
        || typeof m.total !== 'number' || !Number.isInteger(m.total) || m.total < 1
        || m.seq >= m.total
        || typeof m.data !== 'string'
      ) return null
      return { v: 1, kind: 'snapshot-chunk', requestId: m.requestId, seq: m.seq, total: m.total, data: m.data }
    default:
      return null
  }
}

// Chunk size in JSON-string characters. The budget is a Supabase broadcast
// payload: 256 KB on the free plan, and a chunk is inflated twice on the way
// there — worst-case UTF-8 expansion, then base64 of the sealed bytes (+33%).
// 96k chars leaves room for both plus the frame's own JSON, and cuts a
// megabyte board from 60-odd frames to 11, which matters against the
// messages-per-second quota.
export const SNAPSHOT_CHUNK_CHARS = 96_000

/** Split a snapshot's JSON into ready-to-send chunk messages. */
export function snapshotFrames(requestId: string, snapshotJson: string, chunkChars = SNAPSHOT_CHUNK_CHARS): SnapshotChunk[] {
  const total = Math.max(1, Math.ceil(snapshotJson.length / chunkChars))
  const frames: SnapshotChunk[] = []
  for (let seq = 0; seq < total; seq++) {
    frames.push({
      v: 1,
      kind: 'snapshot-chunk',
      requestId,
      seq,
      total,
      data: snapshotJson.slice(seq * chunkChars, (seq + 1) * chunkChars),
    })
  }
  return frames
}

/** Collects one request's chunks (any order) back into the snapshot JSON. */
export class SnapshotAssembler {
  private readonly chunks = new Map<number, string>()
  private total: number | null = null

  constructor(private readonly requestId: string) {}

  /** Feed one chunk; returns true once the snapshot is complete. */
  add(chunk: SnapshotChunk): boolean {
    if (chunk.requestId !== this.requestId) return this.complete
    if (this.total === null) this.total = chunk.total
    if (chunk.total === this.total) this.chunks.set(chunk.seq, chunk.data)
    return this.complete
  }

  get complete(): boolean {
    return this.total !== null && this.chunks.size === this.total
  }

  json(): string {
    if (!this.complete) throw new Error('snapshot is not complete')
    return Array.from({ length: this.total! }, (_, seq) => this.chunks.get(seq)!).join('')
  }
}
