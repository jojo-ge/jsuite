// A useFetch error's `data` is the parsed response body, typed `{}` unless the
// call site declares an error type — so `error.data?.message` fails to
// typecheck even though the H3 error payload carries a message at runtime. A
// `$fetch` catch block has the mirror problem: `e` is `unknown`, and the same
// `e.data?.message ?? e.message ?? '…'` chain only compiled there because the
// block annotated it `any`. Read the payload structurally here, once, instead
// of casting at every error box and catch block.
//
// `fallback` is what a caller shows when the error carries no message of its
// own — the per-site "failed to post comment" string a catch block would
// otherwise have spelled inline. An error box reading an empty string is a bug
// either way, so a blank message falls through to it too.
//
// Order matters: `data.message` is what our own routes set via createError, so
// it wins. `statusMessage` comes *last* because H3 fills it with the bare
// status text ("Internal Server Error") whenever a route didn't set one, and
// that says less than ofetch's own `[GET] "/api/pr": 500 …` — so it is a last
// resort before the fallback, not a preferred answer.
export function fetchErrorMessage(error: unknown, fallback = ''): string {
  const data = prop(error, 'data')
  return (
    nonEmptyString(prop(data, 'message')) ??
    nonEmptyString(prop(error, 'message')) ??
    nonEmptyString(prop(data, 'statusMessage')) ??
    fallback
  )
}

// `unknown` in, `unknown` out: reading a property off an error payload whose
// shape nobody declared is the whole problem this file exists to contain.
function prop(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && key in value ? Reflect.get(value, key) : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
