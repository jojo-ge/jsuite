import { getSingletonHighlighter } from 'shiki'

const THEME = 'github-dark-default'

const langByExt: Record<string, string> = {
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function langForPath(path: string): string | undefined {
  const base = path.split('/').pop()?.toLowerCase() ?? ''
  if (base === 'dockerfile') return 'docker'
  if (base === 'makefile') return 'make'
  const ext = base.split('.').pop() ?? ''
  return langByExt[ext]
}

// Highlights an array of source lines (in file order) for a given path.
// Returns one HTML string per input line. Falls back to escaped plain text.
export async function highlightLines(lines: string[], path: string): Promise<string[]> {
  const plain = () => lines.map(escapeHtml)
  const lang = langForPath(path)
  if (!lang || lines.length === 0 || lines.length > 5000) return plain()
  try {
    const hl = await getSingletonHighlighter({ themes: [THEME], langs: [] })
    await hl.loadLanguage(lang as any)
    const { tokens } = hl.codeToTokens(lines.join('\n'), { lang: lang as any, theme: THEME })
    return tokens.map((lineTokens) =>
      lineTokens
        .map((t) => (t.color ? `<span style="color:${t.color}">${escapeHtml(t.content)}</span>` : escapeHtml(t.content)))
        .join(''),
    )
  } catch {
    return plain()
  }
}
