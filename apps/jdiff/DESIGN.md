---
name: jDiff
description: A local GitHub client that's really good at diffs — AI-guided code review in a quiet dark reading room.
colors:
  graphite-base: "#0d1117"
  graphite-panel: "#161b22"
  graphite-raised: "#1c2129"
  carve-border: "#30363d"
  ink: "#e6edf3"
  graphite-muted: "#8b949e"
  cursor-blue: "#58a6ff"
  diff-green: "#3fb950"
  diff-red: "#f85149"
  risk-amber: "#d29922"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  display:
    fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
  code:
    fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    lineHeight: "20px"
  label:
    fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
rounded:
  xs: "4px"
  sm: "5px"
  md: "6px"
  lg: "8px"
  bar: "10px"
  pill: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-quiet:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.graphite-muted}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  button-quiet-hover:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  button-primary:
    backgroundColor: "{colors.cursor-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "4px 14px"
  badge-pill:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-muted}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  input-field:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  card-panel:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
---

# Design System: jDiff

## 1. Overview

**Creative North Star: "The Reading Room"**

jDiff is a quiet, dark study built for one job: reading code with full attention. The diff is the room; every other element — navigation, guidance, notifications — is furniture, arranged so nothing competes with the code for attention. The palette is dimmed graphite: matte, understated layers of blue-black that recede behind syntax-highlighted code, with a single Cursor Blue accent that marks wherever the reviewer's attention should go next. Warmth lives in the words (the tours, the ask-yourself prompts, the patient guidance), never in the chrome.

The system explicitly rejects AI-tool gimmickry (no sparkle icons, purple gradients, or chat bubbles), enterprise-dashboard density-without-purpose, SaaS polish, and consumer-cute softness. It also refuses to be a GitHub clone: the diff idiom stays familiar — side-by-side, green/red, mono gutters — but executed with more care, and everything around the diff speaks in jDiff's own gritty, lowercase, workmanlike voice.

**Key Characteristics:**
- Dark, flat, border-defined; surfaces are carved by 1px lines, not lifted by shadows.
- Monospace is the voice of anything git-flavored: brand, paths, branches, stats, logs, labels.
- One accent (Cursor Blue) marks interactivity and attention; green/red/amber are reserved semantic signals.
- Small, dense, sturdy controls that rest muted and wake on interaction.
- Lowercase, terse copy ("open", "recent", "point at a local clone").

## 2. Colors: The Dimmed Graphite Palette

Matte layers of blue-black graphite carve the space; one blue voice directs attention; green, red, and amber speak only with semantic meaning.

### Primary
- **Cursor Blue** (#58a6ff): The single accent. Links, focused borders, active states, tour highlights, the primary action button, the notification dot. It means "your attention here" — and its discipline is what keeps the room quiet.

### Neutral
- **Graphite Base** (#0d1117): The page itself. The darkest layer; also used as the recessed background inside comment rows and textareas.
- **Graphite Panel** (#161b22): The default surface for cards, lists, sidebars, and controls — one step off the base.
- **Graphite Raised** (#1c2129): The second step: file headers, hover fills, code blocks, nested surfaces inside panels.
- **Carve Border** (#30363d): The 1px line that does the work shadows would do elsewhere. Every panel, control, and divider is drawn with it.
- **Ink** (#e6edf3): Primary text. High-contrast, comfortable for long reading sessions.
- **Graphite Muted** (#8b949e): Secondary text — metadata, labels, resting control text. Never for body prose.

### Semantic
- **Diff Green** (#3fb950): Additions, approvals, good scores, low risk. Paired with translucent washes rgba(46,160,67,0.15) for added-line backgrounds and 0.3 for their gutters.
- **Diff Red** (#f85149): Deletions, requested changes, bad scores, high risk, destructive hovers. Washes rgba(248,81,73,0.12) / 0.28.
- **Risk Amber** (#d29922): Medium risk and staleness. The only voice between green and red.

### Named Rules
**The One Voice Rule.** Cursor Blue is the only decorative accent, and it always means "attention" or "interactive". Green, red, and amber may appear only with their semantic meaning (diff status, risk, verdicts) — never as decoration.

**The Wash Rule.** Colored area fills are translucent washes over the graphite (12–30% alpha), never opaque color blocks. Tints layer via background-image so diff coloring and tour highlights stack without erasing each other.

## 3. Typography

**Display/Label Font:** ui-monospace, 'SF Mono', Menlo, Consolas (the mono stack)
**Body Font:** -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial (system sans)

**Character:** The system sans is invisible infrastructure for prose; the monospace is jDiff's actual voice — anything that comes from git or names the tool itself speaks in mono. The pairing contrasts on axis (system UI vs. terminal), never competes.

### Hierarchy
- **Display** (700, 28px, mono): The wordmark "jDiff" on the home page. Always cased exactly "jDiff".
- **Headline** (600, 20px, sans): PR titles. The largest sans on any screen.
- **Body** (400, 13–14px, sans, 1.5): Prose — summaries, comments, guidance, answers. Cap reading columns near 700px (~70ch).
- **Code** (400, 12px / 20px line-height, mono): Diff content, file paths, branches, stats, logs.
- **Label** (400–600, 10–11px, mono or sans): Badges, buttons, metadata, section labels. The one uppercase exception: rare tracked section labels like "recent" (letter-spacing 0.05–0.08em).

### Named Rules
**The Mono Voice Rule.** If it came from git or names the tool — paths, branches, +/− stats, hashes, the brand — it is monospace. If it's for a human to read as prose, it is sans. No exceptions in either direction.

**The Lowercase Rule.** The brand, buttons, and short UI copy are lowercase ("open", "refresh", "recent"). Title Case is for PR titles and user content only.

## 4. Elevation

Flat by doctrine. Surfaces do not lift; they are carved apart by 1px Carve Border lines and one-step background shifts (Base → Panel → Raised). Shadows exist only for the two things that genuinely float above the page — the tour bar and the notification panel — and there they are heavy and honest, not ambient decoration.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px rgba(0,0,0,0.5)` to `0 8px 30px rgba(0,0,0,0.5)`): Reserved for fixed/absolute elements layered over content (tour bar, notification dropdown). Nothing else casts a shadow.

### Named Rules
**The Carved Rule.** Depth is drawn, not cast. If an element sits in the page flow, it gets a border, not a shadow. If it floats over the page, it gets the Float shadow — both, always.

## 5. Components

Workmanlike and sturdy: plain, honest controls that feel hand-made rather than design-system-issued. Everything rests muted and quiet; interaction wakes it with Cursor Blue.

### Buttons
- **Shape:** Gently rounded (5–6px); small and dense (padding 4px 10–14px, font-size 11–12px).
- **Quiet (default):** Graphite Panel fill, Carve Border, Graphite Muted text. Hover: border turns Cursor Blue, text turns Ink. This is almost every button in the app.
- **Primary:** Cursor Blue fill, white text — reserved for the single advancing action in a context (tour "next", comment "post").
- **Ghost:** Transparent fill, muted text; hover brings the accent border. Used for dismiss/secondary actions.
- **Destructive hover:** Close/dismiss controls turn Diff Red on hover instead of blue.
- **Disabled:** opacity 0.4–0.5, cursor default. No color change.

### Badges
- **Style:** Bordered pills (radius 10px, padding 1px 8px, font-size 11px), transparent fill. Color states recolor both text and border together: green = approved/good, red = changes/bad, blue = mid score, amber = stale. Score badges are mono.

### Cards / Containers
- **Corner Style:** 8px radius.
- **Background:** Graphite Panel; nested surfaces (logs, code, thinking traces) step to Graphite Raised.
- **Border:** 1px Carve Border, always. No shadow (see Elevation).
- **Internal Padding:** 12px 16px.

### Inputs / Fields
- **Style:** 1px Carve Border, 6px radius, Graphite Panel or Base fill, mono for path-like input.
- **Focus:** Border turns Cursor Blue. `outline: none` is compensated by the border shift — keep the change ≥3:1 contrast.
- **Textareas:** Vertically resizable, Base fill, same focus behavior.

### Navigation
- **Pattern:** No global chrome. Each page opens with a baseline-aligned bar: mono bold "jDiff" wordmark, context (repo slug / PR number) in muted, actions pushed right with `margin-left: auto`.
- **Sidebar (file nav):** Sticky bordered panel; mono 11px file rows, hover fill Graphite Raised, dot indicators for risk (green/amber/red).
- **Segmented modes:** Bordered pill group on Graphite Raised; active segment gets Panel fill + 1px ring.

### The Tour Bar (signature)
The guided-review voice made visible: a floating, bottom-centered bar (min(680px, 100vw − 32px), 10px radius) with a Cursor Blue border and the Float shadow. Mono step counter in blue, sans note text, keyboard hints in muted, primary/quiet nav buttons right-aligned. It is the one element allowed to sit above the diff — because it is the guide.

### Diff Grid (signature)
Side-by-side CSS grid (`minmax(52px, auto) 1fr` ×2), mono 12px on 20px lines. Gutter numbers muted and right-aligned; add/del washes per The Wash Rule; hunk headers as full-width blue-tinted rows; tour highlights layer a blue wash plus a 3px inset accent edge on the gutter.

## 6. Do's and Don'ts

### Do:
- **Do** keep the diff the room: chrome stays graphite and muted, code carries all the color.
- **Do** carve with 1px Carve Border (#30363d) lines and background steps; reserve the Float shadow for the tour bar and notification panel only.
- **Do** put anything git-flavored in monospace and keep UI copy lowercase and terse.
- **Do** rest controls muted and wake them with Cursor Blue on hover/focus.
- **Do** hold WCAG AA: body text ≥4.5:1 (Ink on any graphite layer passes; Graphite Muted is for metadata ≥12px, never prose), visible focus states, reduced-motion alternatives for any animation.
- **Do** keep reading columns near 700px while letting the diff layout span the full width.

### Don't:
- **Don't** ship AI-tool gimmickry: no sparkle icons, purple gradients, glassmorphism, or chat bubbles. The AI layer looks like review expertise (cards, tours, questions), not a costume.
- **Don't** drift into enterprise-dashboard territory: no KPI tiles, card walls, or chrome that outweighs content.
- **Don't** read as a GitHub clone: the diff idiom is shared vocabulary, but layouts, voice, and guidance surfaces are jDiff's own.
- **Don't** go SaaS-glossy or consumer-cute: no onboarding funnels, marketing sheen, bouncy motion, or illustration-heavy friendliness. Keep the gritty local-tool feel.
- **Don't** use color decoratively: green/red/amber only with semantic meaning; a second decorative accent is prohibited.
- **Don't** cast shadows on in-flow elements or use opaque color blocks where a wash belongs.
