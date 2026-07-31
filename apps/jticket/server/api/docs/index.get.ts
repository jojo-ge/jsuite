export default defineEventHandler((event) => {
  const { projectId, status, label } = getQuery(event)
  const store = loadStore()
  let docs = store.docs
  if (projectId) {
    const project = findProjectRef(store, String(projectId))
    docs = docs.filter((d) => d.projectId === (project?.id ?? String(projectId)))
  }
  if (status) docs = docs.filter((d) => d.status === status)
  if (label) docs = docs.filter((d) => d.labels.includes(String(label)))
  return docs
})
