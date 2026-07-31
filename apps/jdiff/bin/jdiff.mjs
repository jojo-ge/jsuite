#!/usr/bin/env node
// jdiff — tiny CLI to open jDiff pages in the browser.
// dependency-free (node built-ins only). meant to be driven by LLM agents.

import { execFileSync, execFile } from 'node:child_process'
import { homedir } from 'node:os'
import https from 'node:https'
import http from 'node:http'

// --- base url --------------------------------------------------------------
// Default host: the jSuite Caddy edge (~/code/anyway/jsuite) terminates TLS for
// jdiff.local on :7443 — not :443, which the kraken/phoenix dev runtime owns.
const DEFAULT_BASE = 'https://jdiff.local:7443'
// strip trailing slash so we can concatenate paths cleanly.
const BASE = (process.env.JDIFF_URL || DEFAULT_BASE).replace(/\/+$/, '')

// --- helpers ---------------------------------------------------------------

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`)
  process.exit(1)
}

// expand a leading ~ to the user's home dir.
function expandHome(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return homedir() + p.slice(1)
  return p
}

// resolve the absolute repo root. honours an explicit override, else asks git.
function resolveRepo(override, cwd) {
  if (override) {
    const abs = expandHome(override)
    // let git turn it into a canonical toplevel path (also validates it).
    try {
      // silence git's own "fatal:" chatter — we print our own clean error.
      return execFileSync('git', ['-C', abs, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      fail(`--repo path is not inside a git repo: ${abs}`)
    }
  }
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    fail(
      'not a git repository (and no --repo given). run jdiff from inside a repo or pass --repo <path>.'
    )
  }
}

// open a url in the platform default browser. best-effort; never throws.
function openBrowser(url) {
  let cmd, args
  if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    // start needs an (empty) title arg first.
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }
  execFile(cmd, args, (err) => {
    if (err) {
      process.stderr.write(
        `note: could not launch browser (${cmd}). open the url manually.\n`
      )
    }
  })
}

// best-effort reachability check against <base>/. resolves regardless of
// outcome — a failed check must never block url output.
function healthCheck(base) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL(base + '/')
    } catch {
      return resolve()
    }
    const isHttps = url.protocol === 'https:'
    const lib = isHttps ? https : http
    // guard so timeout+error can't warn/resolve twice.
    let done = false
    const finish = (unreachable) => {
      if (done) return
      done = true
      if (unreachable) warnUnreachable(base)
      resolve()
    }
    const req = lib.request(
      url,
      {
        method: 'HEAD',
        timeout: 1500,
        // jdiff.local may use a local/self-signed cert.
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        res.resume() // drain
        finish(false)
      }
    )
    req.on('timeout', () => {
      req.destroy()
      finish(true)
    })
    req.on('error', () => finish(true))
    req.end()
  })
}

function warnUnreachable(base) {
  process.stderr.write(
    `warning: jDiff server not reachable at ${base} — start the suite: ~/code/anyway/jsuite/jsuite start\n`
  )
}

// emit a url: bare line when --print, else "Opening ..." + launch browser.
async function emit(url, printOnly) {
  if (printOnly) {
    process.stdout.write(url + '\n')
    return
  }
  await healthCheck(BASE)
  process.stdout.write(`Opening ${url}\n`)
  openBrowser(url)
}

const enc = encodeURIComponent

// --- usage -----------------------------------------------------------------

function usage() {
  return `jdiff — open jDiff pages in your browser

usage:
  jdiff pr <number> [options]          open the PR diff page
  jdiff branch <name> [base] [options] open the local-branch diff view
  jdiff open [options]                 open the repo's PR list page
  jdiff --help                         show this help

options:
  --repo, -C <path>   git repo to target (default: current repo; ~ expands)
  --print, -p         only print the resolved URL (no browser); machine-readable

environment:
  JDIFF_URL   base URL of the jDiff server (default: ${DEFAULT_BASE})

examples:
  jdiff pr 123
  jdiff branch my-feature main
  jdiff open -C ~/code/other-repo
  JDIFF_URL=http://localhost:3002 jdiff pr 42 --print   # bypass the edge
`
}

// --- arg parsing -----------------------------------------------------------

// pull global flags out of argv, returning the remaining positional args.
function parseArgs(argv) {
  const positional = []
  let repo = null
  let printOnly = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--repo' || a === '-C') {
      repo = argv[++i]
      if (repo == null) fail(`${a} requires a <path> argument`)
    } else if (a === '--print' || a === '-p') {
      printOnly = true
    } else if (a === '--help' || a === '-h') {
      positional.push('help')
    } else {
      positional.push(a)
    }
  }
  return { positional, repo, printOnly }
}

// --- main ------------------------------------------------------------------

async function main() {
  const { positional, repo, printOnly } = parseArgs(process.argv.slice(2))
  const cmd = positional[0]

  // help / no-arg edge: treat bare `jdiff` as `open` per spec, but a help
  // request short-circuits.
  if (cmd === 'help') {
    process.stdout.write(usage())
    return
  }

  if (cmd === 'pr') {
    const number = positional[1]
    if (number == null) {
      process.stderr.write(usage())
      fail('pr requires a <number>')
    }
    if (!/^\d+$/.test(number)) fail(`pr <number> must be all digits: ${number}`)
    const abs = resolveRepo(repo, process.cwd())
    const url = `${BASE}/pr/${number}?repo=${enc(abs)}`
    await emit(url, printOnly)
    return
  }

  if (cmd === 'branch') {
    const name = positional[1]
    const base = positional[2]
    if (name == null) {
      process.stderr.write(usage())
      fail('branch requires a <name>')
    }
    const abs = resolveRepo(repo, process.cwd())
    let url = `${BASE}/branch?repo=${enc(abs)}&branch=${enc(name)}`
    if (base != null) url += `&base=${enc(base)}`
    await emit(url, printOnly)
    return
  }

  // `open` or bare invocation → repo PR list.
  if (cmd === 'open' || cmd == null) {
    const abs = resolveRepo(repo, process.cwd())
    const url = `${BASE}/prs?repo=${enc(abs)}`
    await emit(url, printOnly)
    return
  }

  // unknown subcommand.
  process.stderr.write(usage())
  fail(`unknown command: ${cmd}`)
}

main().catch((e) => fail(e && e.message ? e.message : String(e)))
