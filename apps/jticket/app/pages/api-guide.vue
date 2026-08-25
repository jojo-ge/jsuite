<script setup lang="ts">
useHead({ title: 'API guide' })

const importExample =`curl -s http://localhost:43000/api/import \\
  -H 'content-type: application/json' \\
  -d '{
  "projects": [
    { "title": "Checkout", "description": "Everything payments-related" }
  ],
  "tickets": [
    {
      "title": "Add cart schema",
      "description": "Persist a cart end-to-end.",
      "acceptanceCriteria": ["Cart survives refresh", "API returns totals"],
      "type": "AFK",
      "project": "Checkout",
      "blockedBy": []
    },
    {
      "title": "Cart UI",
      "description": "Render the cart and let users edit quantities.",
      "type": "AFK",
      "project": "Checkout",
      "blockedBy": ["Add cart schema"]
    }
  ]
}'`

const endpoints = [
  { m: 'GET', p: '/api/projects', d: 'List projects (?repo= narrows to one codebase — path, ~/…, or slug); rows carry derived repoPath' },
  { m: 'POST', p: '/api/projects/todo', d: "Get-or-create a codebase's TODO project { repo } — idempotent, one todo-mode project per codebase" },
  { m: 'POST', p: '/api/projects', d: 'Create a project { title, description, mode?, repo?, integrationBranch?, starred? } — starred defaults false; only starred projects surface on /next' },
  { m: 'GET', p: '/api/projects/:id', d: 'Get one project (id or key) + its tickets' },
  { m: 'PATCH', p: '/api/projects/:id', d: 'Update a project' },
  { m: 'DELETE', p: '/api/projects/:id', d: 'Delete a project (tickets → backlog)' },
  { m: 'GET', p: '/api/projects/:id/export', d: 'Download a shareable bundle (tickets, docs, charts, attachments)' },
  { m: 'POST', p: '/api/projects/import', d: 'Recreate a project from an exported bundle' },
  { m: 'GET', p: '/api/projects/:id/github', d: "The project's repo, integration branch, local PRs (with commits) and matching GitHub PRs (?force=1 skips the 30s cache)" },
  { m: 'POST', p: '/api/projects/:id/integration-branch', d: 'Cut (or adopt) the empty integration branch { branch?, base? } and push it' },
  { m: 'POST', p: '/api/projects/:id/sync', d: 'Push the integration branch to origin — the only remote write in the local-PR flow' },
  { m: 'POST', p: '/api/projects/:id/integration-pr', d: 'Push, then open (or find) the roll-up PR on GitHub via gh: integration → default branch' },
  { m: 'GET', p: '/api/projects/:id/branches', d: 'Branches in the project\'s repo, local + origin (?q= search, ?fetch=1 pulls origin first)' },
  { m: 'GET', p: '/api/prs', d: 'List local PRs (?projectId= &repo= &ticket= &status=open|conflicted|merged|closed)' },
  { m: 'POST', p: '/api/prs', d: 'Open a local PR { ticket, title?, description?, headBranch?, baseBranch? } — one per ticket' },
  { m: 'GET', p: '/api/prs/:id', d: 'One local PR (id or PR-n key) with the commits it would merge' },
  { m: 'PATCH', p: '/api/prs/:id', d: 'Edit a local PR; status accepts only closed / open (merge outcomes are the merge\'s)' },
  { m: 'POST', p: '/api/prs/:id/merge', d: 'Squash-merge onto the integration branch, delete the branch, ticket → merged; 409 + conflictFiles on conflict' },
  { m: 'DELETE', p: '/api/prs/:id', d: 'Remove a local PR record (git untouched)' },
  { m: 'POST', p: '/api/tickets/:id/branch', d: 'Cut the ticket\'s local work branch off the integration branch { branch? } — never pushed' },
  { m: 'GET', p: '/api/herdr', d: 'Herdr state: available? + workspaces/tabs (workspace label = project title)' },
  { m: 'POST', p: '/api/herdr/focus', d: 'Focus a herdr workspace or tab { workspace?, tab? } — the "go to herdr" buttons' },
  { m: 'POST', p: '/api/tickets/:id/herdr', d: 'Run a hand-off prompt in herdr { prompt } — claude pane packed ≤4 per PROJ-n tab, no focus steal' },
  { m: 'POST', p: '/api/projects/:id/herdr-merge', d: 'Run the merge sweep in herdr { prompt } — new single-pane "PROJ-n · merge" tab' },
  { m: 'GET', p: '/api/repos', d: 'Known repos = codebases — path, slug, default branch, which projects use each' },
  { m: 'POST', p: '/api/repos', d: 'Remember a repo { path } (validates it is a clone, resolves its slug)' },
  { m: 'DELETE', p: '/api/repos?path=', d: 'Forget a repo (the list only; projects and disk are untouched)' },
  { m: 'GET', p: '/api/repos/probe', d: 'What is this path? (?path=) — read-only check, no store write' },
  { m: 'GET', p: '/api/repos/pick', d: 'Native folder picker (macOS) → { path }' },
  { m: 'GET', p: '/api/tickets', d: 'List tickets (?projectId= &repo= &status= &assignee= &label= &frontier=true &finished=true &since=<ISO>) — ?repo= excludes backlog tickets' },
  { m: 'POST', p: '/api/tickets', d: 'Create a ticket' },
  { m: 'GET', p: '/api/tickets/:id', d: 'Get one ticket (id or key)' },
  { m: 'PATCH', p: '/api/tickets/:id', d: 'Update a ticket' },
  { m: 'DELETE', p: '/api/tickets/:id', d: 'Delete a ticket (cleans blocked-by edges)' },
  { m: 'POST', p: '/api/tickets/:id/comments', d: 'Add a comment { author, body }' },
  { m: 'DELETE', p: '/api/tickets/:id/comments/:cid', d: 'Delete one comment' },
  { m: 'POST', p: '/api/import', d: 'Bulk-create a whole breakdown at once' },
  { m: 'GET', p: '/api/docs', d: 'List docs (?projectId= &repo= &status= &label=)' },
  { m: 'POST', p: '/api/docs', d: 'Create a doc { title, blocks?|documentKey?, project?, labels?, status? }' },
  { m: 'GET', p: '/api/docs/:id', d: 'Get one doc (id or key)' },
  { m: 'PATCH', p: '/api/docs/:id', d: 'Update a doc' },
  { m: 'DELETE', p: '/api/docs/:id', d: 'Delete a doc' },
  { m: 'GET', p: '/api/documents', d: 'List the shared document pool (from @jsuite/documents)' },
  { m: 'POST', p: '/api/documents', d: 'Create/replace a shared document { title, blocks, key?, replace? }' },
  { m: 'GET', p: '/api/documents/:key', d: 'Get a shared document / :key/notes for its notes' },
  { m: 'GET', p: '/api/stream', d: 'SSE — one message per store revision; what makes the board live' },
  { m: 'GET', p: '/api/attachments', d: 'List uploaded attachments' },
  { m: 'POST', p: '/api/attachments', d: 'Upload { name, base64 } → served at /attachments/:name' },
]

const docExample = `curl -s http://localhost:43000/api/docs \\
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
const frontierExample = `# The takeable edge of a map: todo + all blockers done + unassigned + yours, in order
curl -s 'http://localhost:43000/api/tickets?projectId=PROJ-14&frontier=true'

# Claim the first one, do the work, then resolve it
curl -s -X PATCH http://localhost:43000/api/tickets/TICK-31 \\
  -H 'content-type: application/json' -d '{ "assignee": "Claude" }'
curl -s -X PATCH http://localhost:43000/api/tickets/TICK-31 \\
  -H 'content-type: application/json' \\
  -d '{ "status": "done", "resolution": "Chose X because…" }'`

const streamExample = `# Follow the tracker: one message whenever the store changes
curl -N http://localhost:43000/api/stream
# data: {"kind":"hello","revision":7}
# data: {"kind":"change","revision":8}   <- something moved; refetch what you care about
# data: {"kind":"ping"}                  <- heartbeat every 25s, ignore it

# The revision is a change signal, not a cursor — it resets when the server
# restarts, so treat a fresh 'hello' as "refetch, you may have missed something".`

const finishedExample = `# What just landed, newest completion first
curl -s 'http://localhost:43000/api/tickets?finished=true'

# Only the last day's work — since takes any ISO timestamp
curl -s 'http://localhost:43000/api/tickets?finished=true&since=2026-08-14T00:00:00Z'

# completedAt is stamped by the status change itself; you never send it
curl -s -X PATCH http://localhost:43000/api/tickets/TICK-31 \\
  -H 'content-type: application/json' -d '{ "status": "done" }'`

const assignExample = `# An agent claims a ticket by name (id or key both work)
curl -s -X PATCH http://localhost:43000/api/tickets/TICK-1 \\
  -H 'content-type: application/json' \\
  -d '{ "assignee": "Claude" }'

# List everything assigned to me
curl -s 'http://localhost:43000/api/tickets?assignee=Claude'

# Unassign
curl -s -X PATCH http://localhost:43000/api/tickets/TICK-1 \\
  -H 'content-type: application/json' -d '{ "assignee": "" }'`

const commentExample = `# The human leaves direction before handing the ticket to an agent…
curl -s http://localhost:43000/api/tickets/TICK-7/comments \\
  -H 'content-type: application/json' \\
  -d '{ "author": "Joseph", "body": "Keep the old endpoint alive — mobile still calls it." }'

# …and agents comment back (questions, progress notes) under their own name
curl -s http://localhost:43000/api/tickets/TICK-7/comments \\
  -H 'content-type: application/json' \\
  -d '{ "author": "Claude", "body": "Done behind a flag; see the resolution for details." }'

# Comments come back inline on every ticket GET
curl -s http://localhost:43000/api/tickets/TICK-7 | jq '.comments'`

const localPrExample = `# The local flow: cut the ticket's branch (off the integration branch, never pushed)
curl -s -X POST http://localhost:43000/api/tickets/TICK-7/branch -d '{}' \\
  -H 'content-type: application/json'
# → { "branch": "tick/TICK-7-persist-cart", "created": true }

# ...do the work on that branch, then open the local PR (one per ticket)
curl -s http://localhost:43000/api/prs \\
  -H 'content-type: application/json' \\
  -d '{ "ticket": "TICK-7", "description": "Persists the cart via localStorage." }'

# Merge = squash onto the integration branch, no checkout, working tree untouched.
# Deletes the ticket branch and moves the ticket to 'merged'.
curl -s -X POST http://localhost:43000/api/prs/PR-4/merge
# On conflict: 409, the PR turns 'conflicted' with conflictFiles, repo untouched —
# rebase the ticket branch onto the integration branch and POST the merge again.

# The only remote write: push the integration branch when you're ready
curl -s -X POST http://localhost:43000/api/projects/PROJ-2/sync`

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
        <!-- The one page without AppHeader still surfaces pending pull
             approvals — they must be noticeable from any page. -->
        <SyncPullIndicator />
      </UContainer>
    </header>

    <UContainer class="prose-none max-w-3xl space-y-8 py-8">
      <section class="space-y-2">
        <p class="text-sm text-muted">
          jTicket is a local-only store for drafting <strong>projects</strong> &amp;
          <strong>tickets</strong> before you author them to Jira by hand.
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
          One call authors a whole breakdown. Reference a ticket's <code>project</code> by title or
          key, and <code>blockedBy</code> by ticket title or key — ids are generated for you.
          <code>projects</code> is optional.
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
          Ticket / project descriptions and resolutions are plain GFM markdown:
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
          <li><code>status</code> — <code>todo</code> · <code>in_progress</code> · <code>done</code> · <code>merged</code> (set by a local PR merge; done and merged both count as finished)</li>
          <li><code>projectId</code> / <code>project</code> — parent project</li>
          <li><code>assignee</code> — free-form name of who is working on it (agents self-assign by name; <code>''</code> = unassigned)</li>
          <li><code>labels</code> — free-form strings; wayfinder uses <code>wayfinder:research|prototype|grilling|task</code></li>
          <li><code>resolution</code> — the answer, recorded on resolve (markdown)</li>
          <li><code>blockedBy</code> — tickets that gate this one</li>
          <li><code>branch</code> — the ticket's local work branch (cut via <code>POST /api/tickets/:id/branch</code>; a local PR's default head)</li>
          <li>
            <code>completedAt</code> — when the ticket last became done (ISO), <code>null</code> while
            unfinished. Server-set on the status change; PATCHing it does nothing. Editing a done
            ticket keeps the original stamp; leaving <code>done</code> clears it
          </li>
          <li><code>comments</code> — discussion thread; append via <code>POST /api/tickets/:id/comments</code>, not PATCH</li>
          <li class="text-dimmed">
            GET adds derived <code>blocked</code> · <code>claimed</code> · <code>frontier</code> flags (not stored).
            <code>frontier</code> means takeable <em>here</em>: on a shared project the peer's tickets, and any
            ticket mid-ownership-transfer, are read-only and undispatchable on this machine, so they never read
            as frontier
          </li>
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
        <h2 class="mb-2 text-base font-semibold">Recently finished</h2>
        <p class="mb-3 text-sm text-muted">
          Moving a ticket to <code>done</code> stamps <code>completedAt</code>; moving it back out clears
          it. <code>?finished=true</code> returns done tickets newest-completion-first, and
          <code>?since=</code> narrows that to a window — the API behind the
          <NuxtLink to="/finished" class="text-primary hover:underline">Recently finished</NuxtLink>
          page, and the quickest way for an agent to write up what it landed today.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ finishedExample }}</code></pre>
      </section>

      <section>
        <h2 class="mb-2 text-base font-semibold">Comments</h2>
        <p class="mb-3 text-sm text-muted">
          Every ticket carries a discussion thread: <code>comments</code> —
          <code>{ id, author, body, createdAt }</code>, markdown bodies. Agents should read them
          before working a ticket (the human leaves direction there) and post their own under
          their name. Append-only via the endpoint — PATCH can't touch them; the final answer
          still goes in <code>resolution</code>.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ commentExample }}</code></pre>
      </section>

      <section>
        <h2 class="mb-2 flex items-center gap-2 text-base font-semibold">
          <UIcon name="i-lucide-git-pull-request-arrow" class="size-4 text-primary" />Local pull requests
        </h2>
        <p class="mb-3 text-sm text-muted">
          GitHub for your local: a PR is a <strong>ticket branch</strong> squash-merged onto the
          project's <strong>integration branch</strong> by jTicket itself — title, ticket, commits,
          description, destination and a merge button, no diffs (jDiff has those), nothing pushed.
          Exactly one ticket per PR; merging it is what moves the ticket to <code>merged</code>.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ localPrExample }}</code></pre>
      </section>

      <section>
        <h2 class="mb-2 flex items-center gap-2 text-base font-semibold">
          <UIcon name="i-lucide-radio" class="size-4 text-primary" />Live updates
        </h2>
        <p class="mb-3 text-sm text-muted">
          Every write lands in one JSON file, and <code>/api/stream</code> tails it — so a
          <code>PATCH</code> from an agent and a hand edit of the file both show up the same way. The
          browser follows this stream, which is why an open board keeps up without a refresh; the
          message carries no payload, because the client refetches the lists it already knows.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ streamExample }}</code></pre>
      </section>

      <section>
        <h2 class="mb-2 flex items-center gap-2 text-base font-semibold">
          <UIcon name="i-lucide-compass" class="size-4 text-primary" />Wayfinder mode
        </h2>
        <p class="mb-3 text-sm text-muted">
          Set a project's <code>mode</code> to <code>wayfinder</code> and the project is a
          <strong>map</strong> — its description is the map body. Tickets are wayfinder
          tickets — sub-type via a <code>wayfinder:&lt;research|prototype|grilling|task&gt;</code> label,
          claim by setting <code>assignee</code>, resolve by setting <code>status: done</code> + <code>resolution</code>.
          The board groups them into <strong>Frontier · In progress · Blocked · Resolved</strong>.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-4 text-xs leading-relaxed"><code>{{ frontierExample }}</code></pre>
      </section>
    </UContainer>
  </div>
</template>
