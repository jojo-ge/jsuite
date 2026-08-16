// The review UI's error boxes read a failed fetch through the suite's one
// helper, re-exported here so Nuxt keeps auto-importing it under the same name
// inside this layer. It used to be implemented here, but jTicket extends this
// layer *and* has its own error boxes: two functions called `fetchErrorMessage`
// in the same scope, disagreeing about which field to read, is a trap for
// whoever writes the next catch block. There is one now, in @jsuite/http, and
// unlike a layer util a package can be imported from `server/` too.
export { fetchErrorMessage } from '@jsuite/http'
