import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import type { CodeMap } from '../../../app/utils/mapTypes'

/**
 * Create a map. Body: { repoPath, title?, key? }
 *
 * Creating a map creates the machinery in jTicket: a jmap-mode project (repo =
 * the mapped directory, so herdr dispatch has its cwd) and the scoping ticket
 * (label jmap:scope → the Run button dispatches `/jmap-scope TICK-n`). All the
 * mapping work then flows through jTicket; jMap keeps only the map identity
 * and, later, the synthesized graph.
 *
 * Returns { key, title, path: "/m/<key>", projectKey }.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const rawRepo = String(body.repoPath ?? '').trim()
  if (!rawRepo) throw createError({ statusCode: 400, message: 'missing `repoPath` — nothing to map' })

  const repoPath = resolve(rawRepo.replace(/^~(?=$|\/)/, homedir()))
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    throw createError({ statusCode: 400, message: `repoPath is not a directory: ${repoPath}` })
  }

  const title = String(body.title ?? '').trim() || basename(repoPath)
  const key = await uniqueMapKey(String(body.key ?? '') || title)

  const project = await jticketFetch<{ key: string }>('/api/projects', {
    method: 'POST',
    body: {
      title: `Map: ${title}`,
      mode: 'jmap',
      repo: repoPath,
      description: [
        `Codebase map of \`${repoPath}\`, driven by jMap (https://jmap.local/m/${key}).`,
        '',
        'How this project works:',
        `1. Run the scoping ticket in herdr (the Run button on /next dispatches \`/jmap-scope\`). It explores the repo, publishes a scoping doc here, and creates one \`jmap:domain\` ticket per part of the codebase.`,
        `2. Run the domain tickets (each dispatches \`/jmap-domain\`). Each maps its part, publishes a walkthrough doc on this project, and resolves its ticket.`,
        `3. When the docs are in, the map room at https://jmap.local/m/${key} creates a synthesis ticket (dispatches \`/jmap-synthesize\`) — running it unifies the docs into the interactive map.`,
        '',
        'No branches, no PRs — the output of every ticket is documentation.',
      ].join('\n'),
    },
  })

  await jticketFetch('/api/tickets', {
    method: 'POST',
    body: {
      title: `Scope ${title} for mapping`,
      description: [
        `Scoping pass for the jMap map \`${key}\` of \`${repoPath}\`.`,
        '',
        'Explore the codebase top-down and divide it into domains (pages, surfaces, systems). Publish a scoping doc on this project, then create one `jmap:domain` ticket per domain with its entry paths, so each can be mapped in depth by its own session. The `/jmap-scope` skill carries the full contract.',
      ].join('\n'),
      type: 'AFK',
      projectId: project.key,
      labels: ['jmap', 'jmap:scope'],
      acceptanceCriteria: [
        'A scoping doc is published on the project',
        'One jmap:domain ticket exists per domain, each with entry paths',
        'This ticket is resolved with the domain list',
      ],
    },
  })

  const now = new Date().toISOString()
  const map: CodeMap = {
    format: 'j-map',
    version: 2,
    key,
    title,
    repoPath,
    projectKey: project.key,
    status: 'mapping',
    createdAt: now,
    updatedAt: now,
  }
  await writeMap(map)
  return { key, title, path: `/m/${key}`, projectKey: project.key }
})
