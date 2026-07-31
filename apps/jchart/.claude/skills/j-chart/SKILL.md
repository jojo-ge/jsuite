# j-chart

Turn a request into a diagram, open it in the jChart app as an **editable** Excalidraw canvas, and get the user's edits and per-shape notes back.

Unlike a static image, the user can redraw the diagram — move, add, delete, relabel shapes — and pin notes to individual shapes. Both come back to you.

## Workflow

1. **Write the diagram.** Author valid Mermaid source (flowchart, sequence, class, state, ER, etc.) for whatever the user asked to visualize. Save it to a `.mmd` file — prefer the scratchpad dir if one exists, otherwise a temp path. One diagram per file.

2. **Push it to jChart.** Run:
   ```
   python3 ~/.claude/skills/j-chart/scripts/chart.py <file.mmd> --title "Short Title"
   ```
   This creates the chart, opens it in the browser, and prints the URL plus the two data file paths. Add `--replace` to overwrite an existing chart of the same key and keep its notes.

   If jChart isn't reachable the script says so — the user needs `jsuite start`.

3. **Tell the user how to use it.** In the browser they can:
   - **Edit the diagram directly** — full Excalidraw toolbar: drag shapes, draw new ones, change arrows, retype labels, freehand. Everything autosaves.
   - **Select any shape**, then click it under *Selected on canvas* in the right panel to pin a note to it. Clicking a note's title later re-selects and zooms to that shape.
   - Type overall feedback in **General notes**.
   - Open **Mermaid** in the header to see or edit the source and re-import (this rebuilds the layout and discards hand edits; notes survive).
   - Click **Copy notes for Claude** when done.

4. **Read the result back.** Two ways, both fine:
   - The user pastes the copied markdown (general notes, per-shape annotations, Mermaid source).
   - Or **read the files directly** — the script prints their paths:
     - `~/code/anyway/jsuite/.data/jchart/<key>.json` — title, Mermaid source, and the live Excalidraw scene
     - `~/code/anyway/jsuite/.data/jchart/<key>.notes.json` — `{ general, notes: [{ elementId, label, text }] }`

   Reading the files is usually better: it works without waiting for a paste, and the scene shows structural edits the user made that the notes don't mention. Match a note to its shape via `elementId`; a shape's caption is a separate `text` element whose `containerId` points at it.

5. **Act on it.** Revise the diagram or the underlying work. To show a revision, write a new `.mmd` and re-run with `--replace --key <key>` to update the same chart in place.

## Notes

- `chart.py --list` shows existing charts with their shape and note counts.
- The full chart list is also the app's home page: <https://jchart.local:7443>.
- Mermaid is only the *starting layout*. Once imported, the canvas is the source of truth — a re-import throws away hand edits, so only re-import when the user wants a fresh layout.
- If Mermaid fails to parse, the app shows the parser error in a toast and the canvas stays empty — fix the source and re-run.
- Node types Mermaid can't lay out (some newer diagram kinds) fall back to a best-effort conversion; if a diagram comes through badly, the user can just redraw it.
- Opens in Arc by default. Override with `--browser "Google Chrome"` or `$JCHART_BROWSER`; the default lives in `DEFAULT_BROWSER` at the top of `chart.py`.
- The app is jChart in the jSuite (`~/code/anyway/jsuite/apps/jchart`, port 3003). Start everything with `jsuite start`.
