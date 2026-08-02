import { extractJson as extractJsonShared } from '@jsuite/claude'

// Lives in @jsuite/claude now (every jSuite app shares one JSON-repair path);
// this shim keeps jDiff's Nitro auto-import working.
export const extractJson = extractJsonShared
