import { fileURLToPath } from 'node:url'

// @jsuite/diff — the diff-review engine AND its UI, as a Nuxt layer.
//
// Everything jDiff knows about reviewing a change lives here; the app on top is
// a shell that aliases the same screens onto shorter URLs. A consumer that
// `extends: ['@jsuite/diff']` (plus the workspace dep) gets:
//
//   pages — the complete review UI, namespaced under /diffs:
//     /diffs                     the repo picker
//     /diffs/prs                 open pull requests in ?repo=
//     /diffs/pr/<n>              the PR diff, comments, tour, asks
//     /diffs/pr/<n>/summary      that PR's guidance artifacts
//     /diffs/branches            local branches in ?repo=
//     /diffs/branch              a local branch diff (?branch=&base=)
//     /diffs/branch-summary      that branch's guidance artifacts
//
//   components — the same screens, to mount anywhere else:
//     <DiffHome> <DiffPrList> <DiffPrReview> <DiffPrSummary>
//     <DiffBranchList> <DiffBranchReview> <DiffBranchSummary>
//     and the parts they are built from: <DiffFile> <DiffFileNav>
//     <DiffFileGraph> <DiffCommentList> <DiffAuthorAvatar>
//     <DiffNotificationBell> <DiffScrollTopButton>
//     plus <DiffReviewCard>, one target small enough to embed in a host app's
//     page — what jTicket puts on a ticket that has a diff attached
//
//   composables — useDiffRoutes (where this app mounts the UI — see
//     app/app.config.ts; the table itself is diffRoutes() in app/utils, so
//     server code can build the same links), usePrArtifacts,
//     useDiffAiTasks/useDiffAiTasksHub, useDiffNotifications, useDiffJump
//
//   /api/diff, /api/file, /api/graph, /api/prs, /api/pr, /api/branches,
//     /api/repo, /api/open, /api/pick-folder — the diff/target routes
//   /api/comment(s), /api/branch-comment(s), /api/rating, /api/risk,
//     /api/tour, /api/ask(s), /api/ask-yourself*, /api/notifications — the
//     review artifacts
//   /api/analyze-generate, /api/ai-jobs, /api/ai-job-cancel — the claude
//     analysis runs (streamed over SSE, driven through @jsuite/claude)
//   every server util as a Nitro auto-import: resolveTarget/prepareTarget,
//     run/resolveRepoPath, buildDiff, highlight, and the artifact stores
//   the review vocabulary shared by server and UI, auto-imported as app utils
//     and importable explicitly: '@jsuite/diff/rating', '/risk', '/tour',
//     '/askQuestions', '/askYourself', '/fileCategories', '/comments', '/routes'
//
// All state stays in the shared pool at <root>/.data/jdiff (via @jsuite/data),
// so a review created through one consumer reads back identically in another.
// A target is always addressed by query params — ?repo= plus ?number= (a PR) or
// ?branch=&base= (a local branch) — so the layer holds no per-app repo config.
export default defineNuxtConfig({
  // The review palette, scoped to `.diff-surface` / `.diff-overlay` (and
  // `.diff-embed`, the same thing sized to its content) so a consumer that only
  // embeds the UI keeps its own theme elsewhere on the page.
  css: [fileURLToPath(new URL('./app/assets/css/diff.css', import.meta.url))],
  // shiki and parse-diff are used only from Nitro, so no client prebundling
  // hints are needed (unlike @jsuite/charting's react/excalidraw).
})
