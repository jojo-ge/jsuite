export default defineEventHandler((event) => {
  const { projectId, status, label, repo } = getQuery(event)
  const store = loadStore()
  let docs = store.docs
  if (projectId) {
    const project = findProjectRef(store, String(projectId))
    docs = docs.filter((d) => d.projectId === (project?.id ?? String(projectId)))
  }
  // ?repo= → docs in that codebase's projects; project-less docs are excluded.
  if (repo) {
    const ids = projectIdsForRepo(store, resolveRepoParam(store, repo))
    docs = docs.filter((d) => d.projectId && ids.has(d.projectId))
  }
  if (status) docs = docs.filter((d) => d.status === status)
  if (label) docs = docs.filter((d) => d.labels.includes(String(label)))
  return docs
})
