export default defineAppConfig({
  // The review screens @jsuite/diff mounts at /diffs are full-surface — jTicket
  // puts its own <AppHeader> above the repo picker but cannot put one above a
  // diff — so the name in their bar is the only thing telling you which app you
  // are in, and the layer's default said 'diffs'. The rule, now that there is a
  // second host: **the brand is the app, not the layer.** It is a link to
  // `routes.home`, which in a host is that host's own diffs page, wearing the
  // host's chrome — so it has to be spelled the way the door it opens is.
  // jDiff has always followed this ('jDiff'); 'diffs' stays the layer default
  // for a consumer that has not thought about it yet.
  //
  // Branding is only half of getting back: the brand link lands you on /diffs,
  // not on the ticket you came from. That is <DiffHostBackLink> and `DiffFrom`
  // in the layer — a per-navigation back-link jTicket's link sites hand over.
  diff: { brand: 'jTicket' },
  ui: {
    // Primary is the mark's periwinkle (see main.css @theme) so buttons, active
    // nav and links are the same blue as the icon. Success/warning/error keep
    // their own hues — the board leans on green-means-done, so primary must not
    // be green.
    colors: {
      primary: 'periwinkle',
      neutral: 'slate',
    },
  },
})
