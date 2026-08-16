// @jsuite/http — one reading of "what went wrong" for a failed HTTP call.
//
// Every jSuite app catches `$fetch`/`useFetch` rejections and has to turn one
// into a line of UI text, and the shape is awkward enough that each app grew
// its own `?? ?? ??` chain — with a different order of arms, so the same
// failure read differently depending on which app you were looking at. That
// order is the whole point of this module, so it lives in one place:
//
//   import { fetchErrorMessage } from '@jsuite/http'
//   catch (err) { error.value = fetchErrorMessage(err, 'could not save') }
//
// `data.message` → `error.message` → `data.statusMessage` → fallback:
//
//   - `data` is the parsed error body. H3 mirrors `createError({ statusMessage })`
//     into `message`, so `data.message` is what the route meant whichever field
//     it threw — jTicket's routes throw `statusMessage`, jGrilling's throw
//     `message`, and this one arm is right for both.
//   - `error.message` is ofetch's own line (`[POST] "/api/x": 400 Bad Request`),
//     the best thing left when the failure never reached a route at all.
//   - `data.statusMessage` ranks *last* because H3 fills it with the bare status
//     reason ("Server Error") whenever the route didn't set one. Higher up, that
//     boilerplate would mask a real message — which is exactly what jTicket's
//     `statusMessage`-first chain did to any error raised by a route that throws
//     `message`, the diff layer's included.
//
// Ofetch's `data` is typed `{}` unless the call site declares an error type, so
// `error.data.message` doesn't typecheck even though it's there at runtime.
// Everything below is read structurally, which is why callers can pass a plain
// `unknown` and drop their `catch (e: any)`.
//
// Plain ESM on purpose: Nitro (`server/`) and Vite (`app/`) both consume it
// straight from the workspace with no transpile step, and unlike a Nuxt layer's
// auto-imported util it crosses the app/server boundary.

/** `obj[key]` if `obj` is object-ish, else undefined — no casts, no throw. */
function prop(obj, key) {
  return obj && typeof obj === 'object' && key in obj ? obj[key] : undefined
}

/**
 * `value` if it is a string with something in it, else undefined — so a blank
 * message falls through to the next arm instead of rendering an empty box.
 */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function fetchErrorMessage(error, fallback = '') {
  const data = prop(error, 'data')
  return (
    nonEmptyString(prop(data, 'message'))
    ?? nonEmptyString(prop(error, 'message'))
    ?? nonEmptyString(prop(data, 'statusMessage'))
    ?? fallback
  )
}
