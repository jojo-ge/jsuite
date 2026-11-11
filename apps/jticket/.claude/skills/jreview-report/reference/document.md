# Reviewer report — the document

You're turning a reviewer's plain-text dump into the document the review
watcher is waiting for. The review itself is done. Your job is formatting: **don't add,
drop, merge or re-grade findings**, and don't change their meaning. You work in
the reviewed checkout, so read the code for `quote:` excerpts and run git
yourself.

Block vocabulary: the "Block vocabulary" section of
`~/.claude/skills/j-explain/SKILL.md` (you only need `prose`, `callout`,
`code`, `diff` and `takeaway`).

## The dump

Header lines `BASE:`, `SKILL:`, `SOURCES:`, `VERDICT:` (and `APPROVAL:` on a PR review), then zero or more
`FINDING` sections (`severity`, `claim`, `where`, `category`, optional
`scope` — only when the review prompt asked for it: a consensus review
that isn't an architecture pass, or a PR review — `scenario`, `fix`, optional `quote`), then
`TAKEAWAYS`. Findings are already in order, most
severe first. Keep that order.

## The payload

Write it to `/tmp/jreview/<review>/reviewer-<n>.json`:

```json
{
  "key": "<doc>",
  "kicker": "jReview · reviewer <n>",
  "title": "<repo dir name> — <BASE>...HEAD",
  "subtitle": "<VERDICT>, plus the finding count by severity (e.g. \"1 high · 3 medium · 2 low\").",
  "blocks": [ ... ]
}
```

Blocks, in order:

1. `prose`, id `scope`: `## Scope`, then the fixed point (`BASE`), the commit
   list (run `git log <BASE>..HEAD --oneline` and include it as a list), which
   review skill ran (`SKILL`) and the spec/standards sources it used
   (`SOURCES`).
2. One `callout` per finding, ids `f1`, `f2`, … in dump order (the triager
   cites these ids):
   - `tone`: `warning` for critical/high, `insight` for medium, `aside` for low
   - `title`: `[<severity>] <claim>`
   - `md`: `**Where:** \`<where>\`` · `**Category:** <category>` (· `**Scope:** in|out` when the dump has a `scope:` line), then a blank
     line, then the scenario, then a blank line, then `**Fix:** <fix>`.

   When the finding has a `quote:`, follow its callout with a block showing
   those lines. For `path:start-end`, use a `code` block (`file`, `startLine`,
   `lang` from the extension, `highlight` = the `where` line when it's in
   range). For `diff <path>`, use a `diff` block with just the hunks of
   `git diff <BASE>...HEAD -- <path>` that contain the `where` line. Give each
   one the id `f<k>-quote`.
3. When the dump has an `APPROVAL:` line, a `callout` with id `approval`
   (tone `success` for approve / approve-with-nits, `warning` otherwise),
   title `Approval: <verdict>`, md = the line's reason. It goes after the
   findings — the consensus session reads it by that id.
4. If there are no findings, add a single `callout` (tone `success`, id `f0`,
   title `No findings`) saying the review found nothing to report.
5. `takeaway`: the TAKEAWAYS bullets.

## Publish

```sh
python3 ~/.claude/skills/j-explain/scripts/explain.py /tmp/jreview/<review>/reviewer-<n>.json --replace --no-open
```

- **Always** `--replace --no-open`. Without `--replace` the pool may suffix the
  key (`-2`) and the watcher never sees it. `--no-open` because four reviewers
  must not open four browser tabs.
- Check the printed key is exactly `<doc>`. If explain.py rejects the payload,
  fix the JSON and re-run.
