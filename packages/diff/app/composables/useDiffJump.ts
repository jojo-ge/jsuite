// Land the reader on one line of a rendered diff. DiffFile marks every hunk
// cell with data-ln="SIDE:line", scoped to its own file section, so a comment
// (or anything else holding a path + side + line) can point straight at it.
//
// Falls back to the top of the file when the line isn't rendered — the file
// may be collapsed, or in full-file mode, and arriving at the right file
// still beats not moving.
export function jumpToDiffLine(
  anchor: string,
  side: 'LEFT' | 'RIGHT',
  line: number,
  flashMs = 1600,
): boolean {
  const section = document.getElementById(anchor)
  if (!section) return false
  const cells = section.querySelectorAll<HTMLElement>(`[data-ln="${side}:${line}"]`)
  if (!cells.length) {
    section.scrollIntoView({ block: 'start' })
    return false
  }
  cells[0]!.scrollIntoView({ block: 'center', behavior: 'smooth' })
  for (const el of cells) {
    el.classList.add('hit')
    setTimeout(() => el.classList.remove('hit'), flashMs)
  }
  return true
}
