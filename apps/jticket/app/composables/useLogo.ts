// Which mark the app wears — picked on /logo, remembered per browser in a
// cookie (like the sidebar's width), so the server renders the sidebar with
// the right one and nothing swaps on load. The useState is what keeps the
// sidebar, the gallery and the tab icon on the same value within a page.
export function useLogo() {
  const cookie = useCookie<string>('jticket-logo', {
    default: () => DEFAULT_LOGO,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  const id = useState<string>('jticket-logo', () => findLogo(cookie.value).id)
  const mark = computed(() => findLogo(id.value))

  function select(next: string) {
    id.value = findLogo(next).id
    cookie.value = id.value
  }

  return { id, mark, select }
}
