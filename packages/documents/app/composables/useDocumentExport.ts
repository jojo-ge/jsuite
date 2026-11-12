// Export PDF is the browser's print dialog ("Save as PDF") over the print
// rules in documents.css — the article alone: no menu, bar or notes rail.
//
// A print shows the page as it stands, so two things are put right first:
// a dark page is switched to light (code is tokenised and charts are drawn
// for the mode they are in), and every chart is asked — through EXPORT_EVENT —
// to bring its whole drawing into view. The mode is put back when the dialog
// closes.

/** Fired on `window` just before a document is printed; blocks that print what is on screen listen for it. */
export const EXPORT_EVENT = 'jx:before-export'

/** How long code and charts get to redraw before the print dialog opens. */
const SETTLE_MS = 600

export function useDocumentExport() {
  const colorMode = useColorMode()
  const exporting = ref(false)

  async function exportPdf() {
    if (exporting.value) return
    exporting.value = true
    const preference = colorMode.preference
    if (colorMode.value !== 'light') colorMode.preference = 'light'
    await nextTick()
    window.dispatchEvent(new Event(EXPORT_EVENT))
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    window.addEventListener(
      'afterprint',
      () => {
        colorMode.preference = preference
        exporting.value = false
      },
      { once: true },
    )
    window.print()
  }

  return { exporting, exportPdf }
}
