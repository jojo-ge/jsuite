// Save with an mtime fence. The client sends the mtimeMs it loaded
// (`baseMtimeMs`); if the file changed underneath, 409 with the CURRENT disk
// content so the editor can offer reload/overwrite — no three-way merge.
// `force: true` (the "Overwrite anyway" escalation) skips the fence.
// The body must be valid JSON of the right schema with an id matching the
// filename; the server re-serialises it, so every writer lands the mandated
// 2-space + trailing-newline form regardless of client formatting.

import { CHARACTER_SCHEMA, CLIP_SCHEMA } from '../../../../rig/document';

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') ?? '';
  if (!isRigDocumentName(name)) {
    throw createError({ statusCode: 400, statusMessage: `invalid document name "${name}"` });
  }
  const body = await readBody<{ content?: unknown, baseMtimeMs?: unknown, force?: unknown }>(event);
  if (typeof body?.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'body needs a string `content`' });
  }

  let parsed: { schema?: unknown, id?: unknown };
  try {
    parsed = JSON.parse(body.content) as typeof parsed;
  }
  catch (error) {
    throw createError({ statusCode: 400, statusMessage: `content is not valid JSON: ${(error as Error).message}` });
  }
  const isClip = name.endsWith('.clip.json');
  const expectedSchema = isClip ? CLIP_SCHEMA : CHARACTER_SCHEMA;
  if (parsed?.schema !== expectedSchema) {
    throw createError({ statusCode: 400, statusMessage: `schema must be "${expectedSchema}" for "${name}"` });
  }
  const stem = name.slice(0, name.indexOf('.'));
  if (parsed?.id !== stem) {
    throw createError({ statusCode: 400, statusMessage: `id "${String(parsed?.id)}" must match the filename stem "${stem}"` });
  }

  const existing = await readRigDocument(name);
  if (existing && body.force !== true && existing.mtimeMs !== body.baseMtimeMs) {
    throw createError({
      statusCode: 409,
      statusMessage: 'the file changed underneath this save',
      data: { name, content: existing.content, mtimeMs: existing.mtimeMs },
    });
  }

  const written = await writeRigDocument(name, `${JSON.stringify(parsed, null, 2)}\n`);
  return { name, mtimeMs: written.mtimeMs };
});
