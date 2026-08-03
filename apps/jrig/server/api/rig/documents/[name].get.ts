export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') ?? '';
  if (!isRigDocumentName(name)) {
    throw createError({ statusCode: 400, statusMessage: `invalid document name "${name}"` });
  }
  const document = await readRigDocument(name);
  if (!document) {
    throw createError({ statusCode: 404, statusMessage: `no document "${name}"` });
  }
  return document;
});
