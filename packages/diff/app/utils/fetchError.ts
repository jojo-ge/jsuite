// A useFetch error's `data` is the parsed response body, typed `{}` unless the
// call site declares an error type — so `error.data?.message` fails to
// typecheck even though the H3 error payload carries a message at runtime.
// Read it structurally here, once, instead of casting at every error box.
export function fetchErrorMessage(error: { data?: unknown; message?: string } | null | undefined): string {
  const data = error?.data
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    return data.message
  }
  return error?.message ?? ''
}
