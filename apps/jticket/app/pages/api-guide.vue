<script setup lang="ts">
useHead({ title: 'API guide' })

const importExample =`curl -s http://localhost:3000/api/import \\
  -H 'content-type: application/json' \\
  -d '{
  "projects": [
    { "title": "Checkout", "description": "Everything payments-related" }
  ],
  "epics": [
    { "title": "Checkout revamp", "description": "New payment flow", "project": "Checkout" }
  ],
  "tickets": [
    {
      "title": "Add cart schema",
      "description": "Persist a cart end-to-end.",
      "acceptanceCriteria": ["Cart survives refresh", "API returns totals"],
      "type": "AFK",
      "epic": "Checkout revamp",
      "blockedBy": []
    },
    {
      "title": "Cart UI",
      "description": "Render the cart and let users edit quantities.",
      "type": "AFK",
      "epic": "Checkout revamp",
      "blockedBy": ["Add cart schema"]
    }
  ]
}'`

const endpoints = [
  { m: 'GET', p: '/api/projects', d: 'List all projects' },
  { m: 'POST', p: '/api/projects', d: 'Create a project { title, description }' },
  { m: 'GET', p: '/api/projects/:id', d: 'Get one project (id or key) + its epics' },
  { m: 'PATCH', p: '/api/projects/:id', d: 'Update a project' },
  { m: 'DELETE', p: '/api/projects/:id', d: 'Delete a project (epics → unassigned)' },
  { m: 'GET', p: '/api/epics', d: 'List all epics' },
  { m: 'POST', p: '/api/epics', d: 'Create an epic { title, description, projectId? }' },
  { m: 'GET', p: '/api/epics/:id', d: 'Get one epic (id or key) + its tickets' },
  { m: 'PATCH', p: '/api/epics/:id', d: 'Update an epic' },
  { m: 'DELETE', p: '/api/epics/:id', d: 'Delete an epic (tickets → backlog)' },
  { m: 'GET', p: '/api/tickets', d: 'List tickets (?epicId= &status= &assignee= &label= &frontier=true)' },
  { m: 'POST', p: '/api/tickets', d: 'Create a ticket' },
  { m: 'GET', p: '/api/tickets/:id', d: 'Get one ticket (id or key)' },
  { m: 'PATCH', p: '/api/tickets/:id', d: 'Update a ticket' },
  { m: 'DELETE', p: '/api/tickets/:id', d: 'Delete a ticket (cleans blocked-by edges)' },
  { m: 'POST', p: '/api/import', d: 'Bulk-create a whole breakdown at once' },
  { m: 'GET', p: '/api/docs', d: 'List docs (?projectId= &status= &label=)' },
  { m: 'POST', p: '/api/docs', d: 'Create a doc { title, blocks?|documentKey?, project?, labels?, status? }' },
  { m: 'GET', p: '/api/docs/:id', d: 'Get one doc (id or key)' },
  { m: 'PATCH', p: '/api/docs/:id', d: 'Update a doc' },
  { m: 'DELETE', p: '/api/docs/:id', d: 'Delete a doc' },
  { m: 'GET', p: '/api/documents', d: 'List the shared document pool (from @jsuite/documents)' },
  { m: 'POST', p: '/api/documents', d: 'Create/replace a shared document { title, blocks, key?, replace? }' },
  { m: 'GET', p: '/api/documents/:key', d: 'Get a shared document / :key/notes for its notes' },
  { m: 'GET', p: '/api/attachments', d: 'List uploaded attachments' },
  { m: 'POST', p: '/api/attachments', d: 'Upload { name, base64 } → served at /attachments/:name' },
]

const docExample = `curl -s http://localhost:3000/api/docs \\
  -H 'content-type: application/json' \\
  -d '{
  "title": "Checkout revamp — design notes",
  "project": "Checkout",
  "labels": ["design", "payments"],
  "status": "draft",
  "kicker": "DESIGN NOTES",
  "subtitle": "Why the legacy flow is being rebuilt.",
  "blocks": [
    { "type": "prose", "md": "## Why now\\n\\nLegacy flow drops **12%** of carts." },
    { "type": "callout", "tone": "warning", "title": "The trap", "md": "PCI scope is unconfirmed." },
    { "type": "compare", "columns": ["", "Rebuild", "Patch"], "rows": [["Effort", "High", "Low"]] },
    { "type": "takeaway", "points": ["Rebuild, but stage it."] }
  ]
}'`

const blockTypes = [
  { s: 'prose', d: 'Markdown backbone — headings, lists, links, tables, code' },
  { s: 'callout', d: 'Tone-coded aside: insight · warning · success · aside' },
  { s: 'code', d: 'Syntax-highlighted, line highlights + margin annotations' },
  { s: 'diff', d: 'Unified diff with per-line annotations and commentary' },
  { s: 'chart', d: 'Live Excalidraw canvas — shared with jChart (mermaid in)' },
  { s: 'steps', d: 'Numbered walkthrough' },
  { s: 'compare', d: 'Options table with markdown cells' },
  { s: 'timeline', d: 'Chronology of events' },
  { s: 'takeaway', d: 'Closing key-points card' },
]
const frontierExample = `# The takeable edge of a map: todo + all blockers done + unassigned, in order
curl -s 'http://localhost:3000/api/tickets?epicId=EPIC-14&frontier=true'

# Claim the first one, do the work, then resolve it
curl -s -X PATCH http://localhost:3000/api/tickets/TICK-31 \\
  -H 'content-type: application/json' -d '{ "assignee": "Claude" }'
curl -s -X PATCH http://localhost:3000/api/tickets/TICK-31 \\
  -H 'content-type: application/json' \\
  -d '{ "status": "done", "resolution": "Chose X because…" }'`

const assignExample = `# An agent claims a ticket by name (id or key both work)
curl -s -X PATCH http://localhost:3000/api/tickets/TICK-1 \\
  -H 'content-type: application/json' \\
  -d '{ "assignee": "Claude" }'

# List everything assigned to me
curl -s 'http://localhost:3000/api/tickets?assignee=Claude'

# Unassign
curl -s -X PATCH http://localhost:3000/api/tickets/TICK-1 \\
  -H 'content-type: application/json' -d '{ "assignee": "" }'`

const methodColor: Record<string, string> = {
  GET: 'info',
  POST: 'success',
  PATCH: 'warning',
  DELETE: 'error',
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <header class="border-b border-default">
      <UContainer class="flex items-center justify-between py-3">
        <div class="flex items-center gap-2">
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/">Board</UButton>
          <h1 class="text-lg font-semibold">API guide</h1>
        </div>
      </UContainer>
    </header>

    <UContainer class="prose-none max-w-3xl space-y-8 py-8">
      <section class="space-y-2">
        <p class="text-sm text-muted">
          jTicket is a local-only store for drafting <strong>projects</strong>, <strong>epics</strong> &amp;
          <strong>tickets</strong> (that hierarchy, top to bottom) before you author them to Jira by hand.
          LLM skills (e.g. Matt Pocock's <code class="text-primary">to-tickets</code>) can author here
          first so you can review and edit before anything goes online.
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold">Endpoints</h2>
        <div class="overflow-hidden rounded-lg border border-default">
          <div
            v-for="(e, i) in endpoints"
            :key="e.p + e.m"
            class="flex items-center gap-3 px-4 py-2.5 text-sm"
            :class="i % 2 ? 'bg-elevated/30' : ''"
          >
            <UBadge :color="(methodColor[e.m] as any)" variant="subtle" size="sm" class="w-16 justify-center font-mono">
              {{ e.m }}
            </UBadge>
            <code class="font-mono text-default">{{ e.p }}</code>
            <span class="ml-auto text-muted">{{ e.d }}</span>
          </div>
        </div>
      </section>

      <section>
        <h2 class="mb-2 text-base font-semibold">Bulk import (recommended for skills)</h2>
        <p class="mb-3 text-sm text-muted">
          One call authors a whole breakdown across all three levels. Reference an epic's
          <code>project</code> by title or key, a ticket's <code>epic</code> by title or key, and
          <code>blockedBy</code> by ticket title or key — ids are generated for you.
          <code>projects</code> and <code>epics</code> are optional.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ importExample }}</code></pre>
      </section>

      <section>
        <h2 class="mb-2 text-base font-semibold">Docs — draft Confluence-style pages</h2>
        <p class="mb-3 text-sm text-muted">
          A doc is a tracker record wrapping a <strong>shared block document</strong> (the jExplain
          format): <code>title</code>, <code>blocks</code> (or <code>documentKey</code> to link an
          existing document), optional <code>project</code> (by title, key, or id), <code>labels</code>,
          and <code>status</code> (<code>draft</code> · <code>ready</code>). Nothing is ever posted
          anywhere external — docs render at <code>/docs/DOC-n</code> (and in jExplain, which reads the
          same pool). PATCH with <code>blocks</code> rewrites the content; notes survive.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ docExample }}</code></pre>
      </section>

      <section>
        <h2 class="mb-2 text-base font-semibold">Document blocks</h2>
        <p class="mb-3 text-sm text-muted">
          One shared block vocabulary serves jTicket docs and jExplain articles (the
          <code>j-explain</code> format — see the to-jdoc / j-explain skills for payload shapes).
          Ticket / epic / project descriptions and resolutions are plain GFM markdown:
        </p>
        <div class="overflow-hidden rounded-lg border border-default">
          <div
            v-for="(row, i) in blockTypes"
            :key="row.s"
            class="flex items-center gap-3 px-4 py-2 text-sm"
            :class="i % 2 ? 'bg-elevated/30' : ''"
          >
            <code class="shrink-0 font-mono text-xs text-default">{{ row.s }}</code>
            <span class="ml-auto text-right text-xs text-muted">{{ row.d }}</span>
          </div>
        </div>
      </section>

      <section class="space-y-2">
        <h2 class="text-base font-semibold">Ticket fields</h2>
        <ul class="list-inside list-disc text-sm text-muted">
          <li><code>title</code> — short descriptive name (required)</li>
          <li><code>description</code> — the end-to-end behaviour ("what to build")</li>
          <li><code>acceptanceCriteria</code> — string array</li>
          <li><code>type</code> — <code>AFK</code> (agent-runnable) or <code>HITL</code> (needs a human)</li>
          <li><code>status</code> — <code>todo</code> · <code>in_progress</code> · <code>done</code></li>
          <li><code>epicId</code> / <code>epic</code> — parent epic</li>
          <li><code>assignee</code> — free-form name of who is working on it (agents self-assign by name; <code>''</code> = unassigned)</li>
          <li><code>labels</code> — free-form strings; wayfinder uses <code>wayfinder:research|prototype|grilling|task</code></li>
          <li><code>resolution</code> — the answer, recorded on resolve (markdown)</li>
          <li><code>blockedBy</code> — tickets that gate this one</li>
          <li class="text-dimmed">GET adds derived <code>blocked</code> · <code>claimed</code> · <code>frontier</code> flags (not stored)</li>
        </ul>
      </section>

      <section>
        <h2 class="mb-2 text-base font-semibold">Assigning yourself</h2>
        <p class="mb-3 text-sm text-muted">
          Any agent can claim a ticket by PATCHing its <code>assignee</code> with its own name, then
          filter the board down to its own work with <code>?assignee=</code>. Set it to <code>""</code> to
          release the ticket.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ assignExample }}</code></pre>
      </section>

      <section>
        <h2 class="mb-2 flex items-center gap-2 text-base font-semibold">
          <UIcon name="i-lucide-compass" class="size-4 text-primary" />Wayfinder mode
        </h2>
        <p class="mb-3 text-sm text-muted">
          Set a project's <code>mode</code> to <code>wayfinder</code> and each of its epics becomes a
          <strong>map</strong> (label it <code>wayfinder:map</code>; its description is the map body). Tickets are
          wayfinder tickets — sub-type via a <code>wayfinder:&lt;research|prototype|grilling|task&gt;</code> label,
          claim by setting <code>assignee</code>, resolve by setting <code>status: done</code> + <code>resolution</code>.
          The board groups them into <strong>Frontier · In progress · Blocked · Resolved</strong>.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ frontierExample }}</code></pre>
      </section>
    </UContainer>
  </div>
</template>
