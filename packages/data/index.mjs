// @jsuite/data — one place every app's state lives.
//
// All jSuite apps read and write under `<monorepo root>/.data/<app>/`, which is
// gitignored. Keeping it out of the app directories means data survives an app
// being moved or reinstalled, and one `.data` is the whole suite's state — easy
// to back up, wipe, or point an LLM at.
//
//   import { appDataDir, appDataFile } from '@jsuite/data'
//   const DATA_DIR = appDataDir('jchart')              // <root>/.data/jchart
//   const FILE = appDataFile('jticket', 'jticket.json')
//
// Plain ESM on purpose: Nitro can consume it straight from the workspace with no
// transpile step, unlike a TypeScript source package.

import { mkdirSync, existsSync } from 'node:fs'
import { writeFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Walk up from `start` looking for the workspace marker; null if not found. */
function findRoot(start) {
  let dir = resolve(start)
  for (let i = 0; i < 30; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

let cachedRoot = null

/**
 * The `.data` root. `JSUITE_DATA_DIR` wins when set (./jsuite exports it, which
 * also lets a one-off run point somewhere else). Otherwise find the monorepo
 * root — from this module's own location first, since that holds even when the
 * process was started from an unexpected cwd, with cwd as the fallback for the
 * case where this package got bundled somewhere else.
 */
export function dataRoot() {
  if (process.env.JSUITE_DATA_DIR) return resolve(process.env.JSUITE_DATA_DIR)
  if (cachedRoot) return cachedRoot

  const here = dirname(fileURLToPath(import.meta.url))
  const root = findRoot(here) ?? findRoot(process.cwd())
  if (!root) {
    throw new Error(
      '@jsuite/data: could not locate the jSuite monorepo root (no pnpm-workspace.yaml ' +
        `above ${here} or ${process.cwd()}). Set JSUITE_DATA_DIR to the .data directory.`,
    )
  }
  cachedRoot = join(root, '.data')
  return cachedRoot
}

/** `<root>/.data/<app>`, created if missing. */
export function appDataDir(app) {
  const dir = join(dataRoot(), app)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** A path inside an app's data dir. Parent directories are created. */
export function appDataFile(app, ...parts) {
  const full = join(appDataDir(app), ...parts)
  const parent = dirname(full)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
  return full
}

/**
 * Write a file so a reader never sees it half-written: content goes to a
 * sibling `.tmp`, which is then renamed over the target — atomic within a
 * filesystem.
 *
 * This is not hypothetical caution. Two charts in this workspace were found
 * holding a complete document followed by 344 bytes of tail left over from a
 * longer previous version, which is what a plain in-place `writeFile` does when
 * it loses a race or dies mid-write. A rename either happens or doesn't.
 */
export async function writeTextAtomic(path, text) {
  const parent = dirname(path)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
  const tmp = `${path}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  } catch (err) {
    // Don't leave a stray .tmp behind if the write or rename failed.
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/** `writeTextAtomic` for a value that should land as pretty-printed JSON. */
export async function writeJsonAtomic(path, value) {
  await writeTextAtomic(path, JSON.stringify(value, null, 2) + '\n')
}
