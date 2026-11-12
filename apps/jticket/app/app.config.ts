export default defineAppConfig({
  ui: {
    // Ink: primary and neutral are the same zinc scale, and main.css pins
    // --ui-primary to its darkest step (lightest in dark mode) — buttons,
    // active nav and the frontier are ink, never a hue. Success/info/warning/
    // error keep their own hues: colour on a page only ever means status.
    colors: {
      primary: 'zinc',
      neutral: 'zinc',
    },
  },
})
