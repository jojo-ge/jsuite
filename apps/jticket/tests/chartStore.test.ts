import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blankChart, chartFilePath, readChart, writeChart, writeNotes, readNotes } from '../../../packages/charting/server/utils/store'

// The chart editor autosaves the canvas and the title from separate timers, so
// two saves of one chart can overlap. With plain writeFile a shorter save
// finishing inside a longer one left valid JSON followed by the longer file's
// tail — unparseable, so the chart 404ed (16 charts were lost that way). Saves
// go through a temp file and a rename now: whichever lands last, lands whole.
describe('chart store writes', () => {
  const scene = (n: number) => ({ elements: Array.from({ length: n }, (_, i) => ({ id: `el-${i}`, text: 'x'.repeat(200) })), appState: {}, files: {} })

  it('overlapping saves of different sizes leave a chart that still parses', async () => {
    const key = 'overlap-chart'
    const big = { ...blankChart({ key, title: 'big' }), scene: scene(400) }
    const small = { ...blankChart({ key, title: 'small' }), scene: scene(2) }
    for (let round = 0; round < 10; round++) {
      await Promise.all([writeChart(key, big), writeChart(key, small), writeChart(key, big), writeChart(key, small)])
      const read = await readChart(key)
      expect(read, `round ${round}`).not.toBeNull()
      expect(['big', 'small']).toContain(read!.title)
      expect(read!.scene.elements.length).toBe(read!.title === 'big' ? 400 : 2)
    }
  })

  it('leaves no temp files behind, and notes round-trip the same way', async () => {
    const key = 'notes-chart'
    await writeChart(key, blankChart({ key, title: 'n' }))
    await Promise.all([
      writeNotes(key, { general: 'g'.repeat(5000), notes: [] }),
      writeNotes(key, { general: 'short', notes: [] }),
    ])
    expect(['short', 'g'.repeat(5000)]).toContain((await readNotes(key)).general)
    expect(readdirSync(dirname(chartFilePath(key))).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
