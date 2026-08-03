// First-run seeder: an empty `.data/jrig/documents/` gets house + hoodie and
// the 10 built-in clips, regenerated from the TS sources through migrate.ts.
// Never overwrites — any existing document means the pool is live and owned by
// the user/studio/Claude, not by us.

import { buildSeedDocuments } from '../../rig/migrate';

export default defineNitroPlugin(async () => {
  const existing = await listRigDocuments();
  if (existing.length > 0) {
    return;
  }
  const seeds = buildSeedDocuments();
  for (const { name, content } of seeds) {
    await writeRigDocument(name, content);
  }
  console.log(`[jrig] seeded ${seeds.length} documents into .data/jrig/documents/`);
});
