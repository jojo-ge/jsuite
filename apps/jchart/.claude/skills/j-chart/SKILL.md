---
name: j-chart
description: Draw a diagram the human can edit and annotate — author Mermaid, push it into jChart as an editable Excalidraw canvas, then read the user's redraw and per-shape notes back from .data/jchart. Use when the user says "jchart this", "draw this in jchart", "diagram this so I can edit it", or wants a diagram they will move shapes on and pin notes to. For a diagram inside an article, use j-explain's chart block instead (same chart pool).
---

# j-chart — an editable, annotatable diagram

jChart (`https://jchart.local`, port 43003) turns Mermaid into an **editable**
Excalidraw canvas. Unlike a static image the user can redraw it — move, add,
delete, relabel shapes — and pin notes to individual shapes. Both come back
to you. The chart pool (`.data/jchart/`) is shared with jExplain, jTicket and
jGrilling: a chart made here can be embedded in any of their documents by key.

Standing rules:
- Mermaid is only the *starting layout*. Once imported the canvas is the
  source of truth; a re-import discards hand edits (notes survive).
- Read the data files rather than waiting for a paste.
- Script: `~/.claude/skills/j-chart/scripts/chart.py` (installed by
  `./jsuite setup`; source at `$(jsuite root)/apps/jchart/.claude/skills/j-chart/scripts/chart.py`).

## Workflow

1. **Write the diagram.** Valid Mermaid (flowchart, sequence, class, state,
   ER, …) in a `.mmd` file in the scratchpad dir. One diagram per file.

2. **Push it.**
   ```
   python3 ~/.claude/skills/j-chart/scripts/chart.py <file.mmd> --title "Short Title"
   ```
   Creates the chart, opens it in the browser, prints the URL and the two data
   file paths. The key is a slug of the title (or `--key slug`). Re-running
   with the same key and **no** `--replace` creates a new chart with a `-2`
   suffix; `--replace` overwrites the chart in place and keeps its notes.
   If jChart isn't reachable the script says so: `jsuite
   status`, then `jsuite start`.

3. **Tell the user how to use it.** In the browser they can:
   - edit the diagram directly (full Excalidraw toolbar; autosaves);
   - select a shape, then click it under *Selected on canvas* in the right
     panel to pin a note to it (clicking a note's title later re-selects and
     zooms to that shape);
   - type overall feedback in **General notes**;
   - open **Mermaid** in the header to see/edit the source and re-import
     (rebuilds the layout, discards hand edits, keeps notes);
   - press the copy button when done — **Copy chart for Claude** when there
     are no notes yet, **Copy notes for Claude** once there are.

4. **Read the result back.** Either the pasted markdown, or the files
   (paths printed by the script; data root is `$JSUITE_DATA_DIR` if set,
   else `$(jsuite root)/.data`):
   - `.data/jchart/<key>.json` — title, Mermaid source, live Excalidraw scene
   - `.data/jchart/<key>.notes.json` — `{ general, notes: [{ id, elementId, label, text }] }`

   The files are usually better: no waiting, and the scene shows structural
   edits the notes don't mention. Match a note to its shape via `elementId`;
   a shape's caption is a separate `text` element whose `containerId` points
   at it.

5. **Act on it.** Revise the diagram or the underlying work. To show a
   revision, write a new `.mmd` and re-run with `--replace --key <key>`.

## Notes

- `chart.py --list` shows existing charts with shape and note counts; the
  home page <https://jchart.local> is the same list.
- API: `POST /api/charts {title, mermaid?, key?, replace?}`, `GET|PUT
  /api/charts/:key`, `GET /api/charts`. The script wraps the POST.
- Mermaid that fails to parse shows the parser error in a toast and leaves the
  canvas empty — fix the source and re-run. Diagram kinds Mermaid can't lay
  out fall back to a best-effort conversion; the user can redraw.
- Opens in Arc by default. Override with `--browser "Google Chrome"` or
  `$JCHART_BROWSER` (`DEFAULT_BROWSER` at the top of `chart.py`).
