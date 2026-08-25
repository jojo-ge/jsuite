import { ProbeError } from './syncProbe'

/** Map a probe failure onto the HTTP status it carries. */
export function asProbeError(error: unknown) {
  if (error instanceof ProbeError) {
    return createError({ statusCode: error.statusCode, statusMessage: error.message })
  }
  return createError({ statusCode: 500, statusMessage: error instanceof Error ? error.message : String(error) })
}
