// The jTicket marks you can try on — the gallery at /logo, the sidebar, the tab
// icon. A mark is a drawing with no plate behind it, in up to three paints:
//   `currentColor`         the mark's main colour
//   `var(--logo-accent)`   its second colour
//   `var(--logo-on)`       the on-colour (white) — only ever on top of a filled shape
// The colours come from the mark's palette (`colors`), so one drawing serves
// the sidebar and gallery (<AppLogo> sets the three) and the favicon
// (`logoFavicon`). A body sits inside `<g fill="currentColor">`, in a 32-unit
// box whose outer 3 units stay empty (LOGO_VIEWBOX crops them off).

export interface LogoColors {
  main: string
  accent: string
}

export interface LogoMark {
  id: string
  name: string
  /** What it stands for, in a few words — shown under the name. */
  note: string
  /** `original`: the five from the repaint. `ticket`: the j and a ticket. `j`: built around the letter. `more`: the rest. */
  group: 'original' | 'ticket' | 'j' | 'more'
  body: string
  colors: LogoColors
}

/** What a mark is drawn in — `<svg viewBox>` for every place one is shown. */
export const LOGO_VIEWBOX = '3 3 26 26'
/** The on-colour: paint for what sits on top of a filled shape. */
export const LOGO_ON = '#fff'

// Colour pairs, each mid-toned so a mark reads on a light page, a dark one and
// a browser's tab strip alike. A mark names one, or is dealt one by its place
// in the list (see LOGO_MARKS).
const PALETTES = {
  iris: { main: '#6366f1', accent: '#ec4899' },
  ember: { main: '#ea580c', accent: '#e11d48' },
  teal: { main: '#0d9488', accent: '#d97706' },
  grape: { main: '#7c3aed', accent: '#f97316' },
  ocean: { main: '#2563eb', accent: '#0ea5e9' },
  gold: { main: '#d97706', accent: '#dc2626' },
  forest: { main: '#16a34a', accent: '#ca8a04' },
  rose: { main: '#e11d48', accent: '#7c3aed' },
  sky: { main: '#0284c7', accent: '#16a34a' },
  berry: { main: '#db2777', accent: '#2563eb' },
} satisfies Record<string, LogoColors>
type Palette = keyof typeof PALETTES

/** A mark as it is written down: its colours still a palette's name, or left to be dealt. */
type Drawn = Omit<LogoMark, 'colors'> & { palette?: Palette }

const line = (width: number) =>
  `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`

const dots = (r: number, ...at: [number, number][]) =>
  at.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')

// ── Building blocks for the J marks ─────────────────────────────────────────

const ACCENT = 'var(--logo-accent)'
const ON = 'var(--logo-on)'

/** A stroke in the mark's second colour. */
const accent = (width: number, extra = '') =>
  `fill="none" stroke="${ACCENT}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}`

/** A stroke in the on-colour — only ever drawn on top of a filled shape. */
const on = (width: number, extra = '') =>
  `fill="none" stroke="${ON}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}`
const flatOn = (width: number, extra = '') => `fill="none" stroke="${ON}" stroke-width="${width}"${extra}`

/** A stroke with flat ends and sharp corners. */
const flat = (width: number) => `fill="none" stroke="currentColor" stroke-width="${width}"`

/** The lowercase j's stem and hook (its tittle sits at 19, 8.5), and the same with room for a taller tittle. */
const J_PATH = 'M19 14.5v6a4 4 0 0 1-4 4h-3'
const J_LOW = 'M19 15.5v5a4 4 0 0 1-4 4h-3'
/** The capital J: a stem and a half-round hook, no tittle. */
const J_CAP = 'M21 7.5v11a5 5 0 0 1-10 0'

/** The j in the mark's two colours: the stem in the main one, the tittle in the accent. */
const j = (width = 4.5, r = 2.6) =>
  `<circle cx="19" cy="8.5" r="${r}" fill="${ACCENT}"/><path d="${J_PATH}" ${line(width)}/>`
/** The j in the on-colour, for setting on a filled shape. */
const jOn = (width = 4.5, r = 2.6) =>
  `<circle cx="19" cy="8.5" r="${r}" fill="${ON}"/><path d="${J_PATH}" ${on(width)}/>`
const jIn = (scale: number, cx = 16, cy = 16) => at(scale, jOn(), cx, cy)
const jLow = (width = 4.5) => `<path d="${J_LOW}" ${line(width)}/>`

/** A drawing scaled about the j's own centre and set down at (cx, cy). */
const at = (scale: number, inner: string, cx = 16, cy = 16) =>
  `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-15.5 -16.3)">${inner}</g>`
const shift = (dx: number, inner: string, dy = 0) => `<g transform="translate(${dx} ${dy})">${inner}</g>`

const HEX = 'M16 6l8.66 5v10L16 26l-8.66-5V11z'
const SPARK_TITTLE =
  'M19 3.8c.4 2.6 1.6 3.8 4.2 4.2-2.6.4-3.8 1.6-4.2 4.2-.4-2.6-1.6-3.8-4.2-4.2 2.6-.4 3.8-1.6 4.2-4.2z'

type Row = [id: string, name: string, note: string, body: string, palette?: Palette]
const marks = (group: LogoMark['group'], rows: Row[]): Drawn[] =>
  rows.map(([id, name, note, body, palette]) => ({ id, name, note, group, body, palette }))

const J_MARKS = marks('j', [
  // The letter itself, cut different ways.
  ['j-bold', 'Bold j', 'Heavy, round', `<circle cx="19" cy="8" r="3.1" fill="var(--logo-accent)"/><path d="M19 15v5.5a4 4 0 0 1-4 4h-2.5" ${line(5.6)}/>`],
  ['j-hairline', 'Hairline j', 'One thin line', j(2, 1.7)],
  ['j-square', 'Square j', 'Flat ends, a right-angle hook', `<rect x="16.75" y="6" width="4.5" height="4.5" fill="var(--logo-accent)"/><path d="M19 13v11.5h-8.5" ${flat(4.5)}/>`],
  ['j-chamfer', 'Chamfer j', 'The hook cut at 45°', `<path d="M19 4.8l3.4 3.4-3.4 3.4-3.4-3.4z" fill="var(--logo-accent)"/><path d="M19 13.5v7l-4 4h-4.5" ${flat(4.5)}/>`],
  ['j-capital', 'Capital J', 'Stem and hook, nothing else', `<path d="${J_CAP}" ${line(4.2)}/>`],
  ['j-barred', 'Barred J', 'A capital with its top bar', `<path d="M20 7.5v11a5 5 0 0 1-10 0M13.5 7.5h10" ${line(4)}/>`],
  ['j-slab', 'Slab J', 'Flat-cut, with a slab on top', `<path d="M11.5 8.2h14M19.5 8.2v10.3a4.75 4.75 0 0 1-9.5 0V16" ${flat(4.4)}/>`],
  ['j-serif', 'Serif J', 'A fine stroke with a ball terminal', `<path d="${J_CAP}" ${line(2.8)}/><path d="M17 7.5h8" ${line(2.8)}/><circle cx="11.3" cy="17.6" r="2.9"/>`],
  ['j-italic', 'Italic j', 'Leaning forward', `<g transform="translate(3.6 0) skewX(-12)">${j()}</g>`],
  ['j-swash', 'Swash J', 'A long tail sweeping under', `<path d="M21 7v8.5c0 6-5.5 9-15 8.5" ${line(4)}/>`],
  ['j-hooked', 'Hooked J', 'Mostly hook', `<path d="M22 7.5v9.5a7 7 0 0 1-12.6 4.2" ${line(5)}/>`],
  ['j-block', 'Block J', 'Cut from one slab', '<path d="M17 6h6v20H9v-9h6v3h2z"/>'],
  ['j-bauhaus', 'Bauhaus J', 'A bar, a quarter ring, a dot', '<rect x="17" y="6" width="6" height="12"/><path d="M23 18a8 8 0 0 1-8 8v-6a2 2 0 0 0 2-2z"/><circle cx="11" cy="9.5" r="3.5" fill="var(--logo-accent)"/>'],
  ['j-pixel-cap', 'Pixel J', 'A capital in blocks', '<rect x="10" y="6" width="14" height="4.5"/><rect x="16.5" y="6" width="5" height="20"/><rect x="9" y="21.5" width="12.5" height="4.5"/><rect x="9" y="17" width="4.5" height="9"/>'],
  ['j-matrix', 'Dot-matrix j', 'Seven dots', dots(1.55, [21.7, 6.5], [21.7, 14.1], [21.7, 17.9], [21.7, 21.7], [17.9, 25.5], [14.1, 25.5], [10.3, 21.7])],
  ['j-fade', 'Fade J', 'Building up, block by block', '<rect x="17" y="6" width="5.5" height="5" rx="1" fill="var(--logo-accent)"/><rect x="17" y="12" width="5.5" height="5" rx="1" opacity=".7"/><path d="M17 18h5.5v8H9.5v-5.5H17z"/>'],
  // The stroke, treated.
  ['j-outline', 'Outline j', 'Just the edge', `<circle cx="19" cy="8.5" r="3.3"/><circle cx="19" cy="8.5" r="1.5" fill="${ON}"/><path d="${J_PATH}" ${line(6.2)}/><path d="${J_PATH}" ${on(2.6)}/>`],
  ['j-inline', 'Inline j', 'A line down the middle', `<circle cx="19" cy="8.5" r="3"/><path d="${J_PATH}" ${line(5.8)}/><path d="${J_PATH}" ${on(1.2)}/>`],
  ['j-triple', 'Triple j', 'Three lines running together', `<circle cx="19" cy="8.5" r="3.4"/><circle cx="19" cy="8.5" r="2.2" fill="${ON}"/><circle cx="19" cy="8.5" r="1"/><path d="${J_PATH}" ${line(6.8)}/><path d="${J_PATH}" ${on(4.4)}/><path d="${J_PATH}" ${line(2)}/>`],
  ['j-stencil', 'Stencil j', 'Cut for spraying', `<circle cx="19" cy="8.5" r="3" fill="${ACCENT}"/><path d="${J_PATH}" ${flat(5.6)} stroke-dasharray="4.6 1.3 5 1.3 10"/>`],
  ['j-shadow', 'Shadow j', 'With its own echo behind', `<g color="var(--logo-accent)" transform="translate(-3 2)">${j(4.2, 2.4)}</g>${shift(1.5, j(4.2, 2.4), -1)}`],
  ['j-folded', 'Folded j', 'The hook turned under', `<circle cx="19" cy="8.5" r="2.6"/><path d="${J_PATH}" ${accent(4.5)}/><path d="M19 14.5v5" ${line(4.5)}/>`],
  ['j-echo', 'Echo J', 'One loop after another', `<path d="M17 7.5v11a5 5 0 0 1-10 0" ${accent(2.4)}/><path d="M21 7.5v11a5 5 0 0 1-10 0" ${line(2.4)} opacity=".7"/><path d="M25 7.5v11a5 5 0 0 1-10 0" ${line(2.4)}/>`],
  ['j-road', 'Road J', 'A route with its centre line', `<path d="${J_CAP}" ${line(6.4)}/><path d="${J_CAP}" ${on(1.2, ' stroke-dasharray="2.2 2.6"')}/>`],
  ['j-segmented', 'Segmented J', 'Work cut into slices', `<path d="${J_CAP}" ${flat(5)} stroke-dasharray="3.6 1"/>`],
  ['j-dotted', 'Dotted J', 'Step by step', `<path d="${J_CAP}" ${line(3)} stroke-dasharray="0.1 3.75"/>`],
  ['j-pipe', 'Pipe J', 'Everything flows through it', `<path d="M21 9v9.5a5 5 0 0 1-10 0V17" ${flat(4.4)}/><path d="M17.5 8h7M7.5 16h7" ${flat(2.6)}/>`],
  // The j inside something.
  ['j-ringed', 'Ringed j', 'In a ring', `<circle cx="16" cy="16" r="10.5" ${line(2)}/>${at(0.66, j())}`],
  ['j-framed', 'Framed j', 'In a frame', `<rect x="5.5" y="5.5" width="21" height="21" rx="5" ${line(2)}/>${at(0.68, j())}`],
  ['j-hex', 'Hex j', 'In a cell', `<path d="${HEX}" ${line(2.2)}/>${at(0.6, j())}`],
  ['j-brackets', '[j]', 'An item in a list', `<path d="M11 7H7v18h4M21 7h4v18h-4" ${line(2.6)}/>${at(0.62, j())}`],
  ['j-parens', '(j)', 'Called like a function', `<path d="M10.5 6.5a15 15 0 0 0 0 19M21.5 6.5a15 15 0 0 1 0 19" ${line(2.6)}/>${at(0.62, j())}`],
  ['j-keycap', 'Keycap j', 'The j key: down a line', `<rect x="5.5" y="5.5" width="21" height="18" rx="4" ${line(2)}/><path d="M7.5 26.5h17" ${accent(2.2)}/>${at(0.56, j(), 16, 14.5)}`],
  ['j-disc', 'Disc j', 'Cut from a disc', `<circle cx="16" cy="16" r="11"/>${at(0.74, jOn())}`],
  ['j-diamond', 'Diamond j', 'Cut from a diamond', `<path d="M16 4l12 12-12 12L4 16z"/>${at(0.6, jOn())}`],
  ['j-ticket', 'Ticket j', 'Cut from a ticket', `<path d="M5 8.5h22v4.5a3 3 0 0 0 0 6v4.5H5V19a3 3 0 0 0 0-6z"/>${at(0.58, jOn())}`],
  ['j-tag', 'Tag j', 'A label', `<path d="M6 8.5h12.5l8 7.5-8 7.5H6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>${at(0.56, jOn(), 14, 16)}`],
  ['j-shield', 'Shield j', 'Reviewed before it ships', `<path d="M16 4.5l9.5 3.2v7.3c0 6-4 9.8-9.5 12.5C10.5 24.8 6.5 21 6.5 15V7.7z"/>${at(0.6, jOn(), 16, 15.5)}`],
  ['j-bookmark', 'Bookmark j', 'Where you left off', `<path d="M9 5h14v22l-7-5.5L9 27z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>${at(0.56, jOn(), 16, 13.5)}`],
  // The tittle, swapped.
  ['j-square-tittle', 'Square tittle', 'A ticket for a dot', `<rect x="16.6" y="6" width="4.8" height="4.8" rx=".8" fill="var(--logo-accent)"/><path d="${J_PATH}" ${line(4.5)}/>`],
  ['j-diamond-tittle', 'Diamond tittle', 'A decision for a dot', `<path d="M19 4.6l3.6 3.6-3.6 3.6-3.6-3.6z" fill="var(--logo-accent)"/><path d="${J_PATH}" ${line(4.5)}/>`],
  ['j-ring-tittle', 'Ring tittle', 'An open dot', `<circle cx="19" cy="8.3" r="2.6" ${accent(1.8)}/><path d="${J_PATH}" ${line(4.5)}/>`],
  ['j-spark', 'Spark j', 'A fresh coat on the j', `<path d="${SPARK_TITTLE}" fill="${ACCENT}"/>${jLow()}`],
  ['j-plus', 'Plus j', 'Create', `<path d="M19 5v6.4M15.8 8.2h6.4" ${accent(2.2)}/>${jLow()}`],
  ['j-play', 'Play j', 'The jButton on the j', `<path d="M17 5.2l5 3-5 3z" fill="${ACCENT}" stroke="${ACCENT}" stroke-width="1.4" stroke-linejoin="round"/>${jLow()}`],
  ['j-checked', 'Checked j', 'Done, dotted', `<path d="M15.8 8.4l2.3 2.3 4.2-5" ${accent(2.2)}/>${jLow()}`],
  ['j-crowned', 'Crowned j', 'A little pleased with itself', `<path d="M14.8 10.5V5.2l2.1 2 2.1-2.6 2.1 2.6 2.1-2v5.3z" fill="${ACCENT}" stroke="${ACCENT}" stroke-width="1" stroke-linejoin="round"/>${jLow()}`],
  ['j-orbit', 'Orbit j', 'An agent circling the dot', `<circle cx="19" cy="8.5" r="2.1"/><ellipse cx="19" cy="8.5" rx="5.6" ry="2.3" transform="rotate(-20 19 8.5)" ${accent(1.3)}/>${jLow()}`],
  ['j-live', 'Live j', 'The live dot', `<circle cx="19" cy="8" r="2.3"/><circle cx="19" cy="8" r="4.4" ${accent(1.3)}/><path d="M19 16.5v4a4 4 0 0 1-4 4h-3" ${line(4.5)}/>`],
  // The j as something else.
  ['j-check', 'Check j', 'A tick that is also a j', `<circle cx="23.3" cy="7.3" r="2.6" fill="var(--logo-accent)"/><path d="M21.5 12.5L14 23.5l-5-4.5" ${line(4.2)}/>`],
  ['j-return', 'Return j', 'Loops back for another', `<circle cx="19" cy="6.8" r="2.4" fill="var(--logo-accent)"/><path d="M19 12v6a4 4 0 0 1-4 4H9.5M12.5 18.5L9 22l3.5 3.5" ${line(3.4)}/>`],
  ['j-hook', 'Hook', 'It catches things', `<circle cx="19.5" cy="7.5" r="2.3" ${accent(2)}/><path d="M19.5 10v10a4.75 4.75 0 0 1-9.5 0v-3.5M10 16.5l3.2 3.2" ${line(2.6)}/>`],
  ['j-umbrella', 'Umbrella', 'One app over everything', `<path d="M5.5 15a10.5 10.5 0 0 1 21 0z"/><path d="M16 15v7.5a3 3 0 0 1-6 0M16 3.8v1" ${accent(2.6)}/>`],
  ['j-anchor', 'Anchor', 'Two hooks and a ring', `<circle cx="16" cy="7.3" r="2.3" ${line(2)}/><path d="M16 9.8V25M11.5 14h9M7 17.5a9 9 0 0 0 18 0" ${line(2.6)}/>`],
  ['j-flag', 'Flag j', 'The frontier, planted', `<path d="M14 6.5v14a4 4 0 0 1-4 4H8" ${line(3)}/><path d="M14 7h11l-3 3.5 3 3.5H14z" fill="${ACCENT}" stroke="${ACCENT}" stroke-width="1.4" stroke-linejoin="round"/>`],
  ['j-burndown', 'Burndown j', 'The bars, ending in a hook', `<rect x="6" y="7.5" width="5" height="5.5" rx="1.5" fill="var(--logo-accent)"/><rect x="13.5" y="7.5" width="5" height="9" rx="1.5" opacity=".8"/><path d="M23.5 7.5v11.5a4 4 0 0 1-4 4H8" ${flat(5)} stroke-linejoin="round"/>`],
  ['j-linked', 'Linked j', 'Nodes along the letter', `<path d="M19 8v12.5a4 4 0 0 1-4 4h-4" ${accent(2.2)}/>${dots(3.2, [19, 8], [11, 24.5])}<circle cx="19" cy="17" r="2.2"/>`],
  // The j with company.
  ['j-prompt', 'j_', 'Waiting at the prompt', `${shift(-4.5, j())}<path d="M19 24.5h7" ${line(3.2)}/>`],
  ['j-slash', '/j', 'How every command starts', `<path d="M6.5 25l5.5-18" ${accent(3)}/>${shift(3.5, j())}`],
  ['j-cursor', 'Cursor j', 'Mid-sentence', `${shift(-3, j())}<rect x="20.5" y="13" width="4.5" height="11.5" rx="1" fill="var(--logo-accent)"/>`],
  ['j-ellipsis', 'j…', 'An agent, working', `${shift(-5.5, j())}${dots(1.5, [18.5, 23.5], [22, 23.5], [25.5, 23.5])}`],
  ['j-add', 'j+', 'One more ticket', `${shift(-5, j())}<path d="M22 13v7M18.5 16.5h7" ${line(2.6)}/>`],
  ['j-fast', 'Fast j', 'In a hurry', `<path d="M5 11.5h6M7 16h4M5 20.5h3.5" ${accent(2)}/>${shift(3.5, j())}`],
  ['j-descender', 'Descender', 'Dropping below the line', `<path d="M6 19.5h7M24.5 19.5H26" ${accent(2)}/>${j()}`],
  ['j-double', 'jj', 'jSuite and jTicket', [13, 23].map((x) => `<circle cx="${x}" cy="8.5" r="2.1" fill="${ACCENT}"/><path d="M${x} 14v7a3 3 0 0 1-3 3h-1.5" ${line(3.6)}/>`).join('')],
  ['j-t', 'jT', 'Both initials', `<circle cx="10.5" cy="8.5" r="2.1" fill="var(--logo-accent)"/><path d="M10.5 13.5v7.5a3 3 0 0 1-3 3H7M15.5 9.5H25M20.25 9.5v15" ${line(3.2)}/>`],
])

// ── Shapes the ticket marks share ───────────────────────────────────────────

/** A ticket's outline: a w×h card at (x, y) with a half-round notch of radius n bitten out of each short side. */
const ticket = (x: number, y: number, w: number, h: number, n = 2.5) => {
  const side = (h - 2 * n) / 2
  return `M${x} ${y}h${w}v${side}a${n} ${n} 0 0 0 0 ${2 * n}v${side}h${-w}v${-side}a${n} ${n} 0 0 0 0 ${-2 * n}z`
}
/** Corners eased by a thin stroke of the fill's own colour. */
const eased = (paint = 'currentColor', width = 1.2) =>
  `fill="${paint}" stroke="${paint}" stroke-width="${width}" stroke-linejoin="round"`
const ticketEl = (x: number, y: number, w: number, h: number, paint = 'currentColor', n = 2.5) =>
  `<path d="${ticket(x, y, w, h, n)}" ${eased(paint)}/>`
/** The ticket most of them start from. */
const TICKET = ticketEl(4.5, 8.5, 23, 15)

/** Drawn about their own centre, to be placed with a transform. */
const STAR = 'M0-3.4L.85-1.17 3.23-1.05 1.38.45 2 2.75 0 1.45-2 2.75-1.38.45-3.23-1.05-.85-1.17z'
const SPARK = 'M0-5c.5 3.2 1.8 4.5 5 5-3.2.5-4.5 1.8-5 5-.5-3.2-1.8-4.5-5-5 3.2-.5 4.5-1.8 5-5z'
const FLAME = 'M16 4.5c1 4 6.5 7 6.5 13.5a6.5 6.5 0 0 1-13 0c0-2.5 1-4.5 2.5-6 .5 2 1.5 3 2.5 3.2-.8-3.5-.3-7.2 1.5-10.7z'
const BOLT = 'M18 4.5L7.5 18H15l-1.5 9.5L24.5 14H17z'
/** The j's stem and hook, starting low enough to clear a tall tittle. */
const J_STEM = 'M19 16v4.5a4 4 0 0 1-4 4h-3'

const TICKET_MARKS = marks('ticket', [
  ['t-stub', 'Stub j', 'The ticket and the stub you keep', `<path d="M4.5 8.5h15v15h-15v-5a2.5 2.5 0 0 0 0-5z" ${eased()}/><path d="M21.5 8.5h6v5a2.5 2.5 0 0 0 0 5v5h-6z" ${eased(ACCENT)}/>${jIn(0.56, 12.2, 16)}`],
  ['t-tilt', 'Tilted ticket', 'Handed over', `<g transform="rotate(-14 16 16)">${ticketEl(6, 9.25, 20, 13.5)}${jIn(0.52)}</g>`],
  ['t-tall', 'Tall ticket', 'Portrait, with a tear-off foot', `<path d="M8 4.5h16v13a2.3 2.3 0 0 0 0 4.6v5.4H8v-5.4a2.3 2.3 0 0 0 0-4.6z" ${eased()}/><path d="M11.4 19.8h9.2" ${flatOn(1.2, ' stroke-dasharray="1.4 1.8"')}/>${jIn(0.5, 16, 11.4)}`],
  ['t-stacked', 'Stacked tickets', 'One slice on another', `${ticketEl(8, 5.5, 19.5, 13, ACCENT)}${ticketEl(4.5, 11.5, 19.5, 13)}${jIn(0.5, 14.25, 18)}`],
  ['t-fanned', 'Fanned tickets', 'A hand of them', `<g transform="rotate(-12 16 26)">${ticketEl(6.5, 9, 19, 12, ACCENT)}</g><g transform="rotate(12 16 26)" opacity=".7">${ticketEl(6.5, 9, 19, 12)}</g>${ticketEl(6.5, 10.5, 19, 12)}${jIn(0.46, 16, 16.5)}`],
  ['t-capital', 'Capital ticket', 'The ticket, with a capital J', `${TICKET}<g transform="translate(16 16) scale(.6) translate(-16 -15.5)"><path d="${J_CAP}" ${on(4.4)}/></g>`],
  ['t-notched', 'Notched j', 'The tittle is a notch in the edge', `<path d="M4.5 9.5h10.3a2.4 2.4 0 0 0 4.8 0h7.9v5.3a2.2 2.2 0 0 0 0 4.4v5.3h-23v-5.3a2.2 2.2 0 0 0 0-4.4z" ${eased()}/><path d="M17.2 14.4v3.6a3 3 0 0 1-3 3h-2" ${on(3)}/>`],
  ['t-outline', 'Outlined ticket', 'A ticket not yet picked up', `<path d="${ticket(5, 9, 22, 14)}" ${line(2.2)}/>${at(0.54, j())}`],
  ['t-split', 'Split ticket', 'Two colours, one ticket', `<path d="M4.5 8.5H19l-6 15H4.5v-5a2.5 2.5 0 0 0 0-5z" ${eased()}/><path d="M19 8.5h8.5v5a2.5 2.5 0 0 0 0 5v5H13z" ${eased(ACCENT)}/>${jIn(0.58)}`],
  ['t-tittle', 'Ticket tittle', 'A ticket where the dot goes', `${ticketEl(14.6, 5.4, 8.8, 5.6, ACCENT, 1.2)}${jLow()}`],
  ['t-caught', 'Caught ticket', 'A ticket on the hook', `<g transform="rotate(-16 10.5 21.5)">${ticketEl(5.4, 17.8, 10, 7, ACCENT, 1.3)}</g>${shift(3.5, j())}`],
  ['t-strip', 'Strip J', 'A strip of tickets, bent into a J', `<path d="${J_CAP}" ${flat(7)}/><path d="M17.5 11.5h7M17.5 15.5h7M16 20v7" ${flatOn(1.1, ' stroke-dasharray="1.2 1.2"')}/>`],
  ['t-roll', 'Ticket roll', 'The roll is the dot, the strip is the j', `<path d="M14.7 10.5v9.5a4 4 0 0 1-4 4H6.5" ${accent(4.4)}/><path d="M12.5 15.2h4.4M12.5 19h4.4" ${flatOn(1, ' stroke-dasharray="1 1"')}/><circle cx="20.5" cy="10.5" r="6"/><circle cx="20.5" cy="10.5" r="2" fill="${ON}"/>`],
  ['t-admit', 'Admit j', 'Admit one', `${TICKET}${jIn(0.56, 11.8, 16)}<path transform="translate(21.5 16)" d="${STAR}" fill="${ON}"/>`],
  ['t-barcode', 'Barcode ticket', 'Scanned at the door', `${TICKET}${jIn(0.56, 11.5, 16)}<path d="M18.6 12v8M22.6 12v8" ${flatOn(1.6)}/><path d="M20.6 12v8M24.6 12v8" ${flatOn(0.9)}/>`],
  ['t-done', 'Done ticket', 'A tick that is also a j, on a ticket', `${TICKET}<g transform="translate(16 16) scale(.58) translate(-16.5 -15)"><circle cx="23.3" cy="7.3" r="2.6" fill="${ON}"/><path d="M21.5 12.5L14 23.5l-5-4.5" ${on(4.2)}/></g>`],
  ['t-stamp', 'Stamp j', 'Perforated all round', `<rect x="7" y="6" width="18" height="20"/><rect x="7" y="6" width="18" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="0.1 3.067"/>${jIn(0.6)}`],
  ['t-seal', 'Seal j', 'Approved', `<circle cx="16" cy="16" r="9.5"/><circle cx="16" cy="16" r="9.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-dasharray="0.1 2.884"/>${jIn(0.62)}`],
  ['t-coupon', 'Coupon j', 'Cut along the line', `<path d="${ticket(5, 9, 22, 14)}" ${line(2)} stroke-dasharray="2.6 2.2"/>${at(0.54, j())}`],
  ['t-jt', 'jT stubs', 'One ticket each for the j and the T', `${ticketEl(6, 4.8, 20, 10.2, 'currentColor', 1.8)}${jIn(0.4, 16, 9.9)}${ticketEl(6, 17, 20, 10.2, ACCENT, 1.8)}<path d="M13 19.8h6M16 19.8v5" ${on(2)}/>`],
  ['t-torn', 'Torn ticket', 'Used', `<path d="M4.5 7h11l-1.5 2.5 1.5 2.5-1.5 2.5 1.5 2.5-1.5 2.5 1.5 2.5h-11v-5a2.5 2.5 0 0 0 0-5z" ${eased('currentColor', 1)}/><path d="M18 10l-1.5 2.5 1.5 2.5-1.5 2.5 1.5 2.5-1.5 2.5 1.5 2.5h9.5v-5a2.5 2.5 0 0 1 0-5v-5z" ${eased(ACCENT, 1)}/>${jIn(0.46, 9.6, 14.5)}`],
  ['t-receipt', 'Receipt j', 'What the run cost', `<path d="M8 4.5h16v21l-2.67 2-2.67-2-2.66 2-2.67-2-2.66 2L8 25.5z" ${eased('currentColor', 1)}/>${jIn(0.52, 16, 12.3)}<path d="M11.5 21.6h9" ${on(1.4)}/>`],
  ['t-tearoff', 'Tear-off j', 'Perforated across the stem', `<circle cx="19" cy="8" r="3.1" fill="${ACCENT}"/><path d="M19 15v5.5a4 4 0 0 1-4 4h-2.5" ${line(6)}/><path d="M16.2 17.6h5.6" ${flatOn(1.1, ' stroke-dasharray="1 1.1"')}/>`],
  ['t-crossed', 'Crossed tickets', 'Two at once', `<g transform="rotate(24 16 16)">${ticketEl(6, 9.75, 20, 12.5, ACCENT)}</g><g transform="rotate(-10 16 16)">${ticketEl(6, 9.75, 20, 12.5)}${jIn(0.5)}</g>`],
  ['t-punchcard', 'Punch card', 'Two loops done, one to go', `${TICKET}${jIn(0.56, 11.5, 16)}<g fill="${ON}">${dots(1.4, [22.5, 12], [22.5, 16])}</g><circle cx="22.5" cy="20" r="1.2" ${flatOn(0.9)}/>`],
  ['t-pass', 'Pass j', 'On a lanyard', `<path d="M13.5 9.5L11 4.2M18.5 9.5L21 4.2" ${accent(2)}/><rect x="8" y="9" width="16" height="18.5" rx="2.5"/><rect x="13" y="11.2" width="6" height="1.8" rx=".9" fill="${ON}"/>${jIn(0.5, 16, 20)}`],
  ['t-golden', 'Golden ticket', 'The one you were hoping for', `${TICKET}${jIn(0.58, 15.5, 16)}<path transform="translate(25.5 6.4) scale(.5)" d="${SPARK}" fill="${ACCENT}"/><path transform="translate(6.2 26.6) scale(.36)" d="${SPARK}" fill="${ACCENT}"/>`, 'gold'],
  ['t-sliced', 'Sliced ticket', 'One ticket, three reviewable slices', `<path d="M4.5 8.5H11v15H4.5v-5a2.5 2.5 0 0 0 0-5z" ${eased()}/><rect x="12.8" y="8.5" width="6.4" height="15" ${eased()} opacity=".75"/><path d="M21 8.5h6.5v5a2.5 2.5 0 0 0 0 5v5H21z" ${eased(ACCENT)}/>${jIn(0.44)}`],
  ['t-clipped', 'Clipped ticket', 'Checked at the gate', `<path d="M4.5 8.5H22l5.5 5.5v9.5h-23v-5a2.5 2.5 0 0 0 0-5z" ${eased()}/><path d="M24 6l4.5 4.5" ${accent(2)}/>${jIn(0.58, 15, 16)}`],
  ['t-three', 'Three-ticket J', 'A J laid out in tickets', `<rect x="17" y="5" width="6" height="7" rx="1.2"/><rect x="17" y="13" width="6" height="7" rx="1.2" opacity=".75"/><rect x="9" y="21" width="14" height="6" rx="1.2" fill="${ACCENT}"/>`],
])

const J_COLOUR_MARKS = marks('j', [
  ['j-duo', 'Two-tone j', 'The stem in one colour, the hook in another', `<circle cx="19" cy="8.5" r="2.6" fill="${ACCENT}"/><path d="M19 19.5v1a4 4 0 0 1-4 4h-3" ${accent(4.5)}/><path d="M19 14.5v5" ${line(4.5)}/>`],
  ['j-three-part', 'Three-part J', 'Bar, stem and hook', `<path d="M20 18.5a5 5 0 0 1-10 0" ${accent(4)}/><path d="M13.5 7.5h10" ${line(4)} opacity=".7"/><path d="M20 7.5v11" ${line(4)}/>`],
  ['j-overlap', 'Overlap j', 'Two bars crossing', `<rect x="16" y="5.5" width="6.5" height="17" rx="3.25" opacity=".85"/><rect x="8.5" y="19.5" width="14" height="6.5" rx="3.25" fill="${ACCENT}" opacity=".85"/>`],
  ['j-candle', 'Candle j', 'Still burning', `<path transform="translate(19 8) scale(.42) translate(-16 -14.5)" d="${FLAME}" fill="${ACCENT}"/><path d="${J_STEM}" ${line(4.5)}/>`],
  ['j-drip', 'Drip j', 'The paint is still wet', `<path d="M19 4c1.7 2.3 2.9 3.9 2.9 5.4a2.9 2.9 0 0 1-5.8 0c0-1.5 1.2-3.1 2.9-5.4z" fill="${ACCENT}"/><path d="${J_STEM}" ${line(4.5)}/>`],
  ['j-ribbon', 'Ribbon J', 'A stem and a turn', `<rect x="17" y="6" width="6" height="12"/><path d="M23 18a8 8 0 0 1-8 8v-6a2 2 0 0 0 2-2z" fill="${ACCENT}"/>`],
  ['j-brick', 'Brick J', 'Three bricks', `<rect x="17" y="6" width="6" height="13" rx="1"/><rect x="9" y="14.5" width="6" height="4.5" rx="1" opacity=".7"/><rect x="9" y="20" width="14" height="6" rx="1" fill="${ACCENT}"/>`],
  ['j-bead', 'Bead j', 'Strung in two colours', `${dots(2.3, [19, 11.5], [19, 21.3], [10.8, 23.2])}<g fill="${ACCENT}">${dots(2.3, [19, 6.2], [19, 16.4], [15.5, 24.6])}</g>`],
  ['j-bullseye', 'Bullseye j', 'On target', `<circle cx="19" cy="8" r="3.3" ${accent(1.6)}/><circle cx="19" cy="8" r="1.3"/><path d="${J_STEM}" ${line(4.5)}/>`],
  ['j-down', 'Down j', 'j moves down a line', `<path d="M5.5 11.5l3.5 3.5 3.5-3.5" ${accent(2.4)}/>${shift(3, j())}`],
  ['j-sprout', 'Sprout j', 'Something growing', `<path d="M19 12C15 12 13.3 9.5 13.5 6c3.5-.2 5.7 1.5 5.5 6z" fill="${ACCENT}"/><path d="M19.5 12c3 0 4.3-1.8 4.2-4.3-2.6-.1-4.3 1.2-4.2 4.3z" fill="${ACCENT}" opacity=".7"/><path d="M19 13v7.5a4 4 0 0 1-4 4h-3" ${line(4)}/>`],
  ['j-night', 'Night j', 'Agents working while you sleep', `<path d="M21 4.6a4 4 0 1 0 1.6 6a3.4 3.4 0 0 1-1.6-6z" fill="${ACCENT}"/><path d="${J_STEM}" ${line(4.5)}/>`],
  ['j-star', 'Star j', 'A starred j', `<path transform="translate(19 8) scale(1.25)" d="${STAR}" fill="${ACCENT}"/>${jLow()}`],
  ['j-watchful', 'Watchful j', 'A reviewer for a dot', `<path d="M13.6 8s2.1-3.3 5.4-3.3S24.4 8 24.4 8s-2.1 3.3-5.4 3.3S13.6 8 13.6 8z" ${accent(1.5)}/><circle cx="19" cy="8" r="1.5" fill="${ACCENT}"/><path d="${J_STEM}" ${line(4.5)}/>`],
  ['j-auto', 'Auto j', 'Auto mode on the j', `<path transform="translate(19 8) scale(.37) translate(-16 -16)" d="${BOLT}" ${eased(ACCENT, 1.5)}/><path d="M19 16.5v4a4 4 0 0 1-4 4h-3" ${line(4.5)}/>`],
  ['j-pinned', 'Pinned j', 'You are here', `<path d="M19 12.5c-2.3-2.6-3.5-4.3-3.5-5.8a3.5 3.5 0 0 1 7 0c0 1.5-1.2 3.2-3.5 5.8z" fill="${ACCENT}"/><circle cx="19" cy="6.7" r="1.2" fill="${ON}"/><path d="${J_STEM}" ${line(4.5)}/>`],
  ['j-split-disc', 'Split disc', 'Two halves, one j', `<path d="M16 5a11 11 0 0 0 0 22z"/><path d="M16 5a11 11 0 0 1 0 22z" fill="${ACCENT}"/>${jIn(0.72)}`],
  ['j-party', 'Party j', 'Something shipped', `${j()}<rect x="6" y="6.5" width="3.2" height="3.2" rx=".6" transform="rotate(20 7.6 8.1)" fill="${ACCENT}"/><circle cx="8.5" cy="15" r="1.3" opacity=".7"/><path d="M24 12.5l2.2 1.6" ${accent(2)}/><circle cx="25.5" cy="20.5" r="1.5" fill="${ACCENT}"/><path d="M24.5 26l1.8-1.2M12 5.5l1.2 2" ${line(2)} opacity=".7"/>`],
  ['j-underlined', 'Underlined j', 'Signed off', `${at(0.88, j(), 16, 14.7)}<path d="M7 27c5-1.8 12-1.8 18-.4" ${accent(2.2)}/>`],
  ['j-braces', '{j}', 'An object of its own', `<path d="M11 6.5c-2.5 0-2.5 2-2.5 4V13c0 1.5-.8 3-2.5 3 1.7 0 2.5 1.5 2.5 3v2.5c0 2 0 4 2.5 4M21 6.5c2.5 0 2.5 2 2.5 4V13c0 1.5.8 3 2.5 3-1.7 0-2.5 1.5-2.5 3v2.5c0 2 0 4-2.5 4" ${accent(2.4)}/>${at(0.6, j())}`],
])

const EXTRA_MARKS = marks('more', [
  ['kanban', 'Kanban', 'Columns of cards', '<rect x="6" y="7" width="5" height="5" rx="1.2"/><rect x="6" y="13.5" width="5" height="5" rx="1.2"/><rect x="6" y="20" width="5" height="5" rx="1.2"/><rect x="13.5" y="7" width="5" height="5" rx="1.2"/><rect x="13.5" y="13.5" width="5" height="5" rx="1.2" fill="var(--logo-accent)"/><rect x="21" y="7" width="5" height="5" rx="1.2" fill="var(--logo-accent)"/>'],
  ['card', 'Card', 'One ticket', `<rect x="6" y="8" width="20" height="16" rx="2.5" ${line(2.4)}/><path d="M10 13.5h8M10 18.5h5" ${accent(2.2)}/>`],
  ['checklist', 'Checklist', 'Acceptance criteria', `<path d="M6.5 10.5l2 2 3.5-4M6.5 20.5l2 2 3.5-4" ${line(2.4)}/><path d="M16 11h10M16 21h10" ${accent(2.4)}/>`],
  ['inbox', 'Inbox', 'The TODO inbox', `<path d="M6 16l3-8h14l3 8v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM6 16h6a4 4 0 0 0 8 0h6" ${line(2.4)}/>`],
  ['target', 'Target', 'What the slice is for', `<circle cx="16" cy="16" r="9.5" ${line(2.4)}/><circle cx="16" cy="16" r="5" ${accent(2.4)}/><circle cx="16" cy="16" r="2"/>`],
  ['branch', 'Branch', 'An integration branch', `<path d="M10 8v16M22 8c0 7-12 5-12 12" ${line(2.4)}/>${dots(3, [10, 8], [10, 24], [22, 8])}`],
  ['pull-request', 'Pull request', 'The roll-up PR', `<path d="M9 8v16M23 24V13a4 4 0 0 0-4-4h-3M18.5 5.5L15 9l3.5 3.5" ${line(2.4)}/>${dots(3, [9, 8], [9, 24], [23, 24])}`],
  ['commit', 'Commit', 'One change on the line', `<path d="M5 16h22" ${line(2.6)}/><circle cx="16" cy="16" r="5.4"/><circle cx="16" cy="16" r="2.4" fill="${ON}"/>`],
  ['tree', 'Tree', 'A plan and what it breaks into', `<path d="M16 7.5V24M8 24v-4a3.5 3.5 0 0 1 3.5-3.5h9A3.5 3.5 0 0 1 24 20v4" ${accent(2)}/><circle cx="16" cy="7.5" r="3.2"/>${dots(2.8, [8, 24], [16, 24], [24, 24])}`],
  ['bolt', 'Bolt', 'Auto mode', '<path d="M18 4.5L7.5 18H15l-1.5 9.5L24.5 14H17z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'],
  ['infinity', 'Infinity', 'The loop that keeps going', `<path d="M16 16c-2.2-3-4-5-6.5-5a5 5 0 0 0 0 10c2.5 0 4.3-2 6.5-5 2.2-3 4-5 6.5-5a5 5 0 0 1 0 10c-2.5 0-4.3-2-6.5-5z" ${line(3)}/>`],
  ['gate', 'Gate', 'Waits for Continue', `<path d="M7 8v17M25 8v17" ${line(2.8)}/><path d="M7 12h18M7 19h18M7 19l18-7" ${accent(2.2)}/>`],
  ['clock', 'Clock', 'How long tickets take', `<circle cx="16" cy="16" r="9.5" ${line(2.4)}/><path d="M16 10.5V16l3.8 2.4" ${accent(2.4)}/>`],
  ['gauge', 'Gauge', 'Analytics', `<path d="M7 21a9.5 9.5 0 1 1 18 0" ${line(2.6)}/><path d="M16 19l5-6.5" ${accent(2.6)}/><circle cx="16" cy="19" r="2.2" fill="${ACCENT}"/>`],
  ['trend', 'Trend', 'Up and to the right', `<path d="M6 22l6-6 4 4 9.5-9.5M19.5 10.5h6v6" ${line(3)}/>`],
  ['document', 'Document', 'Specs and explainers', `<path d="M9 5h9l6 6v15a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM17.5 5.5v6h6" ${line(2.4)}/><path d="M12 17h8M12 21.5h5" ${accent(2.2)}/>`],
  ['book', 'Book', 'All documents', `<path d="M16 9c-2.5-1.8-5.5-2.5-10-2.5v15.5c4.5 0 7.5.7 10 2.5 2.5-1.8 5.5-2.5 10-2.5V6.5c-4.5 0-7.5.7-10 2.5zM16 9v15.5" ${line(2.4)}/>`],
  ['pencil', 'Pencil', 'Drafting', `<path d="M21 6l5 5L12 25l-6.5 1.5L7 20zM18 9l5 5" ${line(2.4)}/>`],
  ['grill', 'Grill', 'A plan under questioning', `<path d="M6 8.5A2.5 2.5 0 0 1 8.5 6h15A2.5 2.5 0 0 1 26 8.5v10a2.5 2.5 0 0 1-2.5 2.5H14l-5.5 5v-5A2.5 2.5 0 0 1 6 18.5z"/><g fill="${ON}">${dots(1.5, [11.5, 13.5], [16, 13.5], [20.5, 13.5])}</g>`],
  ['flame', 'Flame', 'Burning through the board', '<path d="M16 4.5c1 4 6.5 7 6.5 13.5a6.5 6.5 0 0 1-13 0c0-2.5 1-4.5 2.5-6 .5 2 1.5 3 2.5 3.2-.8-3.5-.3-7.2 1.5-10.7z"/>'],
  ['shapes', 'Shapes', 'Charts', '<circle cx="10.5" cy="10.5" r="4.5"/><rect x="17" y="6" width="9" height="9" rx="1.5" opacity=".7"/><path d="M16 18l7 8.5H9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" opacity=".85"/>'],
  ['panes', 'Panes', 'Sessions side by side', `<rect x="5.5" y="7" width="21" height="18" rx="2.5" ${line(2.4)}/><path d="M15 7v18M15 16h11.5" ${line(2.2)}/>`],
  ['window', 'Window', 'One app', `<rect x="5.5" y="7" width="21" height="18" rx="2.5" ${line(2.4)}/><path d="M5.5 12.5h21" ${line(2.2)}/><rect x="9" y="16" width="8" height="5" rx="1" fill="var(--logo-accent)"/>`],
  ['pointer', 'Pointer', 'Pick one', '<path d="M8 6l16 7.5-6.8 2.3L15 22.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'],
  ['code', 'Code', 'What it all turns into', `<path d="M12 9l-6.5 7 6.5 7M20 9l6.5 7-6.5 7" ${line(3)}/><path d="M17.5 7.5l-3 17" ${accent(2.2)}/>`],
  ['hash', 'Hash', 'TICK-n, PROJ-n, G-n', `<path d="M12.5 6.5l-2 19M21.5 6.5l-2 19M6.5 12.5h20M5.5 19.5h20" ${line(2.6)}/>`],
  ['consensus', 'Consensus', 'Only what every reviewer raised', `<circle cx="12" cy="16" r="7" ${line(2.4)}/><circle cx="20" cy="16" r="7" ${line(2.4)}/><path d="M16 10.26A7 7 0 0 1 16 21.74 7 7 0 0 1 16 10.26z" fill="${ACCENT}"/>`],
  ['lens', 'Lens', 'A closer look', `<circle cx="14" cy="14" r="7" ${line(2.6)}/><path d="M19.5 19.5L26 26" ${accent(3)}/>`],
  ['bug', 'Bug', 'Reproduced before the deploy', `<ellipse cx="16" cy="17.5" rx="5.5" ry="6.5"/><circle cx="16" cy="9" r="3"/><path d="M10.5 14l-4-2M10.5 18H6M10.5 22l-4 2M21.5 14l4-2M21.5 18H26M21.5 22l4 2" ${line(2)}/>`],
  ['agent', 'Agent', 'Who does the work', `<rect x="7" y="10" width="18" height="14" rx="3"/><g fill="${ON}">${dots(2, [12.5, 16.5], [19.5, 16.5])}</g><path d="M16 10V6.5" ${line(2.2)}/><circle cx="16" cy="5.5" r="1.8" fill="${ACCENT}"/>`],
  ['triage', 'Triage', 'Many findings, a few tickets', '<path d="M6 7h20l-7.5 9.5V25l-5-2.5v-6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'],
  ['pulse', 'Pulse', 'Live', `<path d="M5 16h5.5l3-7 5 14 3-7H27" ${line(2.8)}/>`],
  ['signal', 'Signal', 'Updates as they happen', `<circle cx="8" cy="24" r="2.6"/><path d="M8 15a9 9 0 0 1 9 9" ${line(2.6)}/><path d="M8 8a16 16 0 0 1 16 16" ${accent(2.6)}/>`],
  ['peak', 'Peak', 'The frontier, from a distance', '<path d="M4.5 24.5L13 9l5 8.5 2.5-4 7 11z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'],
])

const DRAWN: Drawn[] = [
  {
    id: 'bars',
    name: 'Bars',
    note: 'Work burning down',
    group: 'original',
    body: '<rect x="6" y="8" width="5" height="16" rx="1.5"/><rect x="13.5" y="8" width="5" height="11" rx="1.5" opacity=".8"/><rect x="21" y="8" width="5" height="7" rx="1.5" fill="var(--logo-accent)"/>',
  },
  {
    id: 'slices',
    name: 'Slices',
    note: 'Stacked builds, each a reviewable slice',
    group: 'original',
    body: '<rect x="6" y="8" width="14" height="4" rx="1.5"/><rect x="9" y="14" width="14" height="4" rx="1.5" opacity=".8"/><rect x="12" y="20" width="14" height="4" rx="1.5" fill="var(--logo-accent)"/>',
  },
  {
    id: 'chain',
    name: 'Chain',
    note: 'Plan, build, review',
    group: 'original',
    body: `<path d="M8 22l8-6 8-6" ${accent(2)}/>${dots(3, [8, 22], [16, 16])}<circle cx="24" cy="10" r="4" fill="${ACCENT}"/>`,
  },
  {
    id: 'stub',
    name: 'Stub',
    note: 'Five apps into one',
    group: 'original',
    body: '<rect x="6" y="7" width="2" height="5" rx="1"/><rect x="10.5" y="7" width="2" height="5" rx="1"/><rect x="15" y="7" width="2" height="5" rx="1"/><rect x="19.5" y="7" width="2" height="5" rx="1"/><rect x="24" y="7" width="2" height="5" rx="1"/><rect x="6" y="15" width="20" height="10" rx="2"/>',
  },
  {
    id: 'monogram',
    name: 'Monogram',
    note: 'The j every skill starts with',
    group: 'original',
    body: `<circle cx="19" cy="8.5" r="2.6" fill="${ACCENT}"/><path d="M19 14.5v6a4 4 0 0 1-4 4h-3" ${line(4.5)}/>`,
  },
  {
    id: 'ticket',
    name: 'Ticket',
    note: 'A ticket, notched and perforated',
    group: 'more',
    body: '<path d="M6 10h20v3.5a2.5 2.5 0 0 0 0 5V22H6v-3.5a2.5 2.5 0 0 0 0-5z"/><path d="M19 12.4v7.4" fill="none" stroke="var(--logo-on)" stroke-width="1.6" stroke-dasharray="1.6 2.2" stroke-linecap="round"/>',
  },
  {
    id: 'check',
    name: 'Check',
    note: 'Done',
    group: 'more',
    body: `<path d="M8 16.5l5.5 5.5L24 10.5" ${line(4)}/>`,
  },
  {
    id: 'flag',
    name: 'Flag',
    note: 'The frontier: takeable now',
    group: 'more',
    body: `<path d="M10 7v19" ${line(2.8)}/><path d="M10 8h14l-3.5 4.5L24 17H10z" fill="${ACCENT}" stroke="${ACCENT}" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  {
    id: 'loop',
    name: 'Loop',
    note: 'Implement, merge, review, again',
    group: 'more',
    body: `<path d="M24 16a8 8 0 1 1-1.1-4" ${line(3)}/><path d="M23.6 6.5V12h-5.5" ${accent(3)}/>`,
  },
  {
    id: 'play',
    name: 'Play',
    note: 'The jButton',
    group: 'more',
    body: '<path d="M12 9.5l11 6.5-11 6.5z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  },
  {
    id: 'merge',
    name: 'Merge',
    note: 'A branch landing',
    group: 'more',
    body: `<path d="M10 9v14M10 9c0 7 5 7 12 7" ${line(2.6)}/>${dots(3.2, [10, 9], [10, 23], [22, 16])}`,
  },
  {
    id: 'stack',
    name: 'Stack',
    note: 'One build stacked on another',
    group: 'more',
    body: `<path d="M16 6.5l9.5 4.75L16 16l-9.5-4.75z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.5 16l9.5 4.75L25.5 16M6.5 20.75L16 25.5l9.5-4.75" ${line(2.4)}/>`,
  },
  {
    id: 'graph',
    name: 'Graph',
    note: 'Projects leading into each other',
    group: 'more',
    body: `<path d="M16 8L8 16l8 8 8-8z" ${accent(2)}/>${dots(3.2, [16, 8], [8, 16], [24, 16], [16, 24])}`,
  },
  {
    id: 'steps',
    name: 'Steps',
    note: 'A burndown, one step at a time',
    group: 'more',
    body: `<path d="M7 9h5v5h5v5h5v4h4" ${line(3)}/>`,
  },
  {
    id: 'climb',
    name: 'Climb',
    note: 'Each loop ships more',
    group: 'more',
    body: '<rect x="6" y="18" width="5" height="7" rx="1.5" fill="var(--logo-accent)"/><rect x="13.5" y="13" width="5" height="12" rx="1.5" opacity=".8"/><rect x="21" y="7" width="5" height="18" rx="1.5"/>',
  },
  {
    id: 'hex',
    name: 'Cell',
    note: 'One app, everything inside',
    group: 'more',
    body: `<path d="M16 6l8.66 5v10L16 26l-8.66-5V11z" ${line(2.6)}/><circle cx="16" cy="16" r="3.2" fill="${ACCENT}"/>`,
  },
  {
    id: 'brackets',
    name: 'Brackets',
    note: 'A ticket, in code',
    group: 'more',
    body: `<path d="M12 8H8v16h4M20 8h4v16h-4" ${line(3)}/><circle cx="16" cy="16" r="2.8" fill="${ACCENT}"/>`,
  },
  {
    id: 'prompt',
    name: 'Prompt',
    note: 'Every session runs in a terminal',
    group: 'more',
    body: `<path d="M8 10l7 6-7 6M17.5 22.5H25" ${line(3.2)}/>`,
  },
  {
    id: 'herd',
    name: 'Herd',
    note: 'Agents, dispatched together',
    group: 'more',
    body: dots(2.9, [16, 8.5], [11.5, 16], [20.5, 16], [7, 23.5], [16, 23.5], [25, 23.5]),
  },
  {
    id: 'orbit',
    name: 'Orbit',
    note: 'An agent circling its ticket',
    group: 'more',
    body: `<circle cx="16" cy="16" r="8.5" ${accent(2.2)}/><circle cx="16" cy="16" r="3"/><circle cx="22" cy="10" r="3.4" fill="${ACCENT}"/>`,
  },
  {
    id: 'diff',
    name: 'Diff',
    note: 'Lines added, lines removed',
    group: 'more',
    body: `<path d="M8 11h6M11 8v6M18 11h7" ${line(2.8)}/><path d="M8 21h6M18 21h4" ${accent(2.8)}/>`,
  },
  {
    id: 'eye',
    name: 'Eye',
    note: 'Every slice gets reviewed',
    group: 'more',
    body: `<path d="M5.5 16s4-7 10.5-7 10.5 7 10.5 7-4 7-10.5 7S5.5 16 5.5 16z" ${line(2.4)}/><circle cx="16" cy="16" r="3.4" fill="${ACCENT}"/>`,
  },
  {
    id: 'compass',
    name: 'Compass',
    note: 'A plan to steer by',
    group: 'more',
    body: `<circle cx="16" cy="16" r="9.5" ${line(2.4)}/><path d="M21 11l-3 7-7 3 3-7z" fill="${ACCENT}"/>`,
  },
  {
    id: 'route',
    name: 'Route',
    note: 'From here to shipped',
    group: 'more',
    body: `<path d="M9 23c0-9 14-5 14-14" ${line(2.4)} stroke-dasharray="0.1 4.2"/>${dots(3.2, [9, 23], [23, 9])}`,
  },
  {
    id: 'spark',
    name: 'Spark',
    note: 'A fresh coat of paint',
    group: 'more',
    body: '<path d="M16 5c1 6.5 4.5 10 11 11-6.5 1-10 4.5-11 11-1-6.5-4.5-10-11-11 6.5-1 10-4.5 11-11z"/>',
  },
  {
    id: 'roller',
    name: 'Roller',
    note: 'The repaint itself',
    group: 'more',
    body: `<rect x="6" y="7" width="16" height="7" rx="2"/><path d="M22 10.5h3.5v6H16v3" ${line(2.2)}/><rect x="14" y="19" width="4" height="7" rx="1.6" fill="${ACCENT}"/>`,
  },
  {
    id: 'converge',
    name: 'Converge',
    note: 'Five lines of work, one stream',
    group: 'more',
    body: `<path d="M6 8c6 0 6 8 12 8M6 12c5 0 6 4 12 4M6 20c5 0 6-4 12-4M6 24c6 0 6-8 12-8" ${accent(1.8)}/><path d="M6 16h20" ${line(2.6)}/>`,
  },
  {
    id: 'tally',
    name: 'Tally',
    note: 'Tickets counted off',
    group: 'more',
    body: `<path d="M9 8v16M13.5 8v16M18 8v16M22.5 8v16" ${line(2.6)}/><path d="M6 21.5L26 10.5" ${accent(2.6)}/>`,
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    note: 'What needs you today',
    group: 'more',
    body: `<path d="M9 21a7 7 0 0 1 14 0z" fill="${ACCENT}"/><path d="M6 25h20M16 7v3M8 12l2 2M24 12l-2 2" ${line(2.4)}/>`,
  },
  {
    id: 'pixel',
    name: 'Pixel j',
    note: 'The j, set in blocks',
    group: 'more',
    body: '<rect x="18" y="5" width="4.5" height="4" fill="var(--logo-accent)"/><rect x="18" y="11" width="4.5" height="15"/><rect x="9.5" y="21.5" width="8.5" height="4.5"/><rect x="9.5" y="17" width="4.5" height="4.5"/>',
  },
  ...TICKET_MARKS,
  ...J_MARKS,
  ...J_COLOUR_MARKS,
  ...EXTRA_MARKS,
]

// A mark with no palette of its own is dealt one by its place in the list;
// stepping three at a time keeps neighbours in the gallery apart.
const PALETTE_KEYS = Object.keys(PALETTES) as Palette[]
export const LOGO_MARKS: LogoMark[] = DRAWN.map(({ palette, ...mark }, i) => ({
  ...mark,
  colors: PALETTES[palette ?? PALETTE_KEYS[(i * 3) % PALETTE_KEYS.length]!],
}))

export const DEFAULT_LOGO = 'bars'

/** The mark with this id — or the default one, for an id that names none (a stale cookie). */
export function findLogo(id: string | null | undefined): LogoMark {
  return LOGO_MARKS.find((m) => m.id === id) ?? LOGO_MARKS.find((m) => m.id === DEFAULT_LOGO)!
}

/**
 * A mark as a tab icon: a data URI holding the whole SVG with its colours
 * written in. No plate, so it sits straight on the browser's tab strip.
 */
export function logoFavicon(mark: LogoMark): string {
  const { main, accent } = mark.colors
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" style="color:${main};--logo-accent:${accent};--logo-on:${LOGO_ON}">` +
    `<g fill="currentColor">${mark.body}</g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
