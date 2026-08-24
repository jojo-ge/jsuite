import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_CHUNK_CHARS,
  SnapshotAssembler,
  encodeWireMessage,
  parseWireMessage,
  snapshotFrames,
  type PullWireMessage,
} from './syncWire'

// The pull flow's wire protocol (TICK-294): typed JSON frames over the data
// channel, with snapshots split into bounded chunks — libdatachannel messages
// have a size ceiling, and JSON.stringify of a whole board can pass it.

describe('wire messages', () => {
  it('round-trips every message kind', () => {
    const messages: PullWireMessage[] = [
      { v: 1, kind: 'serve-ready' },
      { v: 1, kind: 'pull-request', requestId: 'pull_1', projectUuid: 'uuid-1' },
      { v: 1, kind: 'pull-denied', requestId: 'pull_1' },
      { v: 1, kind: 'pull-refused', requestId: 'pull_1', reason: 'share revoked' },
      { v: 1, kind: 'pull-expired', requestId: 'pull_1' },
      { v: 1, kind: 'snapshot-chunk', requestId: 'pull_1', seq: 0, total: 2, data: '{"half":' },
    ]
    for (const m of messages) {
      expect(parseWireMessage(encodeWireMessage(m))).toEqual(m)
    }
  })

  it('returns null for junk, unknown kinds, and shape violations', () => {
    expect(parseWireMessage('not json')).toBeNull()
    expect(parseWireMessage('42')).toBeNull()
    expect(parseWireMessage(JSON.stringify({ v: 1, kind: 'mystery', requestId: 'x' }))).toBeNull()
    expect(parseWireMessage(JSON.stringify({ v: 2, kind: 'pull-request', requestId: 'x', projectUuid: 'u' }))).toBeNull()
    expect(parseWireMessage(JSON.stringify({ v: 1, kind: 'pull-request', projectUuid: 'u' }))).toBeNull()
    expect(parseWireMessage(JSON.stringify({ v: 1, kind: 'snapshot-chunk', requestId: 'x', seq: 'a', total: 1, data: '' }))).toBeNull()
  })
})

describe('snapshot chunking', () => {
  it('splits a snapshot into bounded frames and reassembles it exactly', () => {
    const json = JSON.stringify({ blob: 'x'.repeat(SNAPSHOT_CHUNK_CHARS * 2 + 137), note: 'π ≠ "quoted"' })
    const frames = snapshotFrames('pull_9', json)
    expect(frames.length).toBeGreaterThan(2)

    const assembler = new SnapshotAssembler('pull_9')
    let complete = false
    for (const frame of frames) {
      const msg = parseWireMessage(frame)
      expect(msg?.kind).toBe('snapshot-chunk')
      if (msg?.kind === 'snapshot-chunk') complete = assembler.add(msg)
    }
    expect(complete).toBe(true)
    expect(assembler.json()).toBe(json)
  })

  it('a small snapshot travels as a single frame', () => {
    const json = JSON.stringify({ tiny: true })
    const frames = snapshotFrames('pull_2', json)
    expect(frames).toHaveLength(1)
    const assembler = new SnapshotAssembler('pull_2')
    const msg = parseWireMessage(frames[0]!)
    expect(msg?.kind === 'snapshot-chunk' && assembler.add(msg)).toBe(true)
    expect(assembler.json()).toBe(json)
  })

  it('reassembles frames arriving out of order and ignores other requests', () => {
    const json = JSON.stringify({ blob: 'y'.repeat(SNAPSHOT_CHUNK_CHARS + 10) })
    const frames = snapshotFrames('pull_3', json)
    const stray = snapshotFrames('pull_other', JSON.stringify({ nope: 1 }))

    const assembler = new SnapshotAssembler('pull_3')
    const parsed = [...stray, ...frames]
      .map((f) => parseWireMessage(f))
      .filter((m): m is Extract<PullWireMessage, { kind: 'snapshot-chunk' }> => m?.kind === 'snapshot-chunk')
      .reverse()
    let complete = false
    for (const msg of parsed) complete = assembler.add(msg) || complete
    expect(complete).toBe(true)
    expect(assembler.json()).toBe(json)
  })
})
