import type { HighlighterCore } from 'shiki'

// One highlighter for the whole app, created lazily on the client — SSR renders
// plain <pre> fallbacks and the tokens hydrate in.
let highlighterPromise: Promise<HighlighterCore> | null = null

const PRELOADED = [
  'typescript', 'javascript', 'vue', 'json', 'bash', 'python', 'html', 'css',
  'yaml', 'markdown', 'sql', 'diff',
]

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
}

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: PRELOADED,
      }),
    )
  }
  return highlighterPromise
}

export interface TokenLine {
  tokens: { content: string; color?: string }[]
}

/**
 * Tokenise code for the current color mode. Unknown languages are loaded on
 * demand; failures fall back to unstyled single-token lines so the block still
 * renders.
 */
export function useShiki() {
  const colorMode = useColorMode()
  const theme = computed(() => (colorMode.value === 'light' ? 'github-light' : 'github-dark'))

  async function tokenise(code: string, lang?: string): Promise<TokenLine[]> {
    const clean = code.replace(/\n$/, '')
    const plain = () => clean.split('\n').map((l) => ({ tokens: [{ content: l }] }))
    if (!import.meta.client) return plain()
    try {
      const hl = await getHighlighter()
      let language = ALIASES[lang || ''] || lang || 'text'
      if (language !== 'text' && !hl.getLoadedLanguages().includes(language)) {
        try {
          await hl.loadLanguage(language as never)
        } catch {
          language = 'text'
        }
      }
      const result = hl.codeToTokens(clean, { lang: language as never, theme: theme.value })
      return result.tokens.map((line) => ({
        tokens: line.map((t) => ({ content: t.content, color: t.color })),
      }))
    } catch {
      return plain()
    }
  }

  return { tokenise, theme }
}
