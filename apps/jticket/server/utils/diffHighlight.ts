// Server-side syntax highlighting for the Diff tab. One shiki — the same
// version the documents package highlights code blocks with — tokenises lines
// in BOTH themes at once: each token's light colour is inline `color`, its
// dark colour the `--shiki-dark` variable, which the viewer's CSS swaps in
// under `.dark`. So the rows are built once and follow the colour mode.
import { getSingletonHighlighter } from 'shiki'

export const DIFF_THEMES = { light: 'github-light', dark: 'github-dark' } as const

/** Past this many lines a side is left plain — tokenising it costs more than it reads. */
export const HIGHLIGHT_MAX_LINES = 5000

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  json: 'json', jsonc: 'jsonc', json5: 'json5',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  md: 'markdown', mdx: 'mdx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp',
  hpp: 'cpp', cs: 'csharp', php: 'php',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'docker', tf: 'hcl', prisma: 'prisma', lua: 'lua',
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The shiki language for a path, by basename or extension; undefined → plain text. */
export function langForPath(path: string): string | undefined {
  const base = path.split('/').pop()?.toLowerCase() ?? ''
  if (base === 'dockerfile') return 'docker'
  if (base === 'makefile') return 'make'
  if (!base.includes('.')) return undefined
  return LANG_BY_EXT[base.split('.').pop() ?? '']
}

function styleOf(style: Record<string, string> | string | undefined): string {
  if (!style) return ''
  if (typeof style === 'string') return style
  return Object.entries(style).map(([k, v]) => `${k}:${v}`).join(';')
}

/**
 * Highlight source lines (in file order) for a path: one HTML string per input
 * line. Unknown languages, oversized inputs and highlighter failures fall back
 * to escaped plain text — never an error.
 */
export async function highlightLines(lines: string[], path: string): Promise<string[]> {
  const plain = () => lines.map(escapeHtml)
  const lang = langForPath(path)
  if (!lang || lines.length === 0 || lines.length > HIGHLIGHT_MAX_LINES) return plain()
  try {
    const hl = await getSingletonHighlighter({ themes: [DIFF_THEMES.light, DIFF_THEMES.dark], langs: [] })
    await hl.loadLanguage(lang as any)
    const { tokens } = hl.codeToTokens(lines.join('\n'), { lang: lang as any, themes: DIFF_THEMES })
    const out = tokens.map((line) =>
      line
        .map((t) => {
          const style = styleOf(t.htmlStyle as any)
          return style ? `<span style="${escapeHtml(style)}">${escapeHtml(t.content)}</span>` : escapeHtml(t.content)
        })
        .join(''),
    )
    // A trailing empty line can tokenise to nothing — keep one entry per input line.
    while (out.length < lines.length) out.push('')
    return out.slice(0, lines.length)
  } catch {
    return plain()
  }
}
