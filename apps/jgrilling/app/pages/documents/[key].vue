<script setup lang="ts">
// /documents/<key> — the reader route the documents layer mounts in every
// consumer, inherited here with delete on. jGrilling already reads pool
// documents at `/e/<key>`, with delete withheld, so this route funnels into
// that one. Keeping two readers saying the same thing is exactly what failed
// before TICK-154; there is now one reader to keep honest.
//
// A page rather than a `routeRules` redirect (which is how jTicket sends its
// old `/docs` paths to `/documents`) because a page *shadows* the layer's:
// jGrilling's route table has no delete-on reader left in it at all. A route
// rule would leave that page mounted and merely stand in front of it — the
// "unshadow it and the button returns" accident TICK-151 warned about.
definePageMeta({
  redirect: (to) => ({ path: `/e/${String(to.params.key)}`, query: to.query, hash: to.hash }),
})
</script>
