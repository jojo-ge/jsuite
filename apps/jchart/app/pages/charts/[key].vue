<script setup lang="ts">
// /charts/<key> — the workbench route the layer mounts in every consumer,
// redirected onto jChart's own `/c/<key>` for the reasons in ./index.vue.
// `POST /api/charts` hands agents a `/charts/<key>` path, so this keeps that
// path working here instead of serving a second, unstated workbench.
definePageMeta({
  redirect: (to) => ({ path: `/c/${String(to.params.key)}`, query: to.query, hash: to.hash }),
})
</script>
