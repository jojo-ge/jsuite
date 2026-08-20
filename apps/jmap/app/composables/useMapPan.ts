// Pan/zoom for the map SVG, driven entirely through its viewBox (the jRig
// approach: window-level pointer listeners with capture, no libraries).
// Wheel zooms around the cursor; dragging the background pans.

export interface ViewBox { x: number; y: number; w: number; h: number }

export function useMapPan(svgEl: Ref<SVGSVGElement | null>) {
  const viewBox = ref<ViewBox>({ x: 0, y: 0, w: 100, h: 100 })
  const viewBoxAttr = computed(() => {
    const v = viewBox.value
    return `${v.x} ${v.y} ${v.w} ${v.h}`
  })

  function fit(width: number, height: number) {
    viewBox.value = { x: 0, y: 0, w: Math.max(width, 1), h: Math.max(height, 1) }
  }

  /** Client coords → svg user-space coords under the current viewBox. */
  function toSvgPoint(clientX: number, clientY: number) {
    const el = svgEl.value
    const v = viewBox.value
    if (!el) return { x: v.x, y: v.y }
    const rect = el.getBoundingClientRect()
    // preserveAspectRatio="xMidYMid meet": the viewBox is scaled uniformly and
    // centered — account for the letterboxing.
    const scale = Math.min(rect.width / v.w, rect.height / v.h)
    const offX = (rect.width - v.w * scale) / 2
    const offY = (rect.height - v.h * scale) / 2
    return {
      x: v.x + (clientX - rect.left - offX) / scale,
      y: v.y + (clientY - rect.top - offY) / scale,
      scale,
    }
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault()
    const v = viewBox.value
    const factor = Math.exp(event.deltaY * 0.002)
    const w = Math.min(Math.max(v.w * factor, 120), 40_000)
    const h = v.h * (w / v.w)
    const p = toSvgPoint(event.clientX, event.clientY)
    // Keep the point under the cursor fixed while the box rescales around it.
    viewBox.value = {
      x: p.x - ((p.x - v.x) / v.w) * w,
      y: p.y - ((p.y - v.y) / v.h) * h,
      w,
      h,
    }
  }

  let drag: { startX: number; startY: number; box: ViewBox; scale: number } | null = null
  const dragging = ref(false)

  const onMove = (event: PointerEvent) => {
    if (!drag) return
    dragging.value = true
    viewBox.value = {
      ...drag.box,
      x: drag.box.x - (event.clientX - drag.startX) / drag.scale,
      y: drag.box.y - (event.clientY - drag.startY) / drag.scale,
    }
  }
  const detach = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    drag = null
    // Let the click that ends a real drag be told apart from a plain click.
    setTimeout(() => { dragging.value = false }, 0)
  }
  const onUp = () => detach()

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    const el = svgEl.value
    const v = viewBox.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const scale = Math.min(rect.width / v.w, rect.height / v.h)
    drag = { startX: event.clientX, startY: event.clientY, box: { ...v }, scale }
    ;(event.target as Element | null)?.setPointerCapture?.(event.pointerId)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  onScopeDispose(detach)

  return { viewBox, viewBoxAttr, fit, onWheel, onPointerDown, dragging }
}
