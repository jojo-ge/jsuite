import type { GrillSession } from '../../app/utils/grillTypes'

// The prompts that make claude run Matt Pocock's "grilling" interview over a
// session: relentless one-question-at-a-time interrogation of a plan, each
// question with a recommended answer, until shared understanding is reached —
// then a debrief document in the shared block format.

function transcript(session: GrillSession): string {
  if (!session.turns.length) return '(no questions asked yet — this is the first question)'
  return session.turns
    .map((t, i) => {
      const lines = [
        `### Q${i + 1} [${t.topic}]`,
        t.question,
        `Your recommendation was: ${t.recommendation}`,
        t.answer != null ? `The user answered: ${t.answer}` : 'THE USER HAS NOT ANSWERED YET.',
      ]
      return lines.join('\n')
    })
    .join('\n\n')
}

function repoContext(session: GrillSession): string {
  return session.repoPath
    ? `You are running inside the repository this plan concerns (${session.repoPath}). If a FACT can be found by exploring the codebase (with Read, Grep, Glob, or git), look it up yourself instead of asking. Only the DECISIONS belong to the user.`
    : 'No repository is attached to this session — everything must come from the plan and the answers.'
}

const shared = (session: GrillSession) => `You are running a grilling session: interview the user relentlessly about every aspect of their plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one. Questions are asked ONE AT A TIME through a web UI — you produce the next question, the user answers in the browser, and you are invoked again with the updated transcript.

${repoContext(session)}

# The plan under interrogation: ${session.title}

${session.plan}

# The interview so far

${transcript(session)}`

export function nextQuestionPrompt(session: GrillSession): string {
  return `${shared(session)}

# Your job now

Decide the single most important unresolved question and ask it. Rules:
- ONE question only. Multiple questions at once are bewildering.
- Follow the design tree: prefer the question whose answer unblocks the most downstream decisions. Probe contradictions between earlier answers before opening new branches.
- Always provide your recommended answer, concretely — the user should be able to accept it as-is.
- Never ask something the plan, the transcript, or the codebase already answers.
- When every branch is resolved and you genuinely share the user's understanding of the plan, stop: declare the grilling done instead of inventing filler questions.

Respond with ONLY a JSON object, no prose or fences:
{"done": false, "topic": "short branch label (2-4 words)", "question": "the question, markdown, can include short context for why you're asking", "recommendation": "your recommended answer, markdown", "why": "one line: what this unblocks"}
or, when understanding is reached:
{"done": true, "verdict": "markdown — a short closing statement: what was resolved and why you consider the understanding shared"}`
}

export function wrapupPrompt(session: GrillSession): string {
  return `${shared(session)}

# Your job now

The grilling is over. Write the debrief: a document that records what was decided, so the plan can be enacted against it. Audience: the user (and a future Claude session implementing the plan).

Structure it from these block types (this is the j-explain block vocabulary):
- {"type": "prose", "md": "markdown"} — narrative
- {"type": "callout", "tone": "insight"|"warning"|"aside"|"success", "title": "…", "md": "…"} — things that must not be missed
- {"type": "compare", "title": "…", "columns": ["Decision", "Choice", "Why"], "rows": [["…","…","…"]]} — THE decision table; every question asked should land here
- {"type": "steps", "title": "…", "items": [{"title": "…", "md": "…"}]} — the resulting build order, if one emerged
- {"type": "timeline", "title": "…", "events": [{"when": "…", "title": "…", "md": "…"}]} — only if sequencing was discussed
- {"type": "takeaway", "title": "…", "points": ["markdown", "…"]} — the handful of things to remember
- {"type": "chart", "title": "…", "caption": "…", "mermaid": "flowchart TD\\n  …"} — a diagram of the decision tree or the resulting architecture; include at least one if the plan has any structure worth drawing

Aim for a tight, readable document: open with prose framing what was grilled, the decision table, one chart, risks as callouts, and close with takeaways. Include unresolved or deferred questions honestly (a warning callout).

Respond with ONLY a JSON object, no prose or fences:
{"title": "document title", "kicker": "small uppercase context line", "subtitle": "one-sentence standfirst", "blocks": [ … ], "glossary": {"term": "definition", …}}`
}
