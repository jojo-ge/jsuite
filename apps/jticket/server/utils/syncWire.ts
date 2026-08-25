// The pull flow's wire protocol (TICK-294, spec DOC-30): what actually
// travels over the data channel. Typed JSON frames, one per message; a
// snapshot is split into bounded chunks because libdatachannel messages have
// a size ceiling and a whole board's JSON can pass it. Pure — no networking,
// no clock — so framing and reassembly are unit-testable.

export type PullWireMessage =
  // The serving side's hello, sent once its message handler is attached. The
  // importer sends nothing before seeing it: the receiving side of a fresh
  // channel can miss messages that arrive before onDataChannel has run, and
  // this direction cannot race (the initiator attaches handlers in dial()).
  | { v: 1; kind: 'serve-ready' }
  | { v: 1; kind: 'pull-request'; requestId: string; projectUuid: string }
  | { v: 1; kind: 'pull-denied'; requestId: string }
  | { v: 1; kind: 'pull-refused'; requestId: string; reason: string }
  | { v: 1; kind: 'pull-expired'; requestId: string }
  | { v: 1; kind: 'snapshot-chunk'; requestId: string; seq: number; total: number; data: string }

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
  const m = parsed as Partial<SnapshotChunk> & { kind?: string; reason?: string; projectUuid?: string }
  if (!m || typeof m !== 'object' || m.v !== 1) return null
  if (m.kind === 'serve-ready') return { v: 1, kind: 'serve-ready' }
  if (typeof m.requestId !== 'string' || !m.requestId) return null
  switch (m.kind) {
    case 'pull-request':
      if (typeof m.projectUuid !== 'string' || !m.projectUuid) return null
      return { v: 1, kind: 'pull-request', requestId: m.requestId, projectUuid: m.projectUuid }
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

// Chunk size in JSON-string characters. Worst-case UTF-8 expansion keeps a
// frame safely under the 64KB floor every libdatachannel peer accepts.
export const SNAPSHOT_CHUNK_CHARS = 16_000

/** Split a snapshot's JSON into ready-to-send chunk frames. */
export function snapshotFrames(requestId: string, snapshotJson: string, chunkChars = SNAPSHOT_CHUNK_CHARS): string[] {
  const total = Math.max(1, Math.ceil(snapshotJson.length / chunkChars))
  const frames: string[] = []
  for (let seq = 0; seq < total; seq++) {
    frames.push(encodeWireMessage({
      v: 1,
      kind: 'snapshot-chunk',
      requestId,
      seq,
      total,
      data: snapshotJson.slice(seq * chunkChars, (seq + 1) * chunkChars),
    }))
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
