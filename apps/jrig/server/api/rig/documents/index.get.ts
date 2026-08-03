// List the document pool. `?content=1` inlines file contents so the client
// registry can hydrate in one round trip.

export default defineEventHandler(async (event) => {
  const withContent = getQuery(event).content === '1';
  const documents = await listRigDocuments();
  if (!withContent) {
    return { documents };
  }
  return {
    documents: await Promise.all(documents.map(async entry => ({
      ...entry,
      content: (await readRigDocument(entry.name))?.content ?? '',
    }))),
  };
});
