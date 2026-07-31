// A guided tour of a PR: an overview of the change plus ordered stops at
// the lines that matter, produced by claude and shared between the server
// endpoint and the tour UI.
export interface TourStop {
  path: string
  side: 'LEFT' | 'RIGHT'
  line: number
  endLine: number
  title: string
  note: string
}

export interface Tour {
  overview: string
  stops: TourStop[]
}
