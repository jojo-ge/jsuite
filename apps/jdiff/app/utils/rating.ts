// Reviewability rating produced by the claude run: a 1–10 score with the
// factors behind it and a suggested reading order through the diff.
export interface ReviewRating {
  score: number
  effort: string
  summary: string
  factors: { label: string; impact: 'good' | 'neutral' | 'bad'; detail: string }[]
  readingOrder: { path: string; note: string }[]
}
