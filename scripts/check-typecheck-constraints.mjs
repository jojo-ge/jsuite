// Three constraints keep `pnpm typecheck` honest, and all three fail *quietly*
// when broken — the TypeScript 5.9 pin, the vue-router 5 pin, and the rule that
// a `packages/*` layer shipping `.vue` files must declare `vue` itself. The
// third is the worst of them: it doesn't break the run at all, it just makes
// every prop in that layer `any` while the checker still exits 0. See TICK-152
// for why, and README.md "Typechecking" for the prose.
//
// This runs first in the root `typecheck` script, so a broken constraint is
// loud and stops the fan-out — a green typecheck under a broken constraint is
// worse than no typecheck, because it looks like an answer.
//
//   node scripts/check-typecheck-constraints.mjs   (or: pnpm typecheck:constraints)
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []
const skips = []

const fail = (where, what, fix) => failures.push({ where, what, fix })
const skip = (what, why) => skips.push(`${what} — ${why}`)

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const dirsIn = (path) =>
  existsSync(path)
    ? readdirSync(path)
        .filter((name) => !name.startsWith('.'))
        .map((name) => join(path, name))
        .filter((entry) => statSync(entry).isDirectory())
    : []

// Every `.vue` under a package, node_modules aside — a layer's components live
// in app/components today, but the rule is about the files, not the directory.
const vueFilesIn = (dir, found = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const entry = join(dir, name)
    if (statSync(entry).isDirectory()) vueFilesIn(entry, found)
    else if (name.endsWith('.vue')) found.push(entry)
  }
  return found
}

// The version a dependency actually resolved to, from `dir`'s perspective.
const installedVersion = (dir, name) => {
  const manifest = join(dir, 'node_modules', name, 'package.json')
  return existsSync(manifest) ? readJson(manifest).version : null
}

// ── 1. Every packages/* layer that ships .vue files declares vue ────────────
//
// Checked two ways. The declaration is the fix a human types; the resolution
// probe is the property that actually matters — `vue-tsc` compiles an SFC to
// virtual TS ending in `declare const { defineProps, ... }: typeof import('vue')`,
// resolved from the SFC's *own* directory, under an `@ts-ignore` that swallows
// the failure. If `vue` doesn't resolve from inside the layer, props are `any`
// however the manifest reads.
for (const layer of dirsIn(join(root, 'packages'))) {
  const manifestPath = join(layer, 'package.json')
  if (!existsSync(manifestPath)) continue

  // Sorted so the file named in a failure message is the same on every machine;
  // readdirSync order isn't guaranteed.
  const components = vueFilesIn(layer).sort()
  if (components.length === 0) continue

  const pkg = readJson(manifestPath)
  const where = relative(root, layer)
  const add = `pnpm --filter ${pkg.name} add -D vue`

  if (pkg.dependencies?.vue) {
    fail(
      where,
      `declares vue as a runtime dependency; it must be a devDependency (${components.length} .vue file(s))`,
      `move "vue" from dependencies to devDependencies in ${relative(root, manifestPath)} — the host app owns the runtime copy, and a second Vue instance in the bundle breaks reactivity across the layer boundary`,
    )
  } else if (!pkg.devDependencies?.vue) {
    fail(
      where,
      `ships ${components.length} .vue file(s) but does not declare vue, so every prop in them is silently \`any\` — in script and template — while typecheck still exits 0`,
      `${add}  (see README.md "Typechecking")`,
    )
    continue
  }

  // The probe: resolve `vue` the way vue-tsc does, from the component's own
  // directory. Needs an install, so it reports as skipped rather than passing
  // when node_modules isn't there.
  if (!existsSync(join(layer, 'node_modules'))) {
    skip(`${where} vue-resolves-from-layer`, 'not installed; run pnpm install')
    continue
  }
  const from = createRequire(pathToFileURL(components[0]))
  try {
    from.resolve('vue')
  } catch {
    fail(
      where,
      `declares vue, but vue does not resolve from ${relative(root, components[0])} — which is where vue-tsc looks. Props in this layer are \`any\``,
      `${add} && pnpm install`,
    )
  }
}

// ── 2. TypeScript is pinned to 5.9 workspace-wide ───────────────────────────
//
// vue-tsc 3.x loads `typescript/lib/tsc`, dropped from TypeScript 7's exports.
// Apps that take typescript only as an auto-installed peer resolve 7 and die
// with ERR_PACKAGE_PATH_NOT_EXPORTED.
const TS_PIN = /^[~^]?5\.9(\.\d+)?$/
const workspaceYaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
const overridesBlock = workspaceYaml.match(/^overrides:\s*$([\s\S]*?)(?=^\S|\s*$(?![\s\S]))/m)?.[1] ?? ''
const tsOverride = overridesBlock.match(/^\s+['"]?typescript['"]?:\s*['"]?([^'"\s#]+)/m)?.[1]

if (!TS_PIN.test(tsOverride ?? '')) {
  fail(
    'pnpm-workspace.yaml',
    tsOverride
      ? `overrides.typescript is "${tsOverride}", not a 5.9 range`
      : 'overrides.typescript is missing, so apps can resolve TypeScript 7 as a peer',
    'set `typescript: ^5.9.3` under `overrides:` — vue-tsc 3.x needs typescript/lib/tsc, which TS 7 no longer exports',
  )
}

// ── 3. vue-router is v5 ─────────────────────────────────────────────────────
//
// Nuxt 4.5's generated tsconfig loads `vue-router/volar/sfc-route-blocks`,
// which only v5 exports. On v4 the Vue language plugin fails to load and typing
// quietly degrades.
const VUE_ROUTER_PIN = /^[~^]?5\./

for (const app of dirsIn(join(root, 'apps'))) {
  const manifestPath = join(app, 'package.json')
  if (!existsSync(manifestPath)) continue

  const pkg = readJson(manifestPath)
  if (!pkg.scripts?.typecheck) continue
  const where = relative(root, app)

  // The pin only holds if the app names typescript itself; an auto-installed
  // peer sidesteps `overrides` in some resolution paths.
  const ts = pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript
  if (!TS_PIN.test(ts ?? '')) {
    fail(
      where,
      ts
        ? `declares typescript "${ts}", not a 5.9 range`
        : 'does not declare typescript, so it resolves whatever a peer pulls in',
      `pnpm --filter ${pkg.name} add -D typescript@^5.9.3`,
    )
  }

  const declaredRouter = pkg.dependencies?.['vue-router'] ?? pkg.devDependencies?.['vue-router']
  if (declaredRouter && !VUE_ROUTER_PIN.test(declaredRouter)) {
    fail(
      where,
      `declares vue-router "${declaredRouter}"; Nuxt's generated tsconfig loads vue-router/volar/sfc-route-blocks, which only v5 exports`,
      `pnpm --filter ${pkg.name} add vue-router@^5.1.0`,
    )
  }

  if (!existsSync(join(app, 'node_modules'))) {
    skip(`${where} installed-versions`, 'not installed; run pnpm install')
    continue
  }
  for (const [name, pin, fixVersion] of [
    ['typescript', TS_PIN, '^5.9.3'],
    ['vue-router', VUE_ROUTER_PIN, '^5.1.0'],
  ]) {
    const version = installedVersion(app, name)
    if (version && !pin.test(version)) {
      fail(
        where,
        `resolved ${name}@${version}, outside the pin`,
        `pnpm --filter ${pkg.name} add -D ${name}@${fixVersion} && pnpm install`,
      )
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
for (const line of skips) console.log(`[typecheck-guard] skipped ${line}`)

if (failures.length === 0) {
  console.log('[typecheck-guard] ok — layer vue declarations, TypeScript 5.9 pin, vue-router 5 pin')
  process.exit(0)
}

console.error(`\n[typecheck-guard] ${failures.length} broken constraint(s). Typecheck would pass anyway — that is the problem.\n`)
for (const { where, what, fix } of failures) {
  console.error(`  ${where}`)
  console.error(`    ${what}`)
  console.error(`    fix: ${fix}\n`)
}
console.error('Background: README.md "Typechecking".')
process.exit(1)
