<script setup lang="ts">
// /documents — the pool library the documents layer mounts in every consumer,
// inherited here and redirected away. jExplain's front door at `/` *is* that
// library, with jExplain's own framing and pointing at `/e/<key>`; serving the
// layer's copy as well would be two libraries over one pool, and after
// TICK-178 they would disagree — `/` opts in to delete, this one would not.
//
// A page rather than a `routeRules` redirect, matching the choice TICK-154 made
// for jGrilling's inherited reader: a page *shadows* the layer's, so jExplain's
// route table has no second library in it at all. A route rule would leave the
// layer's page mounted and merely stand in front of it — the "unshadow it and
// it's back" accident TICK-151 warned about.
definePageMeta({
  redirect: (to) => ({ path: '/', query: to.query, hash: to.hash }),
})
</script>
