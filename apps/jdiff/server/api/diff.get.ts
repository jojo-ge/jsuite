import type { FilePayload } from '../utils/buildDiff'

export type { FilePayload } from '../utils/buildDiff'

export default defineEventHandler(async (event): Promise<{ files: FilePayload[] }> => {
  const path = resolveRepoPath(event)
  const target = resolveTarget(event)
  return { files: await diffFilesFor(target, path) }
})
