// Per-file risk levels produced by the claude risk heatmap, shared between
// the server endpoint and the file-nav coloring.
export type RiskLevel = 'low' | 'medium' | 'high'

export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high']

export interface FileRisk {
  path: string
  level: RiskLevel
  note: string
}
