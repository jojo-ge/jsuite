import type { Block } from '../../types'

/**
 * Client twin of the server's labelForBlock — the server one lives in a module
 * that touches the filesystem, so it can't be imported into the browser bundle.
 */
export function labelForBlock(b: Block, index: number): string {
  const trim = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  switch (b.type) {
    case 'prose': {
      const first = (b.md || '').trim().split('\n')[0]?.replace(/^#+\s*/, '') ?? ''
      return trim(first || `Prose #${index + 1}`)
    }
    case 'callout':
      return trim(b.title || `Callout #${index + 1}`)
    case 'code':
      return trim(b.file || `Code #${index + 1}`)
    case 'diff':
      return trim(b.file || `Diff #${index + 1}`)
    case 'chart':
      return trim(b.title || b.chartKey)
    case 'steps':
      return trim(b.title || `Steps #${index + 1}`)
    case 'compare':
      return trim(b.title || `Comparison #${index + 1}`)
    case 'timeline':
      return trim(b.title || `Timeline #${index + 1}`)
    case 'takeaway':
      return trim(b.title || 'Key takeaways')
    default:
      return `Block #${index + 1}`
  }
}
