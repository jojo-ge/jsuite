import { Marked } from 'marked'

// Shared sanitized markdown renderer: raw HTML is escaped and javascript:
// links are neutralized, since bodies come from GitHub / claude unsanitized.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    link(token) {
      if (/^\s*javascript:/i.test(token.href)) return escapeHtml(token.text)
      return false
    },
  },
})

export function renderMarkdown(text: string): string {
  return md.parse(text) as string
}
