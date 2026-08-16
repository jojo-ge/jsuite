export default defineAppConfig({
  // jDiff is nothing but reviews, so it aliases the layer's review UI onto the
  // short routes it has always used, rather than the namespaced /diffs default
  // every other consumer gets. These are what the review screens link through.
  diff: {
    basePath: '',
    brand: 'jDiff',
  },
})
