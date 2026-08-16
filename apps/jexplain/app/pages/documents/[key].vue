<script setup lang="ts">
// /documents/<key> — the reader route the documents layer mounts in every
// consumer, inherited here and redirected to jExplain's own reader at
// `/e/<key>`, which is the same component with jExplain's back-link and the
// opt-in to delete. One reader over the pool, not two; see the sibling
// `index.vue` for why this is a page shadow and not a route rule.
//
// Query and hash carry through: note deep-links into a document use them.
definePageMeta({
  redirect: (to) => ({ path: `/e/${String(to.params.key)}`, query: to.query, hash: to.hash }),
})
</script>
