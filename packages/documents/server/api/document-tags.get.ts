import { listDocTags } from '../utils/store'

// The tag vocabulary: every tag in use across the pool with how many documents
// carry it, most used first. A writer picks from this list and coins a new tag
// only when none fits. (Not under /api/documents/, where it would shadow a
// document keyed "tags".)
export default defineEventHandler(() => listDocTags())
