// Collapsed sections that survive a refresh.
//
// The flow pages (/next, /running) group work by project, and once a board grows
// past a screenful the groups you are not working in are pure noise. Collapsing
// them is only worth doing if it sticks — otherwise every visit starts by
// re-hiding the same three projects — so the set of collapsed ids is written to
// localStorage under a per-page key.
//
// Only ids the caller still knows about are kept when reading back: a project that
// was collapsed and then finished would otherwise sit in storage forever.
export function useCollapsedGroups(storageKey: string) {
  const collapsed = ref(new Set<string>())
  const ready = ref(false)

  onMounted(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      if (Array.isArray(saved)) collapsed.value = new Set(saved.filter((id): id is string => typeof id === 'string'))
    } catch {
      // Corrupt or hand-edited storage — start expanded rather than blow up.
    }
    ready.value = true
  })

  // Persisting on every mutation (rather than in the handlers) keeps the toggle
  // and the bulk actions honest, and the `ready` guard stops the empty
  // pre-hydration set from clobbering what was saved.
  watch(
    collapsed,
    (value) => {
      if (ready.value) localStorage.setItem(storageKey, JSON.stringify([...value]))
    },
    { deep: true },
  )

  const isCollapsed = (id: string) => collapsed.value.has(id)

  function toggle(id: string) {
    if (collapsed.value.has(id)) collapsed.value.delete(id)
    else collapsed.value.add(id)
  }

  function collapseAll(ids: string[]) {
    for (const id of ids) collapsed.value.add(id)
  }

  function expandAll() {
    collapsed.value.clear()
  }

  // Prune ids that no longer exist on the page so storage tracks the tracker.
  function prune(ids: string[]) {
    const live = new Set(ids)
    for (const id of [...collapsed.value]) if (!live.has(id)) collapsed.value.delete(id)
  }

  return { collapsed, isCollapsed, toggle, collapseAll, expandAll, prune }
}
