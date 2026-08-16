// Draft comments stored locally against a branch (before a PR exists).
export default defineEventHandler((event) => {
  const repo = resolveRepoDir(String(getQuery(event).repo ?? ''))
  const branch = String(getQuery(event).branch ?? '')
  if (!branch) throw createError({ statusCode: 400, message: 'missing ?branch=' })
  return loadBranchComments(repo, branch)
})
