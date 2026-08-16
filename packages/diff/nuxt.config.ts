// @jsuite/diff — the diff-review engine as a Nuxt layer.
//
// Everything jDiff knows about *computing and storing a review* lives here; the
// app on top is only the UI shell. A consumer that `extends: ['@jsuite/diff']`
// (plus the workspace dep) gets:
//   - /api/diff, /api/file, /api/graph, /api/prs, /api/pr, /api/branches,
//     /api/repo, /api/open, /api/pick-folder — the diff/target routes
//   - /api/comment(s), /api/branch-comment(s), /api/rating, /api/risk,
//     /api/tour, /api/ask(s), /api/ask-yourself*, /api/notifications — the
//     review artifacts
//   - /api/analyze-generate, /api/ai-jobs, /api/ai-job-cancel — the claude
//     analysis runs (streamed over SSE, driven through @jsuite/claude)
//   - every server util as a Nitro auto-import: resolveTarget/prepareTarget,
//     run/resolveRepoPath, buildDiff, highlight, and the artifact stores
//   - the review vocabulary shared by server and UI, auto-imported as app
//     utils and importable explicitly: '@jsuite/diff/risk', '/tour',
//     '/askQuestions', '/askYourself', '/fileCategories'
//
// All state stays in the shared pool at <root>/.data/jdiff (via @jsuite/data),
// so a review created through one consumer reads back identically in another.
// A target is always addressed by query params — ?repo= plus ?number= (a PR) or
// ?branch=&base= (a local branch) — so the layer holds no per-app repo config.
export default defineNuxtConfig({
  // Nothing to configure: the layer contributes server routes, server utils and
  // app utils, all of which Nuxt/Nitro pick up from the layer's directories.
  // shiki and parse-diff are used only from Nitro, so no client prebundling
  // hints are needed (unlike @jsuite/charting's react/excalidraw).
})
