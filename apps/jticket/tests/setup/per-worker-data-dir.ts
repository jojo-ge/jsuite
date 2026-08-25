import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Vitest runs test files in parallel workers, and the store modules resolve
// their data root through @jsuite/data — so a single shared JSUITE_DATA_DIR
// lets one file's fixtures collide with another's (TICK-305). Scope the root
// per worker instead: VITEST_POOL_ID is unique among concurrently-running
// workers, and files inside one worker run sequentially. This runs as a
// setupFile, before the test module (and the stores it imports) load.
process.env.JSUITE_DATA_DIR = join(
  tmpdir(),
  'jticket-vitest-data',
  `w${process.env.VITEST_POOL_ID ?? '0'}`,
)
