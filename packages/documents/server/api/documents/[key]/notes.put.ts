import { writeDocNotes, type DocNote, type NoteAttachment } from '../../../utils/store'

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') || ''
  const body = (await readBody(event)) ?? {}
  await writeDocNotes(key, {
    general: typeof body.general === 'string' ? body.general : '',
    notes: Array.isArray(body.notes) ? (body.notes as DocNote[]) : [],
    generalAttachments: Array.isArray(body.generalAttachments)
      ? (body.generalAttachments as NoteAttachment[])
      : [],
  })
  return { ok: true }
})
