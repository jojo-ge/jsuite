// Formatting for the Analytics views: durations as humans read them, dollars,
// and a safe number for the many "null = unknown" fields the rows carry.

/** 1h 12m / 12m 05s / 45s / '–' for null. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** $0.42 / $12.30 / $1,204 — cents only under $100. */
export function fmtUsd(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return '–'
  if (usd < 100) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}

export function fmtPct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '–'
  return `${Math.round(x * 100)}%`
}

export function fmtNum(x: number | null | undefined, digits = 0): string {
  if (x == null || !Number.isFinite(x)) return '–'
  return x.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–'
}

/** Short model names for tables: claude-opus-5-5 → Opus 5.5. */
export function shortModel(id: string): string {
  const m = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id)
  if (!m) return id || '–'
  const name = m[1]![0]!.toUpperCase() + m[1]!.slice(1)
  return `${name} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}
