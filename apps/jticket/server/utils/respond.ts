// Nitro runs on h3 v1, but Nuxt's generated server tsconfig maps the bare `h3`
// specifier to the v2 copy that the devtools chain drags in. That makes the
// auto-imported `setResponseStatus` a v2 signature while `event` is v1, so
// every call site fails to typecheck. Set the status on the node response
// instead, and describe the event by the shape we need rather than naming a
// type from either h3 — one place to undo once the versions converge.
export function setCreated(event: { node: { res: { statusCode: number } } }) {
  event.node.res.statusCode = 201
}
