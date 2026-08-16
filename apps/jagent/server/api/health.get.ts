import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

export default defineEventHandler(async () => {
  const [tmux, jticket, gh] = await Promise.all([
    tmuxAvailable(),
    trackerUp(),
    pExecFile('gh', ['--version']).then(() => true).catch(() => false),
  ])
  return { tmux, jticket, gh }
})
