// Excalidraw lazy-loads its handwriting fonts at runtime. Left alone it fetches
// them from a CDN; we copy them into the consuming app's public/ and the canvas
// points EXCALIDRAW_ASSET_PATH at '/' so it works with no network at all.
//
// Run from a consuming app's postinstall (cwd = the app):
//   node ../../packages/charting/scripts/copy-excalidraw-assets.mjs
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Resolve @excalidraw/excalidraw from THIS package, wherever pnpm put it.
// (It doesn't export ./package.json, so resolve the entry and walk up.)
const require = createRequire(import.meta.url)
let pkgDir = dirname(require.resolve('@excalidraw/excalidraw'))
while (pkgDir !== dirname(pkgDir) && !pkgDir.endsWith(join('@excalidraw', 'excalidraw'))) {
  pkgDir = dirname(pkgDir)
}
const src = join(pkgDir, 'dist', 'prod', 'fonts')
const dest = join(process.cwd(), 'public', 'fonts')

if (!existsSync(src)) {
  console.warn('[charting] excalidraw fonts not found at', src, '— skipping copy')
  process.exit(0)
}

await rm(dest, { recursive: true, force: true })
await mkdir(dirname(dest), { recursive: true })
await cp(src, dest, { recursive: true })
console.log('[charting] copied excalidraw fonts ->', dest)
