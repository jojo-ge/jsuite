export default defineAppConfig({
  ui: {
    // Primary is the mark's periwinkle (see main.css @theme) so buttons, active
    // nav and links are the same blue as the icon. Success/warning/error keep
    // their own hues — the board leans on green-means-done, so primary must not
    // be green.
    colors: {
      primary: 'periwinkle',
      neutral: 'slate',
    },
  },
})
