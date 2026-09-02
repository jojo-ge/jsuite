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
yourself, bug & vulnerability hunt) as a PR — the diff is just
`git diff <base>...<branch>` computed locally, so no GitHub round-trip is involved.

### Scopes — which changes the diff shows

A branch page has a **show** selector for which slice of the branch's changes
to render:

| scope | diff | notes |
| --- | --- | --- |
| `committed` (default) | `git diff <base>...<branch>` | what the branch adds on top of base — unchanged from before scopes existed |
| `staged` | `git diff --cached` | HEAD → index |
| `unstaged` | `git diff` | index → working tree |
| `everything` | `git diff <merge-base>` | merge-base → working tree: committed, staged and unstaged at once |

The three worktree scopes read the index and working tree, which belong to
whatever branch is checked out — so they're only offered (and only accepted by
the API) while the target branch IS the current branch. Untracked, non-ignored
files show up as adds in `unstaged` and `everything`; `git diff` alone would
skip them. Because the branch list also keeps the default branch when it's the
one checked out, "show me my uncommitted work" works straight off `main`.

The claude guidance tools run on the `committed` scope only: they key their
artifacts by branch and hand a session a `range=`/`head=` pair, neither of
which uncommitted work can supply. The other scopes keep the diff, full-file
expansion, file map and comments, and swap the tool bar for a note saying so.

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
jdiff branch                 # …the branch you're on right now
jdiff branch -s staged       # only what's staged (also: unstaged, everything)
jdiff open                   # open the repo's PR list
jdiff pr 123 --print         # print the URL only (no browser) — machine-readable
```

The repo is resolved from the current git working tree (override with
`--repo`/`-C`). The server base URL defaults to `https://jdiff.local` and is
overridable with `JDIFF_URL`. After `pnpm install` the `jdiff` bin is on the
package; `npm link` (or `pnpm link --global`) puts it on your PATH.

## How it works

- `server/api/prs.get.ts` — `gh pr list` in the repo's directory
- `server/api/diff.get.ts` — `git fetch origin +refs/pull/N/head:refs/jdiff/pr-N`
  then `git diff origin/<base>...refs/jdiff/pr-N`, parsed with `parse-diff` and
  highlighted server-side with `shiki`
- `server/utils/target.ts` — resolves a review "target" (a PR `?number=` or a
  local branch `?branch=&base=&scope=`) into the git args, per-side `git show`
  specs, head ref, and store key every shared route uses, so PRs and branches
  run through the same machinery. `scope` is deliberately not part of the
  store key: artifacts belong to the branch, not to a slice of it
- `server/utils/scopedGit.ts` — every `git diff`/`git show` for a target,
  including the untracked-file diffs a worktree scope needs
- `server/api/branch-*.ts` — local-branch endpoints: list branches, store/list/
  delete draft comments, and create a PR from a branch flushing its comments
- `server/api/tour-export.get.ts` — any saved tour as ONE standalone HTML file
  (`server/utils/tourExport.ts`): each stop's hunk on the left, the guide's
  note on the right, styles and highlighted code inlined. The ⤓ export html
  button on a review page exports the tour you are looking at; the chains list
  exports one chain each, and the hunt list one issue each. Nothing is fetched
  at view time, so the file can be handed to a developer who has neither jDiff
  nor the repo
- `bin/jdiff.mjs` — the CLI
