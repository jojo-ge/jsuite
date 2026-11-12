# jTicket

A lean, local task tracker — **projects** and **tickets** with title,
description, acceptance criteria, and blocked-by edges — plus **docs**, draft
Confluence-style pages. It is **not connected to Jira or Confluence** and has no
relation to them. It exists so LLM skills (e.g. Matt Pocock's `to-tickets`, or the
local `to-jdoc`) can author a breakdown or a document *locally first*, for you to
review and edit before you author anything to Jira/Confluence by hand.

Built with Nuxt 4 + Nuxt UI 4. Data lives in a single human-editable JSON file at
`.data/jticket.json`.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:43000
```

`pnpm build && node .output/server/index.mjs` for a production run.

## Pages

| Route | What it shows |
| --- | --- |
| `/` | Board — every project and its tickets, plus docs and the backlog |
| `/prompts` | **Prompts** — the suite-wide hand-off prompt defaults every codebase and project inherits and can override |
| `/codebase` | **Codebase settings** — the selected codebase's worktree guide (how it does worktrees, and the branches connected to one) and its prompt overrides |
| `/projects` · `/projects/PROJ-1` | Project hub and project detail — the board (frontier cards with their hand-off and herdr buttons), overview, docs, pull requests, agents and loops tabs |
| `/docs` · `/docs/DOC-1` | Docs list and a doc's block document |
| `/graphs` · `/graphs/G-1` | **Graphs** — a menu of the codebase's graphs of plan, build and review projects, a card each; a graph's own page draws it, and a node opens its briefing and Move on (see **Graphs** below) |
| `/api-guide` | Full HTTP API reference, live in the app |

## Data model

- **Project** — `{ key: "PROJ-1", title, description, mode, repo, integrationBranch }`. Top-level grouping; contains tickets.
  - `mode`: `standard` (plain tracker) · `plan` (see **Plan mode** below — the `description` *is* the map body) · `todo` (a codebase's todo list, one per repo) · `predeploy` (suspected bugs reproduced before a deploy) · `prreview` (one GitHub PR, reviewed) · `planreview` (one plan's spec and ticket plan, reviewed before its builds run — `planReview: { planProjectId, runs }`, see **Graphs** below). The two review modes are record-only and live on the Reviews board. The UI shows the mode as the project's **type** and calls `standard` **Build**, `prreview` **Review** and `planreview` **Plan review** (wording only — `app/utils/projectType.ts`). The mode picks which prompt a ticket's herdr hand-off fires — `/jimplement`, `/jplan`, `/jreproduce`.
  - `repo` / `integrationBranch`: the optional GitHub link — see **GitHub** below. Both `""` when unset.
  - `integrationBase`: the branch the integration branch was cut from and the roll-up PR targets — `""` = the repo's default branch, or another build's integration branch when this build is **stacked** on it (see **Graphs** below).
- **Ticket** — `{ key: "TICK-1", title, description, acceptanceCriteria[], type, status, projectId, assignee, labels[], resolution, blockedBy[], completedAt }`
  - `projectId`: the parent project; `null` = backlog
  - `type`: the kind of work — `story` (user-facing slice of value) · `task` (technical work) · `bug` (something broken) · `review` (review code/PR/doc) · `verification` (confirm something works — QA, acceptance, post-deploy check) · `research` (investigate; output is knowledge) · `decision` (a choice to make/grill out) · `docs` (write/refresh documentation). With no `type`, mode labels / the project mode pick one: `review:finding` / predeploy projects → `bug`, else `task`.
  - `status`: `todo` · `in_progress` · `done`
  - `assignee`: free-form name of who is working on it — agents self-assign by name; `""` = unassigned. Filter with `GET /api/tickets?assignee=<name>`. In plan terms, the assignee **is** the claim.
  - `labels`: free-form strings, plus the **tags**: exactly one of `afk` (agent-runnable) or `hitl` (needs a human; gets its own herdr tab) — the server adds `afk` when neither is sent — and optional `prototype` (throwaway work that must never ship; combines with any type). Filter with `GET /api/tickets?label=<label>`. Legacy writes (`"type": "AFK"|"HITL"`, `wayfinder:<sub-type>` labels) are still accepted and folded into this shape; `./jsuite setup` migrates stored tickets.
  - `resolution`: the answer recorded when the ticket resolves (GFM markdown); `""` until then.
  - `blockedBy`: ids of tickets that must finish first
  - `completedAt`: ISO timestamp of when the ticket last became `done`; `null` while unfinished. **Set by the server on the status change, never by the caller** — PATCHing it is ignored. Re-saving an already-done ticket keeps the original stamp, so fixing a resolution doesn't move it up the `?finished=true` order; moving a ticket out of `done` clears it, and moving it back stamps afresh. Tickets finished before the field existed were backfilled from `updatedAt`.
  - `plannedFor`: on a Plan project's ticket-plan **draft**, the id of the proposed build node it will move into; `null` on every other ticket. A draft is off the frontier and never dispatched.
  - `sentBack`: on a review finding sent back to its build, `{ ticketId, ticketKey, projectId, at }` — the fix ticket it became.
  - GET responses also attach derived booleans **`blocked`**, **`claimed`**, **`frontier`** (never persisted). `frontier` means takeable *here*: on a shared project a ticket the peer owns, or one mid-ownership-transfer, is read-only and undispatchable on this machine, so it never reads as frontier.
Every `description` / `resolution` field is **plain GFM markdown** and is
rendered as such in the UI (via the shared `@jsuite/documents` renderer). Card
summaries are the exception — they show a flattened plain-text preview so the
line clamp stays honest.

- **Graph** — `{ key: "G-1", title, description, repo, nodes[], edges[] }`: plan,
  build and review projects passed along in order. See **Graphs** below.

- **Ids** — every record above also has an `id`, a bare UUIDv7
  (`server/utils/ids.ts`) that stored references use; the key is for people.
  Every `:id` route takes either, and an id from before the UUID migration
  (`tick_…`) still resolves through `.data/jticket/id-migration.json`.

- **Known repo** — `{ path, slug, defaultBranch, lastUsedAt }`. Not a tracker
  record: the list of clones jTicket has been pointed at, so setting up the next
  project is a click. See **GitHub** below.

- **Doc** — `{ key: "DOC-1", title, documentKey, projectId, labels[], status }`.
  A tracker record wrapping a **block document** in the shared jSuite document
  system (`@jsuite/documents`; files in the root `.data/jexplain/` pool, which
  the reader at `/e/<documentKey>` renders and the library at `/e` lists).
  Shown at the top of the board and at `/docs/DOC-1`.
  - Content is authored as **blocks** (prose, callout, code, diff, chart, image,
    steps, compare, timeline, takeaway + glossary — the vocabulary the
    `j-explain` skill documents).
    `POST /api/docs` with `blocks` creates the document; `documentKey` links an
    existing one; `PATCH` with `blocks` rewrites it (notes survive). Full
    reference at **/api-guide** in the running app.
  - `status`: `draft` · `ready`
  - Images are `image` blocks — `{ type: "image", file }` (a local path) or
    `{ type: "image", base64 | dataUrl, name }` (inline bytes); the server copies
    them into `.data/jexplain/media/<documentKey>/` and serves them at
    `/api/media/<documentKey>/<file>`. The doc page's
    **Add image** button (or a paste / drop onto the page) appends one.

- **Images in ticket markdown** — descriptions, resolutions, comments (and
  project descriptions) render GFM, so a picture is `![alt](/attachments/<name>)`.
  Upload with `POST /api/attachments` — `{ name, base64 }` (bare base64 or a
  data: URL; `dataUrl` is a synonym) or `{ file, name? }` (a local path) — and
  embed the `markdown` it returns. In the UI, paste or drop an image into any of
  those fields, or click **Attach image**. Files live in
  `.data/jticket/attachments/`, outside the document pool (a document's
  `/api/media` paths can't reach them — hence image blocks for docs). Same name overwrites; the UI prefixes a timestamp.

## HTTP API

See **/api-guide** in the running app. Summary:

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/projects` | List / create projects |
| GET/PATCH/DELETE | `/api/projects/:id` | Read / update / delete a project (id or key) |
| GET/POST | `/api/tickets` | List (`?projectId=`, `?status=`, `?finished=true`, `?since=`) / create tickets |
| GET/PATCH/DELETE | `/api/tickets/:id` | Read / update / delete a ticket (id or key) |
| POST | `/api/import` | Bulk-create a whole breakdown at once |
| GET/POST | `/api/docs` | List (`?projectId=`, `?status=`, `?label=`) / create docs |
| GET/PATCH/DELETE | `/api/docs/:id` | Read / update / delete a doc (id or key) |
| GET/POST | `/api/attachments` | List / upload attachments (`{ name, base64 }` or `{ file }`) for ticket markdown |
| GET | `/api/stream` | SSE — one message per store revision (see **Live updates**) |
| GET/POST, GET/PATCH/PUT/DELETE | `/api/graphs`, `/api/graphs/:id` | Graphs: list (`?repo=`) / create; one graph (id, `G-n` or a member project key), rename, save its whole shape, delete (see **Graphs**) |

### Bulk import (recommended for skills)

`POST /api/import` authors an entire breakdown in one call. Reference each ticket's
`project` by **title or key**, and `blockedBy` by ticket **title or key** — generated
ids are resolved for you after everything is created. `projects` is optional.

```bash
curl -s http://localhost:43000/api/import -H 'content-type: application/json' -d '{
  "projects": [{ "title": "Checkout", "description": "Everything payments-related" }],
  "tickets": [
    { "title": "Add cart schema", "description": "Persist a cart.", "type": "task", "labels": ["afk"],
      "project": "Checkout", "acceptanceCriteria": ["Survives refresh"] },
    { "title": "Cart UI", "description": "Edit quantities.", "type": "story", "labels": ["hitl"],
      "project": "Checkout", "blockedBy": ["Add cart schema"] }
  ]
}'
```

## Live updates

The store is a single JSON file, so `GET /api/stream` just tails it and pushes a
message whenever it changes — a `PATCH` from an agent and a hand edit of
`.data/jticket/jticket.json` are the same event:

```
curl -N http://localhost:43000/api/stream
data: {"kind":"hello","revision":7}
data: {"kind":"change","revision":8}
data: {"kind":"ping"}
```

The message carries no payload — the revision is a change *signal*, not a
cursor, and it resets when the server restarts (so a second `hello` means
"refetch, you may have missed something"). The browser follows this stream and
refetches, which is why an open board keeps up with an agent working through an
project without a refresh. Tickets that moved ring themselves for a few seconds and
raise a toast; the sidebar dot says whether the stream is actually connected.

## GitHub

A project can point at a **local clone** (`repo` — a path, `~` allowed) and own an **integration branch**: an *empty*
branch cut from its base — the repo's default branch, or the integration branch
of a build it stacks on — that the project's PRs target, and which lands as one
roll-up PR when the project is done. Both are edited on the
project form; nothing here needs a GitHub token — it shells out to the `git` and
`gh` you already have (`gh auth status`).

### Pointing a project at a repo

Three ways in, on the project form: pick one of the **repos you've used before**,
**Browse…** (a native folder dialog, macOS), or type the path. Whatever lands in
the field is checked as you type (`GET /api/repos/probe`) and the form tells you
what it found — `jojo-ge/jsuite · default branch master`, or why the path is no
good.

The remembered list lives in the store (`repos[]`), not in browser storage, so
agents on the HTTP API see it too. A repo is remembered the moment a project
points at it; `GET /api/repos` returns each with its slug, default branch,
whether the path still exists, and which projects use it, and
`DELETE /api/repos?path=…` forgets one (the list only — projects and disk are
untouched).

The project header carries the branch: a **Branch** button while the project has
a repo but no integration branch (one click — same call as below), which becomes
a menu entry opening its **Diff** tab once it exists.

The project page's **Overview** tab manages the integration branch, under the
description:

- **Cut the branch** — `POST /api/projects/:id/integration-branch` runs
  `git branch <name> origin/<default>` + `git push -u origin <name>` and records
  the name on the project. It is idempotent: a branch that already exists (yours
  or cut by hand) is *adopted*, not re-cut. The default name is
  `proj/<KEY>-<title-slug>`; pass `{ "branch": "...", "base": "..." }` to override.
- **Or adopt one that already exists** — *use an existing branch* opens a search
  over every branch in the repo, local and on origin
  (`GET /api/projects/:id/branches?q=`, matching branch names *and* commit
  subjects, newest tip first; ↻ does a `git fetch --prune` first so a branch a
  teammate pushed a minute ago shows up). Picking one just sets
  `integrationBranch` — nothing is created or pushed. The same search sits
  behind the 🔍 on a project that already has a branch, for repointing it.
- **Its worktree** — the **Connect worktree** card (below) sits under the
  branch.

The **Pull requests** tab lists the project's PRs, and carries the **roll-up
PR** button (below):

- **The PR list** — `GET /api/projects/:id/github` returns the repo's open PRs
  that belong to this project, matched three ways:

  | Match | Meaning |
  | --- | --- |
  | `integration` | the PR whose **head** is the integration branch — the project's roll-up PR, listed first |
  | `base` | the PR **targets** the integration branch |
  | `key` | the PR's head branch or title names one of the project's keys (`PROJ-3`, `TICK-12`) — so work that went straight to the default branch still shows up |

  Every row links to the project's **Diff** tab on that PR, and to **github.com**.

`gh` is best-effort: without it (offline, not logged in, no GitHub remote) the
branch side still works and the PR list reports why it's empty.

### The Diff tab

A project's **Diff** tab is the side-by-side diff viewer (it replaced jDiff and
the old Branches tab): a file list, syntax-highlighted rows built server-side,
the hidden context between hunks expandable in place, and a full-file view. It
shows one **target**, named in the page's query, so every "see the changes"
link — ticket cards, local and GitHub PR rows, the integration branch — opens it
on the right one (`app/utils/diffTarget.ts`, `diffTabUrl`):

| Query | Diffs |
| --- | --- |
| *(none)* | the project's own branch: the integration branch vs its base — the default branch, or for a stacked build the slice base, so only its own work shows (`target.baseLabel` names the upstream branch); a PR review project's `jreview/pr-<n>` vs its base |
| `?pr=PR-n` | a local PR: its ticket branch vs the integration branch; once merged, the squash commit vs its parent |
| `?gh=<n>` | a GitHub PR: its head (fetched into `refs/remotes/jticket/pr-<n>`) vs its base |
| `?head=…&base=…` | any two refs — a ticket branch with no PR yet (`base` defaults to the integration branch) |

`GET /api/projects/:id/diff` (same params) answers `{ target: {kind, label, head,
base, headOid, baseOid}, files }` — the diff is three-dot (merge-base → head,
as GitHub shows it) and cached per commit pair; `GET /api/projects/:id/diff/file?oid=&path=`
is one file at a commit, highlighted, for the gaps and the full view. Rows are
built in `server/utils/diffBuild.ts` (parse-diff) and highlighted in both
themes by `server/utils/diffHighlight.ts` (the same shiki the documents package
uses). The PR-list fields `diffUrl` carry these links as jTicket paths.

**File filters and sort.** The file list's chips narrow the diff to kinds of
file — **Source**, **Tests**, **Docs**, **Config**, **Generated** (lockfiles,
snapshots, vendored code) and **Assets** — one chip per kind the diff holds,
any number picked at once (none = everything); the files shown follow the
chips, not just the list. The order menu sorts by path (git's order) or by line
churn — **Most churn** (added + removed), **Most added**, **Most removed** — to
put the most affected files first; the order is remembered per browser. A kind
is read off the path alone (`fileKind` in `app/utils/diffFiles.ts`): anything
under a tests directory is a test, and what nothing claims is source. A tour
stop in a hidden file clears the chips.

**Guided tours.** A target can carry a tour: an overview plus 20–40 ordered
stops at the lines that matter, for the human reading the diff (nothing hands
tours to reviewers). **Build tour** dispatches one Opus `/jdiff-tour` session
into the project's herdr workspace, in its own `PROJ-n · tour …` tab and
without taking focus; it reads the target's exact commits and POSTs the tour
back. The floating tour bar walks it: ← → (or n / p) and esc, a resume point
per browser, and `?stop=i` links (the overview's stop list uses them); a stop
on unchanged code expands its gap, or opens the full file, to show itself.
Tours live in `.data/jdiff/tours.json` (the store the retired jDiff app
kept), keyed by target (a GitHub PR's number, `branch/<name>`, `PR-n`), so
detail tours saved before the move still walk. Only the detail tour survived:
the overview and chain tours the old app left stay in the file, never shown. Logic: `server/utils/tours.ts`, `tourStore.ts`,
`tourJobs.ts` (the run in flight, and why the last one failed);
`app/composables/useTourWalk.ts`. Endpoints, each taking the target's params:
`GET|POST|DELETE /api/projects/:id/diff/tour` (read / build / cancel), and the
session's `POST …/diff/tour/artifact` and `POST …/diff/tour/complete`.

### Local pull requests

GitHub for your local: single-ticket review happens entirely on the machine, and
only the integration branch ever talks to origin. A **local PR** is a store
record (`prs[]`, `PR-n` keys) — title, description, one ticket, head branch,
base branch, lifecycle — over the project's repo; git holds the code, jTicket
holds the story. Each row links to its diff on the project's **Diff** tab.

The loop, per ticket:

1. **Cut the ticket branch** — `POST /api/tickets/:id/branch` cuts
   `tick/<TICK-n>-<slug>` off the integration branch, **local only**, and records
   it on the ticket (`ticket.branch`). A board's hand-off does this automatically
   when you copy a "Local PR" hand-off prompt, and bakes the branch name into the
   prompt.
2. **Open the PR** — `POST /api/prs { ticket }` (agents) or the *New local PR*
   button. One ticket per PR, one open PR per ticket; the title defaults to
   `<TICK-n> <title>` and the description becomes the squash commit body.
3. **Merge** — the button, or `POST /api/prs/:id/merge`. A **squash** onto the
   integration branch done with plumbing (`merge-tree` → `commit-tree` →
   `update-ref`, git ≥ 2.38): no checkout, your working tree is never touched,
   whatever you're mid-way through. On success the ticket branch is deleted and
   the ticket moves to **`merged`** (a fourth status; `done` and `merged` both
   count as finished everywhere). If the integration branch happens to be checked
   out *clean*, that checkout is fast-forwarded; checked out *dirty* refuses.
   One exception to the squash: a PR whose branch carries upstream
   (`origin/HEAD`) commits the integration branch lacks — a "catch up with
   master" PR — lands as a real two-parent merge, so upstream stays an ancestor
   and GitHub doesn't count upstream's changes as the branch's own. The response
   says which way it went (`mergedAs: "squash" | "merge"`).
4. **Conflicts refuse cleanly** — the repo is left exactly as it was, the PR
   turns `conflicted` with the file list on the row. Rebase the ticket branch
   onto the integration branch, then hit merge again.
5. **Roll up** — the Pull requests tab's *Open roll-up PR* button
   (`POST /api/projects/:id/integration-pr`) pushes the integration branch to
   origin — the only remote write in the flow — and then opens, or finds, the
   one real GitHub PR, integration branch → its base (the default branch, or
   the upstream build's integration branch when stacked), via `gh`.

The project page's *Pull requests* tab shows both lists: **Local pull
requests** (with per-PR commit fold-outs, merge/close buttons) above **On
GitHub** (the read-only `gh pr list` view, usually just the roll-up).

### Review tab

The project page's **Review** tab runs the review engine over the project's
branches and turns what it finds into tickets **in this project**. The rule
(`app/utils/reviewFindings.ts`): every review belongs to a project — starting
one without a project is refused, and nothing is ever split into a new
project — and its findings are always tickets on that project's board.

- **Start review** — `POST /api/projects/:id/reviews { branch?, base?, reviewers? }`
  starts a review on the engine (`POST /api/reviews`'s `createReview`) with
  `project: <KEY>`. The branch
  defaults to the integration branch (a branch only on origin is
  `origin/<name>`), the target to the branch's PR base else the default branch
  (a stacked build's own branch: its slice base, so reviewers read only its work),
  and 1–4 Opus reviewers (default 4) run in herdr, then a triager merges their
  findings. When triage lands, jTicket opens the browser on this tab
  (`?tab=review&review=<key>`).
- **Follow it** — `GET /api/projects/:id/reviews` lists the project's reviews
  (the ones this tab started, plus the auto loop's consensus reviews,
  read-only); `GET /api/projects/:id/reviews/:key` is one of them whole. The tab
  polls while a review is in flight. Reviewer and triage reports are
  documents in the shared pool and open inline. Retry/skip a reviewer or retry
  the triager with `POST /api/projects/:id/reviews/:key/action
  { action: 'retry-reviewer' | 'skip-reviewer' | 'retry-triage', n? }`.
- **Add findings as tickets** — tick findings and press *Add N to <KEY>*:
  `POST /api/projects/:id/reviews/:key/tickets { findingIds }` files
  one AFK `bug` ticket per finding (labelled `jreview`, `review:finding`,
  `severity:*`, `category:*`) into this project. The engine records each finding's
  ticket key, so a finding is never added twice and the rest can be added
  later. A review belongs to one project, and every route checks it.
- **A PR review project's findings file themselves** — its agreement reviews
  have no Add button: when the consensus session hands the verified findings
  back (`POST /api/reviews/:key/findings`), the server files each one on the
  project as a **record-only** ticket (HITL `bug`, labels `review:finding`,
  `severity:*`, `category:*`, `scope:*`, `verdict:*`; `ticket.finding` keeps
  the review, file, line, scope and verdict). A rerun matches the project's
  open finding tickets — the ticket the session named, else the same title on
  the same file, else a reworded title on the same file in the same category —
  and updates them instead of filing duplicates (conservative on purpose: a
  wrong match rewrites another defect's ticket). Record-only means no hand-off: the board lists them under
  *Review findings* with no copy/herdr buttons, the ticket form shows no
  hand-off prompt, they are never frontier (board, `?frontier=true`), Run all
  and One session leave them out, and
  every dispatch path answers 409 (`isRecordOnly`). A PR review project's
  Review tab never starts a triage review — Start review there is its PR's
  agreement review.
- **Post to PR picks finding tickets** —
  `POST /api/projects/:id/reviews/:key/pr-comments { ticketKeys, body }` posts
  one COMMENT review under your `gh` login: a ticket whose file and line are a
  line the PR changes goes inline, the rest in the body, and each posted
  ticket is stamped (`finding.postedAt`, label `pr:posted`). A finding that
  isn't a ticket yet can't be posted.

### Herdr dispatch

When the [Herdr](https://herdr.dev) server is running, the hand-off prompts on a
board don't have to go through the clipboard — each ticket card and the "Merge N PRs" button
grows a **herdr** twin that builds the terminal itself over Herdr's socket CLI
(`server/utils/herdr.ts`):

- one Herdr **workspace per project** — label = the project title, cwd = the
  repo (created on first dispatch);
- ticket agents as **panes, packed up to four per tab**, tabs labelled with the
  project key (`PROJ-2`, then `PROJ-2 · 2`, …), each pane running `claude` with
  the same hand-off prompt the copy button would have copied (the ticket branch
  is cut first, exactly like copying);
- merge sweeps as their **own single-pane tab** (`PROJ-2 · merge`), one agent
  working through the PR queue;
- **nothing steals focus** — every create/split passes `--no-focus`. Moving over
  is explicit: the group-header **herdr** button focuses the project's
  workspace, and per-tab chips (with agent-status dots) focus individual tabs
  via `POST /api/herdr/focus`.

All of it degrades: no `herdr` binary or no running server and the buttons
simply don't render (`GET /api/herdr` → `available: false`). If the binary
lives somewhere unusual, point `HERDR_BIN` at it.

### Codebase worktrees

Every codebase does worktrees differently — deps, env files and secrets, ports
two worktrees would fight over, a script of its own — so jTicket doesn't guess:
it asks the codebase, and keeps the answer as the codebase's **worktree guide**
(`/codebase` → Worktrees; `server/utils/worktrees.ts`).

1. **Kickoff.** *Run kickoff in herdr* fires the `worktree:kickoff` prompt into
   a HITL tab in the codebase's workspace. The agent reads the repo, asks you in
   its pane for what the repo can't say, proves the recipe on a throwaway
   worktree, and `PUT`s the guide to `/api/repos/worktree?repo=` — markdown
   `body`, the `root` worktrees go under, and the `sources` it rests on, hashed
   at save so a changed lockfile or `CLAUDE.md` turns the guide **stale**.
2. **Consumers.** Everything that makes a worktree `GET`s the guide first:
   `/jimplement`, `/jreproduce`, the review engine (its reviewer checkouts go under the
   guide's `root`), and the connect prompt. Agents take the cheapest form the
   guide offers that fits the ticket (a slim/test-only worktree for tests, lint
   and typecheck; the full one only when the app must run) and tear it down,
   forced, as soon as the PR is open — the branch carries the commits.
4. **After the merge.** `POST /api/prs/:id/merge` deletes the head branch
   unless a worktree still has it checked out, in which case the answer names
   it as `headWorktree`; the merge sweep's prompt then tears that worktree
   down the guide's way and deletes the branch, so nothing outlives its merge
   into the integration branch. The review watcher removes its own reviewer
   checkouts once a finished review's panes close.
3. **Connect.** Once a guide exists, the integration branch's row on the
   project's GitHub panel shows **Connect worktree**: it fires
   `worktree:connect`, whose agent checks the branch out the guide's way (or
   adopts the worktree it's already in), sets it up and `POST`s the link to
   `/api/projects/:id/worktree`. "Linked" is re-checked against
   `git worktree list` on every read, and the row refreshes itself when the
   agent writes. Keep that worktree clean — local PR merges reset it to each
   squash commit and refuse while it's dirty.

Guides and links live on the codebase (`store.repos`), machine-local, never
synced. Forgetting a codebase forgets them too.

### Hand-off prompts

Every hand-off — dispatched or copied — is one string built from a template,
and which template resolves through five layers, first answer winning:

```
ticket.prompt (promptMode 'append' | 'replace')     the ticket's own text
  → project.prompts[kind]                           the project page's Prompts panel
    → repo.prompts[kind]                            /codebase, PATCH /api/repos?path=
      → store.promptDefaults[kind]                  /prompts, GET/PATCH /api/prompts
        → the built-in text                         app/utils/prompts.ts
```

There are twelve **kinds**, each picked by what fires it — the three
`standard:*` PR targets of the hand-off picker, `standard:decision` (a HITL
`decision` ticket on a standard board: a `/grilling` interview in its herdr
pane, no branch and no PR, whatever the picker says), the board's `batch` session,
`plan`, `todo`, `predeploy`, the project-level `merge` sweep,
`worktree:connect` and `runplan:build`, and the
codebase-level `worktree:kickoff` (see **Codebase worktrees**).
A kind is stored only when overridden, so an untouched jTicket fires exactly
the strings it always has (`tests/prompts.test.ts` pins them).

Templates interpolate `{key}`, `{title}`, `{branch}`, `{onBranch}`,
`{projectKey}`, `{projectTitle}`, `{repo}`, `{integrationBranch}`,
`{worktreeGuide}` (the codebase's worktree guide URL) and — for the sweep —
`{prs}`; an unknown placeholder is left standing rather than blanked,
so a typo shows up in the prompt instead of vanishing from it. A ticket's own
box takes placeholders too, and keeps its text when you switch back to "use the
project prompt", so a draft survives.

Overrides are **machine-local**, like `repo` and the ticket branches: they say
how *this* machine dispatches agents, not what the work is. They never ride the
sync wire, they don't travel in a project bundle, and they stay editable on
both sides of a shared project.

## Plan mode

Set a project's `mode` to `plan` and it becomes a home for a plan's map — the way `/jplan` charts work too big for one session. (The mode was called `wayfinder` before the rename; the API still reads that as `plan`.) The mapping:

| Plan concept | jTicket |
| --- | --- |
| Map | the project's **description** (the map body: Destination / Notes / Decisions / Fog / Out-of-scope) |
| Ticket | a **ticket** under that project; body = the question |
| Ticket sub-type | the ticket **`type`**: research → `research`, prototype → `research` + the `prototype` tag, grilling → `decision`, task → `task` |
| AFK / HITL | the **`afk` / `hitl` tag** in `labels` |
| Blocking | **`blockedBy`** |
| Claim | set **`assignee`** (an assigned ticket leaves the frontier) |
| Frontier | `GET /api/tickets?projectId=<project>&frontier=true` — todo + all `blockedBy` done + unassigned + takeable on this machine, key-ordered |
| Resolve | set `status: "done"`, fill **`resolution`**, add a gist to the map's *Decisions so far* |

In the UI, **every** project — plan or standard — renders its tickets grouped into **Frontier · In progress · Not takeable here · Blocked · Resolved**, key-ordered within each group, with frontier tickets ring-highlighted. *Not takeable here* holds the peer's open work and anything frozen mid-ownership-transfer, so it is only ever non-empty on a shared project; empty groups aren't rendered, so a local-only board still reads as the four it always did. What a wayfinder project adds on top is the map body (behind the board's Brief button); every card carries its type badge.

**Authoring a whole map** via `POST /api/import`: give the project `"mode": "plan"` and a map-body `description`, and each ticket its `type` and agency tag — e.g.:

```jsonc
{
  "projects": [{ "title": "Rive Story Assets", "mode": "plan", "description": "## Destination\n…" }],
  "tickets":  [{ "title": "Choose the runtime", "project": "Rive Story Assets", "type": "research", "labels": ["afk"] }]
}
```

## Graphs

A project is a slice of work a person can review in one sitting; a **graph**
is how a larger piece of work is cut into such slices and handed along — plan →
builds → reviews, in any combination (`app/utils/graphs.ts`,
`server/utils/graphs.ts`). It is stored (`store.graphs`, key `G-n`,
machine-local — never synced): **nodes**, each a project or a **proposed** one
(a mode, title and `note`, no project yet), joined by directed, acyclic
**edges**. A project sits in at most one node of one graph; deleting it turns
its node back into a proposed one. Cross-project ticket blockers are plain
ticket facts and make no graph.

- **The pages**: the menu (`/graphs`, `GraphCard.vue`) shows each of the
  codebase's graphs as a card — its type chain, progress, where it is now, a
  thumbnail of its shape, when it last changed — and creating a graph starts
  there. A graph's page (`/graphs/G-n?node=<nodeId>`, `GraphCanvas.vue`; a
  member project's key and the old `/graphs?g=G-n` redirect to it) draws it in
  layers and lists every node in detail: each node's type, project status
  (tickets done/total, running), outcome report, whether it was moved on into,
  and each build's **slice size** (files, lines added/removed against its
  base). Create a graph, add a node (an existing project or a proposed one),
  draw or remove edges, rename, delete (projects are untouched). The
  whole-shape save (`PUT /api/graphs/:id`) answers `problems` like a run plan.
- **No hard gates.** Clicking a node opens its **briefing**
  (`GraphBriefing.vue`, `GET /api/graphs/:id/nodes/:nodeId/briefing`): every
  upstream's tickets and running work, roll-up PRs and CI, review verdicts and
  open findings, whether an integration branch is behind its base or has
  unpushed commits, the base a build would start from — and `flags`, which
  only warn. A slice over 30 files or 800 lines is flagged large: split it
  into stacked builds. **Move on** (`POST …/nodes/:nodeId/enter {note?,
  stackOn?}`) always works and starts nothing: it creates a proposed node's
  project (a Review node gets the upstream build's open roll-up PR attached),
  records the stacking choice, and keeps the briefing on the node. A project
  whose node wasn't entered still runs; its page shows the graph strip
  (`ProjectGraphStrip.vue`, `GET /api/projects/:id/graph`) and the briefing as
  a banner with Move on.
- **Stacked builds.** A build may stack on one upstream build: its
  `integrationBase` is that build's integration branch, its roll-up PR targets
  it, and the Diff tab, slice size and Review tab measure from where the two
  meet, so it shows only its own work. The Overview card's **Sync from
  upstream** (`POST /api/projects/:id/integration-branch/sync`) fetches and
  merges the base in locally — never a rebase, never a push; once the upstream
  was squash-merged it merges what that merged into, makes it the base and
  retargets the open roll-up PR. A conflict moves nothing and lists the files.
  `GET /api/projects/:id/integration-branch` is the state behind the card
  (`app/utils/stacking.ts`, `server/utils/integrationBase.ts`).
- **Ticket plan.** A Plan project's **Ticket plan** tab
  (`ProjectTicketPlan.vue`) turns the finished map into builds: **Draft ticket
  plan** (`POST /api/projects/:id/ticket-plan/build`) dispatches one Fable 5.2
  `/jplan-to-jtickets` session that writes the spec as a doc, drafts the build
  tickets on the plan (`plannedFor` = the proposed build node), and proposes
  the graph's builds — each sized as a reviewable slice — with a Review after
  each non-trivial one. Drafts are record-only and editable in the tab.
  **Approve** (`POST …/ticket-plan/approve`) creates the build projects and
  moves the drafts in; it starts and enters nothing.
- **Plan review.** A plan review project (mode `planreview`; the create
  modal's **Plan review** type, `POST /api/projects {mode: "planreview",
  plan}`, or Move on into a proposed plan review node, which points it at the
  plan before it) reviews one plan before its builds run. Its Review tab's
  **Start review** (`POST /api/projects/:id/reviews {reviewers?}`,
  `startPlanReview` in `server/utils/planReview.ts`) runs one agreement review
  whose subject is the plan — no branch, worktree or diff: 2–4 reviewers run
  `/jplan-review` over the plan's map, resolutions, docs, ticket plan and the
  code, `/jreview-consensus` keeps what they all raised, and the findings land
  as record-only tickets. It is refused while the ticket plan is being drafted
  and for a plan with nothing to read. One with no plan yet picks it on its
  Review tab (`POST /api/projects/:id/plan-review {plan}`).
- **Send back.** The Review tab's **Send back**
  (`POST /api/projects/:id/findings/send-back {ticketKeys}`) turns the picked
  finding tickets into tickets where they get fixed: from a review directly
  after a build, AFK `bug` tickets on the build; from a plan review, HITL
  `decision` tickets on its plan, in a graph or not (`review:sent-back`; the
  finding records it in `sentBack`). Fix or decide them there, then **Rerun
  review**.

## Pointing the `to-tickets` skill here

When the skill asks where to publish, tell it: **publish to the local jTicket app
via `POST http://localhost:43000/api/import`** instead of Jira. It maps cleanly:
skill "tickets" → tickets, "blocked by" → `blockedBy` (by title), AFK/HITL → the `afk`/`hitl` tag in `labels` (plus a `type` per ticket),
parent → `project`.

## The `to-jdoc` skill

The companion `/to-jdoc` skill (bundled at `.claude/skills/to-jdoc`) teaches an LLM to
draft docs here via `POST /api/docs` — a spec, a design note, any page — including the
block-document format and the format every ticket and project field takes. For a spec it
pairs with Matt Pocock's `/to-spec`, which decides what the document says — `to-jdoc` covers
how it is written and where it lands. Documents are drafts only — review them at
`http://localhost:43000/docs`, then copy into Confluence by hand if and when you want them
there.
