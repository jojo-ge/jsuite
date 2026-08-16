<script setup lang="ts">
// /documents — the whole shared pool, listed inside jGrilling. The documents
// layer mounts this route in every consumer, and jGrilling served it inherited
// and unconfigured until TICK-154: a delete button on every jTicket spec and
// jExplain explainer, on a page nobody here chose to put up.
//
// jGrilling never destroys a document out of the shared pool — see "who may
// delete out of the pool" in the root README for the rule and the why.
//
// TICK-154 offered two ways to hold that line, and this app takes a different
// one for each of its two inherited routes:
//
//   - the library stays, configured. Withholding delete removes the harm, and
//     a debrief written here lands in a pool worth being able to look through
//     from here — the session list only reaches debriefs a session produced.
//   - the reader goes. `/documents/<key>` redirects to `/e/<key>`, because
//     jGrilling already had a reader and a second one is a second thing to
//     keep honest.
//
// So the list points at that surviving reader (`reader-base="/e"`) and the
// library and the reader cannot disagree: they are one reader.
//
// Since TICK-178 the layer withholds delete by default, so `:deletable="false"`
// no longer *does* anything here. It stays as a statement: this app's answer
// should be legible without knowing what the layer defaults to.
useHead({ title: 'Documents' })
</script>

<template>
  <DocumentLibrary
    :deletable="false"
    reader-base="/e"
    subtitle="Every document in the shared pool — the debriefs written here, and the explainers and specs written elsewhere. Deleting one is jExplain's call."
  />
</template>
