/**
 * Collapse markdown to a one-line plain-text blurb for cards and previews:
 * code fences become " [code] ", links reduce to their text, emphasis markers
 * drop, and all whitespace collapses to single spaces.
 */
export function markdownPreview(md: string | undefined | null): string {
  if (!md?.trim()) return ''
  return md
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-+*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^[-+*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}
