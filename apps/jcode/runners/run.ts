// jCode sandbox runner (TypeScript / JavaScript, executed with tsx).
//
// Runs every case in ./cases against the function exported by ./solution
// and reports. Two kinds of line leave this process:
//   - the human's own console.* output — tagged by jCode's preload, shown
//     under "My logs" on the kata page;
//   - this runner's protocol lines — a 0x1e-prefixed JSON record per case
//     start and one summary at the end, which the page turns into the cases
//     table. Everything else is plain runner text.
// Don't edit this file: it is copied fresh from the app on every publish.
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

interface Case {
  name: string
  /** Positional arguments for the function. */
  args?: unknown[]
  /** Or drive it yourself: receives the function, returns the value to check. */
  call?: (fn: (...a: any[]) => unknown) => unknown
  /** Deep-equal expectation (skip when `check` is given). */
  expected?: unknown
  /** Custom check: true = pass; a string = failure reason. */
  check?: (actual: unknown) => boolean | string
}

const RS = String.fromCharCode(0x1e)
const out = (s: string) => process.stdout.write(s + '\n')
const protocol = (rec: Record<string, unknown>) => out(RS + JSON.stringify({ jcode: true, ...rec }))
const show = (v: unknown) => {
  try {
    const s = JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x === undefined ? '«undefined»' : x))
    return s === undefined ? String(v) : s.length > 400 ? s.slice(0, 400) + '…' : s
  } catch {
    return String(v)
  }
}

const here = process.cwd()
const load = async (name: string) => {
  for (const ext of ['ts', 'mts', 'js', 'mjs']) {
    try {
      return await import(pathToFileURL(`${here}/${name}.${ext}`).href)
    } catch (err: any) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !String(err.message).includes(`${name}.${ext}`)) throw err
    }
  }
  throw new Error(`no ${name}.{ts,js} in ${here}`)
}

const solution = await load('solution')
const spec = await load('cases')
const cases: Case[] = spec.cases ?? spec.default ?? []
const fnName: string | undefined = spec.fn ?? process.env.JCODE_FN
const fn =
  (fnName && solution[fnName]) ??
  solution.default ??
  Object.values(solution).find((v) => typeof v === 'function')
if (typeof fn !== 'function') {
  out(`! solution exports no function${fnName ? ` named ${fnName}` : ''}`)
  process.exit(2)
}

let passed = 0
const results: Record<string, unknown>[] = []
for (const c of cases) {
  protocol({ type: 'case', name: c.name })
  const t0 = performance.now()
  let actual: unknown
  let error: string | undefined
  let ok = false
  let reason: string | undefined
  try {
    actual = c.call ? await c.call(fn) : await fn(...(c.args ?? []))
    if (c.check) {
      const r = c.check(actual)
      ok = r === true
      if (typeof r === 'string') reason = r
    } else {
      ok = isDeepStrictEqual(actual, c.expected)
    }
  } catch (err: any) {
    error = String(err?.stack ?? err?.message ?? err).split('\n').slice(0, 4).join('\n')
    if (/jcode:/.test(error)) error = 'not implemented yet (the stub still throws)'
  }
  const ms = Math.round(performance.now() - t0)
  if (ok) passed++
  out(`${ok ? '✓' : '✗'} ${c.name}${ok ? '' : error ? ` — threw: ${error.split('\n')[0]}` : reason ? ` — ${reason}` : ` — expected ${show(c.expected)}, got ${show(actual)}`}`)
  results.push({
    name: c.name,
    pass: ok,
    ms,
    ...(c.check ? {} : { expected: show(c.expected) }),
    actual: error ? undefined : show(actual),
    error,
    reason,
  })
}
out('')
out(`${passed}/${cases.length} cases passed`)
protocol({ type: 'summary', passed, total: cases.length, cases: results })
process.exit(passed === cases.length && cases.length > 0 ? 0 : 1)
