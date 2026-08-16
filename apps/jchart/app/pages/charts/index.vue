<script setup lang="ts">
// /charts — the library route the charting layer mounts in every consumer,
// inherited here on top of jChart's own `/`, which is the same component with
// jChart's branding. `app.config.ts` aliases the layer's paths onto `/` and
// `/c`, so nothing this app renders ever links here; it was reachable by URL
// only, as a second library page with delete on but nothing saying so.
//
// So it funnels into the canonical one rather than restating its answer — the
// call TICK-154 made for jGrilling's duplicate reader, for the same reason: a
// second surface is a second thing to keep honest.
//
// A page shadow, not `routeRules`: shadowing takes the layer's page out of
// jChart's route table entirely, where a route rule would leave it mounted and
// merely stand in front of it.
definePageMeta({
  redirect: (to) => ({ path: '/', query: to.query, hash: to.hash }),
})
</script>
