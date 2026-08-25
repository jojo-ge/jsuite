// Why the relay closed a socket — refused joins, plus in-session ejections
// (oversized frame). The relay accepts the socket and then closes it with
// one of these application codes (an HTTP error on upgrade would surface
// codeless), so dialers can branch on the reason. Shared with consumers via
// '@jsuite/relay/codes' — a subpath on purpose: the package root exports
// startLocalRelay, which drags miniflare into any importer's build.
export const CLOSE_REASONS = {
  4001: 'unknown room',
  4002: 'wrong secret',
  4003: 'room full',
  4004: 'room expired',
  4005: 'room killed',
  4006: 'message too large',
  4007: 'rate limited',
}
