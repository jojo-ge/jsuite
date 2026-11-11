// The Diff tab's row shapes — what server/utils/diffBuild.ts builds from a
// raw `git diff` and the viewer (ProjectDiff.vue, DiffFileView.vue) renders.

export interface DiffCell {
  num: number | null
  type: 'ctx' | 'add' | 'del' | 'empty'
  /** Highlighted, escaped HTML (server/utils/diffHighlight.ts); '' for an empty cell. */
  html: string
}
export interface DiffRow {
  left: DiffCell
  right: DiffCell
}
export interface DiffHunk {
  /** The `@@ -a,b +c,d @@ …` line — the viewer maps gap line numbers from it. */
  header: string
  rows: DiffRow[]
}
export interface DiffFile {
  path: string
  /** Only set for a rename. */
  oldPath: string | null
  status: 'added' | 'deleted' | 'renamed' | 'modified'
  additions: number
  deletions: number
  binary: boolean
  hunks: DiffHunk[]
}
