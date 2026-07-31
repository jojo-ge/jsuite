import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Wrap the first occurrence of each glossary term in rendered HTML with a
 * hover-definition span. Works on the HTML text segments only — tags and
 * anything inside <code>/<pre>/<a> are left alone — so it can't corrupt markup.
 */
function applyGlossary(html: string, glossary: Record<string, string>): string {
  const terms = Object.entries(glossary)
  if (!terms.length) return html

  // Longest terms first, so "story asset" wins over "story".
  terms.sort((a, b) => b[0].length - a[0].length)
  const done = new Set<string>()

  const parts = html.split(/(<[^>]+>)/)
  let skipDepth = 0 // inside code/pre/a
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.startsWith('<')) {
      if (/^<(code|pre|a)\b/i.test(part)) skipDepth++
      else if (/^<\/(code|pre|a)>/i.test(part)) skipDepth = Math.max(0, skipDepth - 1)
      continue
    }
    if (skipDepth > 0 || !part.trim()) continue
    let text = part
    for (const [term, def] of terms) {
      if (done.has(term)) continue
      const re = new RegExp(`\\b(${escapeRegExp(term)})\\b`, 'i')
      const m = re.exec(text)
      if (!m) continue
      done.add(term)
      text =
        text.slice(0, m.index) +
        `<span class="jx-term" title="${escapeHtml(def)}">${m[1]}</span>` +
        text.slice(m.index + m[0].length)
    }
    parts[i] = text
  }
  return parts.join('')
}

/**
 * Markdown -> HTML with glossary terms marked up. The glossary is provided once
 * per page via provide/inject so every block renders against the same one.
 */
export function useMarkdown() {
  const glossary = inject<Ref<Record<string, string>>>(
    'jx-glossary',
    ref({}),
  )
  function render(md: string | undefined | null): string {
    if (!md?.trim()) return ''
    const html = marked.parse(md) as string
    return applyGlossary(html, glossary.value)
  }
  /** Inline-only rendering (no <p>/block elements) for one-line fields. */
  function renderInline(md: string | undefined | null): string {
    if (!md?.trim()) return ''
    const html = marked.parseInline(md) as string
    return applyGlossary(html, glossary.value)
  }
  return { render, renderInline }
}
