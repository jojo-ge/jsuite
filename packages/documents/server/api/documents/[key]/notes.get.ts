import { readDocNotes } from '../../../utils/store'

export default defineEventHandler((event) => readDocNotes(getRouterParam(event, 'key') || ''))
