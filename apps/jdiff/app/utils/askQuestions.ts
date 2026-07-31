// Preset questions for the "ask" composer. There is no free-form input in
// the UI; these are the only questions that can be fired at claude. The
// prompt text is what the server sends; the label is what the button shows.
export interface AskQuestion {
  id: string
  label: string
  prompt: string
}

export interface SavedAsk {
  id: string
  repo: string
  number: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  questionId: string
  question: string
  answer: string
  createdAt: string
}

export const ASK_QUESTIONS: AskQuestion[] = [
  {
    id: 'how',
    label: 'how does this work?',
    prompt: 'Explain how this code works: what it does, what calls it, and what it depends on. Just the essentials — skip anything obvious from reading the line itself.',
  },
  {
    id: 'new-system',
    label: 'is this a new system?',
    prompt: 'Is this change introducing a brand-new system, pattern, or abstraction to the codebase, or does it extend something that already exists? If it builds on existing code, point at where that lives.',
  },
  {
    id: 'teach',
    label: 'teach me about this code',
    prompt: 'Teach me about this code as if I were new to this part of the codebase: the concepts, APIs, and patterns it uses. Only the background I actually need to review it — keep it tight.',
  },
  {
    id: 'why',
    label: 'why is it done this way?',
    prompt: 'Why might the author have written it this way? Name the strongest alternative and the trade-off versus what was chosen — no exhaustive survey.',
  },
  {
    id: 'risks',
    label: 'what could break?',
    prompt: 'What are the real risks and edge cases around this line — inputs, states, or callers that could make it misbehave? List only plausible ones, not hypotheticals.',
  },
]
