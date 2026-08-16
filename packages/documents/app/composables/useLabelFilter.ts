import type { MaybeRefOrGetter } from 'vue'

/**
 * The chip bar's state: which labels are selected, and the documents that
 * survive them.
 *
 * This is the reactive half of the pair — `labelPool()` derives the chips to
 * offer and stays a plain app util, this owns `selected` and so belongs in
 * `app/composables/`.
 *
 * It hands back the filtered list rather than rendering it, because its two
 * callers agree on the filter and disagree on the layout: `<DocumentLibrary>`
 * lists the survivors flat, jTicket's `/documents` groups them by project.
 *
 * Selecting is AND, not OR — a document must carry *every* selected label — and
 * an empty `selected` filters nothing, which is what makes `clear()` restore
 * the full list.
 *
 * @param source the pool to filter. `null` and `undefined` read as empty, so a
 *   `useFetch` result can be passed in before it has resolved.
 */
export function useLabelFilter<T extends { labels: string[] }>(
  source: MaybeRefOrGetter<readonly T[] | null | undefined>,
) {
  const documents = computed(() => toValue(source) ?? [])

  /** The labels chosen so far. Empty means "everything". */
  const selected = ref<string[]>([])

  /** Every label in use across the pool — the chips to render. */
  const allLabels = computed(() => labelPool(documents.value))

  /** The documents carrying all of `selected`, in the pool's own order. */
  const filtered = computed(() =>
    documents.value.filter((d) => selected.value.every((label) => d.labels.includes(label))),
  )

  /** Add a label to the filter, or drop it if it is already on. */
  function toggle(label: string) {
    selected.value = selected.value.includes(label)
      ? selected.value.filter((l) => l !== label)
      : [...selected.value, label]
  }

  /** Drop every label — the "Clear" affordance both libraries offer. */
  function clear() {
    selected.value = []
  }

  // `selected` goes out readonly: `toggle` and `clear` are the only ways to move
  // it, which is what keeps this the single definition of the chip bar's state
  // rather than merely the first one.
  return { selected: readonly(selected), allLabels, filtered, toggle, clear }
}
