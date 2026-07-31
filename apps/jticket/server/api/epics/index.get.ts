export default defineEventHandler(() => {
  const store = loadStore()
  return store.epics
})
