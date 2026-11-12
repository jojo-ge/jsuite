// The Reviews board's Open PRs section: the codebase's open GitHub PRs, one
// GitHub search a page at a time (searchOpenPrs in server/utils/github.ts),
// most recently updated first. ?repo= is a codebase path.
//
//   drafts=1          include drafts (left out by default)
//   mine=1            only PRs I opened
//   reviewing=me|team review asked of me / of me or a team I'm on
//   cursor=           the previous page's nextCursor
//   limit=            page size (25; 50 at most)
//   force=1           read GitHub now instead of answering from the cache
//
// → { error, viewer, prs, total, nextCursor, fetchedAt, refreshing }. Pages
// are answered from the cache (ghCache.ts): `refreshing` says a fresher copy
// of this page is on its way — ask again. A gh failure comes back as `error`,
// not a 500, so the rest of the board still renders.
import { parsePrQuery } from '../../../app/utils/prList'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const repo = String(q.repo ?? '')
  if (!repo) throw createError({ statusCode: 400, statusMessage: 'send ?repo=<codebase path>' })
  const cwd = resolveRepoDir(repo)
  try {
    const page = await searchOpenPrs(cwd, parsePrQuery(q), {
      cursor: String(q.cursor ?? ''),
      limit: Number(q.limit) || undefined,
      force: !!q.force,
    })
    return { error: '', ...page.value, fetchedAt: new Date(page.fetchedAt).toISOString(), refreshing: page.refreshing }
  } catch (err: any) {
    return {
      error: String(err?.statusMessage ?? err?.message ?? err).slice(0, 500),
      viewer: '',
      prs: [],
      total: 0,
      nextCursor: null,
      fetchedAt: '',
      refreshing: false,
    }
  }
})
