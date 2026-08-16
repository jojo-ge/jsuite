# jDiff

A local GitHub client that's really good at diffs. GitHub is only used to know
which PRs are open — everything else happens with your local tooling:

- **`gh`** lists open PRs and PR metadata (you must be logged in: `gh auth status`)
- **`git`** fetches `refs/pull/N/head` into your local clone and computes the
  diff against the merge-base — no GitHub diff API involved

## Usage

```sh
pnpm install
pnpm dev
```

Open the app, paste the path to a local clone (e.g. `~/code/my-repo`), and
you get the list of open PRs. Click one for a side-by-side, syntax-highlighted
diff. Recent repos are remembered.

## Comment mode

**☰ read all** (top right of any diff page) lists every comment on the change
in one reading column: where it sits, the diff line it hangs off, and the
comment itself — up to five lines, longer ones unfold on ▾ more.
Click a row to land on that line in the diff — the file reopens if you'd closed
it, and the line is marked so you can see where you arrived. Outdated comments,
which the diff can't show at all, are listed at the end. On a branch it lists
your local drafts instead.

## Local branch review (no PR needed)

From a repo's PR list, switch to **local branches** to review a branch against
the default branch before it's ever pushed. You get the same diff view, file
map, and claude guidance tools (reviewability, risk heatmap, guided tour, ask
yourself) as a PR — the diff is just `git diff <base>...<branch>` computed
locally, so no GitHub round-trip is involved.

Comments left on a branch are stored **locally** (under `<jSuite root>/.data/jdiff`). When
you're ready, **open a pull request** from the branch page: jDiff pushes the
branch, runs `gh pr create`, and posts every draft comment onto the new PR as
inline review comments in one shot, then drops you on the PR page.

## CLI (`jdiff`)

A small dependency-free CLI opens jDiff pages in the browser — handy to expose
to an LLM/agent so it can pull up a change for you:

```sh
jdiff pr 123                 # open the PR diff page for PR #123
jdiff branch my-feature      # review a local branch (against the default base)
jdiff branch my-feature main # …against an explicit base
jdiff open                   # open the repo's PR list
jdiff pr 123 --print         # print the URL only (no browser) — machine-readable
```

The repo is resolved from the current git working tree (override with
`--repo`/`-C`). The URLs it emits are `<base>/diffs/pr/<n>`, `<base>/diffs/branch`
and `<base>/diffs/prs` — the layer's own routes, which jDiff and every other
consumer serve alike. The base defaults to **`https://jticket.local`**: jTicket
extends the layer, so a review opened by the CLI lands on the board's port with
the tickets around it (TICK-143). `JDIFF_URL=https://jdiff.local` points it back
here. After `pnpm install` the `jdiff` bin is on the package; `npm link` (or
`pnpm link --global`) puts it on your PATH.

## How it works

jDiff *is* the `@jsuite/diff` Nuxt layer (`packages/diff`), which this app
`extends` — engine and UI both. Every route below is served on jDiff's port, and
on the port of any other jSuite app that extends the layer, against the same
`.data/jdiff` pool.

What stays in this app is the shell: seven two-line pages that mount the layer's
review screens on jDiff's short URLs, the `jdiff` CLI, and the scratch
prototypes. The layer serves the same screens at `/diffs`, `/diffs/prs`,
`/diffs/pr/<n>`, `/diffs/branch`, … — so `/prs` and `/diffs/prs` are the very
same `<DiffPrList>`, not two copies of it. Which scheme an app uses is one line
in its `app.config.ts`:

```ts
// apps/jdiff/app/app.config.ts — jDiff is nothing but reviews, so it takes the root
export default defineAppConfig({
  diff: { basePath: '', brand: 'jDiff' },
})
```

`useDiffRoutes()` reads that, and every link between review screens goes through
it. The table it returns is `diffRoutes(basePath)` from
`@jsuite/diff/routes` — a pure function, so a consumer's server code can build
the same links without app config (jTicket resolves attached diffs that way).

- `packages/diff/server/api/prs.get.ts` — `gh pr list` in the repo's directory
- `packages/diff/server/api/diff.get.ts` — `git fetch origin +refs/pull/N/head:refs/jdiff/pr-N`
  then `git diff origin/<base>...refs/jdiff/pr-N`, parsed with `parse-diff` and
  highlighted server-side with `shiki`
- `packages/diff/server/utils/target.ts` — resolves a review "target" (a PR
  `?number=` or a local branch `?branch=&base=`) into the git range, head ref,
  and store key every shared route uses, so PRs and branches run through the
  same machinery
- `packages/diff/server/api/branch-*.ts` — local-branch endpoints: list branches,
  store/list/delete draft comments, and create a PR from a branch flushing its
  comments
- `packages/diff/app/components/` — the review screens (`<DiffPrReview>`,
  `<DiffBranchReview>`, `<DiffPrList>`, …) and the parts they are built from
  (`<DiffFile>`, `<DiffFileNav>`, `<DiffFileGraph>`, `<DiffCommentList>`)
- `packages/diff/app/composables/` — `useDiffRoutes` (where the UI is mounted),
  `usePrArtifacts`, `useDiffAiTasks`, `useDiffNotifications`, `useDiffJump`
- `packages/diff/app/components/DiffReviewCard.vue` — one target at a glance,
  sized to embed in a host app's page rather than to be a screen
- `packages/diff/app/utils/` — the review vocabulary the server and the UI share
  (the rating shape, risk levels, tour shape, ask questions, file categories,
  the comment entry), auto-imported and importable as `@jsuite/diff/rating`,
  `@jsuite/diff/risk`, …
- `packages/diff/app/assets/css/diff.css` — the palette, scoped to
  `.diff-surface` / `.diff-overlay` so an app that only embeds a review screen
  keeps its own theme everywhere else
- `bin/jdiff.mjs` — the CLI
