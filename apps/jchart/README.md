# jChart

Editable, annotatable diagrams. Claude drafts a diagram in Mermaid; you redraw it
freehand on an Excalidraw canvas and pin notes to individual shapes; Claude reads
your edits and notes back off disk.

```
https://jchart.local        # via the jSuite edge (jsuite start)
http://localhost:43003            # bare dev server
```

## Where the code lives

Almost none of it is here. The chart library, the workbench (canvas + notes +
Mermaid source editor) and the `/api/charts` store are all in
**`packages/charting`** (`@jsuite/charting`), which serves them as pages at
`/charts` and `/charts/<key>` in every app that extends the layer — jTicket and
jExplain included.

This app is the shell that brands them and gives them shorter URLs:

| route | renders | |
|---|---|---|
| `/` | `<ChartLibrary heading="jChart">` | also at `/charts` |
| `/c/<key>` | `<ChartWorkbench>` | also at `/charts/<key>` |

The aliasing is one entry in `app/app.config.ts` (`charting.indexPath` /
`charting.chartPath`); the layer's components link through `useChartRoutes()`,
so they never hardcode either scheme.

## How it fits together

```
Claude ──POST /api/charts──▶ data/<key>.json      (title + mermaid source, no shapes yet)
                                   │
                        first open │ mermaid → excalidraw layout, autosaved
                                   ▼
You ── edit canvas / pin notes ──▶ data/<key>.json        (the live scene)
                                   data/<key>.notes.json  (general + per-shape notes)
                                   │
Claude ◀── reads both files ───────┘   (or you click "Copy notes for Claude")
```

Mermaid is only the starting layout. After import the canvas is the source of
truth — re-importing rebuilds the layout and throws away hand edits (notes survive).

## Data format

`data/<key>.json`

```json
{
  "format": "j-chart",
  "version": 1,
  "key": "sync-architecture",
  "title": "Sync architecture",
  "createdAt": "…", "updatedAt": "…",
  "source": { "type": "mermaid", "text": "flowchart TD…" },
  "scene": { "elements": [ /* excalidraw */ ], "appState": {}, "files": {} }
}
```

`data/<key>.notes.json`

```json
{ "general": "…", "notes": [ { "id": "n…", "elementId": "…", "label": "jChart app", "text": "…" } ] }
```

Notes are pinned by Excalidraw `elementId`, so they survive moving and relabelling
the shape. Delete the shape and the note stays, flagged as orphaned.

A shape's caption is a *separate* `text` element whose `containerId` points back at
the shape — that's why the layer's `app/utils/scene.ts` has `labelForElement()`.

## API

| | |
|---|---|
| `GET /api/charts` | list (key, title, counts, timestamps) |
| `POST /api/charts` | `{ title, mermaid?, key?, replace? }` → `{ key, title }` — no URL, see below |
| `GET/PUT/DELETE /api/charts/:key` | PUT patches any of `{ title, source, scene }` |
| `GET/PUT /api/charts/:key/notes` | `{ general, notes[] }` |

The `j-chart` skill (`~/.claude/skills/j-chart/`) drives `POST /api/charts` and
then reads the two files directly.

**Create returns the key, not a URL.** Where a chart is *served* is the app's
fact, not the pool's — jChart's workbench is `/c/<key>`, everyone else's is
`/charts/<key>` — and one shared handler cannot tell which app it is in; the
comment on `index.post.ts` has the full reason. So the caller routes the key:
`useChartRoutes()` on the client. On the server, note that charting has no
`chartRoutes()` to match `@jsuite/diff`'s `diffRoutes()` yet, so a consumer's
Nitro code still writes its own prefix out — see TICK-197.

## Stack notes

- Nuxt 4 + Nuxt UI for the shell; **Excalidraw is React**, mounted with
  `createRoot` in the layer's `app/components/ExcalidrawCanvas.vue`. That is the
  only React in the suite, and it uses `React.createElement` rather than JSX so
  the Vite pipeline stays Vue-only.
- **React is pinned to 18.** Excalidraw's bundle leaves `@radix-ui/*` 1.0.x
  external, and those predate React 19.
- Excalidraw is uncontrolled after mount. Vue never re-renders it — programmatic
  changes go through the imperative `excalidrawAPI` handle (`setScene`,
  `focusElement`).
- Saving is gated on `getSceneVersion` so panning and selecting don't write;
  mirroring elements to the notes panel is gated *separately* and starts at `-1`,
  so the panel gets a shape list even when nothing has been edited yet.
- Fonts are copied to `public/fonts` by `scripts/copy-excalidraw-assets.mjs` on
  postinstall and served locally via `EXCALIDRAW_ASSET_PATH` — no CDN.
- `vite.define['process.env.IS_PREACT']` is required; without it Excalidraw's
  module-scope `process` reference throws in the browser.
