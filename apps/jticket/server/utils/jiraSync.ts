import { readFileSync, writeFileSync } from 'node:fs'
import { appDataFile } from '@jsuite/data'
import { loadStore, now, saveStore, stampCompletion, type Ticket, type TicketStatus } from './store'

/**
 * Two-way sync between jTicket tickets and the Jira issues they mirror.
 *
 * A ticket is linked by a `jira:<KEY>` label, and only tickets in the projects
 * listed in `.data/jticket/jira.json` sync — opting in per project keeps the
 * older mirrored projects from rewriting Jira on the first tick. Title ↔ summary
 * and status ↔ status category are synced; descriptions and comments are not.
 *
 * Each field is three-way merged against the last value both sides agreed on
 * (`.data/jticket/jira-sync.json`): the side that moved wins, and when both
 * moved the more recently updated one does. A ticket seen for the first time
 * takes Jira's values, since Jira is the team's copy.
 *
 * Config (`.data/jticket/jira.json`, env overrides):
 *   { "site": "year13au.atlassian.net", "email": "…", "token": "…", "projects": ["PROJ-35"] }
 *   JIRA_SITE / JIRA_EMAIL / JIRA_API_TOKEN
 */

export type Category = 'todo' | 'in_progress' | 'done'
export interface Fields {
  title: string
  status: Category
}
type Side = Fields & { updatedAt: string }

export interface JiraConfig {
  site: string
  email: string
  token: string
  projects: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function jiraConfig(): JiraConfig | null {
  let file: Record<string, unknown> = {}
  try {
    file = JSON.parse(readFileSync(appDataFile('jticket', 'jira.json'), 'utf8')) ?? {}
  } catch {
    return null
  }
  const config = {
    site: str(process.env.JIRA_SITE) || str(file.site) || 'year13au.atlassian.net',
    email: str(process.env.JIRA_EMAIL) || str(file.email),
    token: str(process.env.JIRA_API_TOKEN) || str(file.token),
    projects: Array.isArray(file.projects) ? file.projects.map(str).filter(Boolean) : [],
  }
  return config.email && config.token && config.projects.length ? config : null
}

export const categoryOf = (status: TicketStatus): Category =>
  status === 'merged' ? 'done' : status

const JIRA_CATEGORY: Record<string, Category> = { new: 'todo', indeterminate: 'in_progress', done: 'done' }
const CATEGORY_JIRA: Record<Category, string> = { todo: 'new', in_progress: 'indeterminate', done: 'done' }

/** What each side must take so both hold the same fields, and what they will then agree on. */
export function reconcile(local: Side, remote: Side, base: Fields | undefined) {
  const toLocal: Partial<Fields> = {}
  const toRemote: Partial<Fields> = {}
  const next: Fields = { title: local.title, status: local.status }
  for (const field of ['title', 'status'] as const) {
    const l = local[field]
    const r = remote[field]
    if (l === r) continue
    const remoteWins = !base
      || (l === base[field] ? true
        : r === base[field] ? false
          : Date.parse(remote.updatedAt) > Date.parse(local.updatedAt))
    if (remoteWins) {
      Object.assign(toLocal, { [field]: r })
      Object.assign(next, { [field]: r })
    } else {
      Object.assign(toRemote, { [field]: l })
    }
  }
  return { toLocal, toRemote, next }
}

const STATE_FILE = () => appDataFile('jticket', 'jira-sync.json')

function readState(): Record<string, Fields> {
  try {
    return JSON.parse(readFileSync(STATE_FILE(), 'utf8')) ?? {}
  } catch {
    return {}
  }
}

const jiraKeyOf = (ticket: Ticket) => ticket.labels.find((l) => /^jira:[A-Z][A-Z0-9]+-\d+$/.test(l))?.slice(5)

function jira(config: JiraConfig) {
  const auth = `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`https://${config.site}/rest/api/3${path}`, {
      method,
      headers: { authorization: auth, accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Jira ${method} ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return res.status === 204 ? null : res.json()
  }
}

interface Issue {
  key: string
  fields: { summary: string; updated: string; status: { statusCategory: { key: string } } }
}

/** One pass over every linked ticket. Returns what moved, for the log and the manual trigger. */
export async function syncJira(config: JiraConfig | null = jiraConfig()) {
  if (!config) return { configured: false, pulled: [], pushed: [], errors: [] }
  const call = jira(config)
  const projectIds = new Set(loadStore().projects.filter((p) => config.projects.includes(p.key)).map((p) => p.id))
  const linked = loadStore().tickets.filter((t) => projectIds.has(t.projectId ?? '') && jiraKeyOf(t))
  if (!linked.length) return { configured: true, pulled: [], pushed: [], errors: [] }

  const { issues } = (await call('POST', '/search/jql', {
    jql: `key in (${linked.map(jiraKeyOf).join(',')})`,
    fields: ['summary', 'status', 'updated'],
    maxResults: 100,
  })) as { issues: Issue[] }
  const byKey = new Map(issues.map((i) => [i.key, i]))

  const state = readState()
  const pulled: string[] = []
  const pushed: string[] = []
  const errors: string[] = []
  const pulls = new Map<string, Partial<Fields>>()

  for (const ticket of linked) {
    const key = jiraKeyOf(ticket)!
    const issue = byKey.get(key)
    if (!issue) {
      errors.push(`${ticket.key}: ${key} not found in Jira`)
      continue
    }
    const remoteStatus = JIRA_CATEGORY[issue.fields.status.statusCategory.key]
    if (!remoteStatus) continue
    const { toLocal, toRemote, next } = reconcile(
      { title: ticket.title, status: categoryOf(ticket.status), updatedAt: ticket.updatedAt },
      { title: issue.fields.summary, status: remoteStatus, updatedAt: issue.fields.updated },
      state[ticket.id],
    )
    try {
      if (toRemote.title !== undefined) await call('PUT', `/issue/${key}`, { fields: { summary: toRemote.title } })
      if (toRemote.status !== undefined) {
        const { transitions } = (await call('GET', `/issue/${key}/transitions`)) as {
          transitions: { id: string; to: { statusCategory: { key: string } } }[]
        }
        const transition = transitions.find((t) => t.to.statusCategory.key === CATEGORY_JIRA[toRemote.status!])
        if (!transition) throw new Error(`${key} has no transition to a ${toRemote.status} status`)
        await call('POST', `/issue/${key}/transitions`, { transition: { id: transition.id } })
      }
      if (Object.keys(toRemote).length) pushed.push(`${ticket.key} → ${key}: ${Object.keys(toRemote).join(', ')}`)
      if (Object.keys(toLocal).length) pulls.set(ticket.id, toLocal)
      state[ticket.id] = next
    } catch (error) {
      // The agreed values stay as they were, so the push is retried next pass.
      errors.push(`${ticket.key}: ${(error as Error).message}`)
    }
  }

  if (pulls.size) {
    // Load and save with no await between them, so no request's write is lost.
    const store = loadStore()
    const ts = now()
    for (const [id, fields] of pulls) {
      const ticket = store.tickets.find((t) => t.id === id)
      if (!ticket) continue
      if (fields.title !== undefined) ticket.title = fields.title
      if (fields.status !== undefined && categoryOf(ticket.status) !== fields.status) {
        ticket.completedAt = stampCompletion(ticket, fields.status, ts)
        ticket.status = fields.status
      }
      ticket.updatedAt = ts
      pulled.push(`${jiraKeyOf(ticket)} → ${ticket.key}: ${Object.keys(fields).join(', ')}`)
    }
    saveStore(store)
  }
  writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2))
  return { configured: true, pulled, pushed, errors }
}
