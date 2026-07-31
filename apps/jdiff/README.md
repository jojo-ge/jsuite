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
`--repo`/`-C`). The server base URL defaults to `https://jdiff.local` and is
overridable with `JDIFF_URL`. After `pnpm install` the `jdiff` bin is on the
package; `npm link` (or `pnpm link --global`) puts it on your PATH.

## How it works

- `server/api/prs.get.ts` — `gh pr list` in the repo's directory
- `server/api/diff.get.ts` — `git fetch origin +refs/pull/N/head:refs/jdiff/pr-N`
  then `git diff origin/<base>...refs/jdiff/pr-N`, parsed with `parse-diff` and
  highlighted server-side with `shiki`
- `server/utils/target.ts` — resolves a review "target" (a PR `?number=` or a
  local branch `?branch=&base=`) into the git range, head ref, and store key
  every shared route uses, so PRs and branches run through the same machinery
- `server/api/branch-*.ts` — local-branch endpoints: list branches, store/list/
  delete draft comments, and create a PR from a branch flushing its comments
- `bin/jdiff.mjs` — the CLI
