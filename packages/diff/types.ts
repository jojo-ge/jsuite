// Type-only entry for app code (client components, endpoint signatures).
// Server code gets the functions themselves via Nitro layer auto-imports.
export type { Cell, Row, Hunk, FilePayload } from './server/utils/buildDiff'
export type { ParsedTarget, PreparedTarget, WorktreeTarget } from './server/utils/target'
export type { CachedDiff } from './server/utils/diffCache'
