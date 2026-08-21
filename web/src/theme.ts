import { Anchor, createTheme, Input } from "@mantine/core";

/**
 * Battlelog design tokens (dark-only): Inter, 6px radius.
 * bg #111418 · surface #1c2127 · surface-secondary #252a31 · field #2f343c ·
 * border #383e47 · text #f6f7f9 · text-muted #a0a8b3 · accent #8abbff ·
 * primary #394494 · success #72ca9b · warning #fbb360 · danger #fa999c
 *
 * Mantine's dark scheme reads: body ← dark-7, Paper ← dark-6, borders ← dark-4,
 * dimmed text ← dark-2 — the tokens are placed on those slots.
 */
export const theme = createTheme({
  fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
  defaultRadius: 6,
  primaryColor: "primary",
  primaryShade: 6,
  colors: {
    dark: [
      "#f6f7f9", // 0 text
      "#c9cdd3",
      "#a0a8b3", // 2 text-muted ("dimmed")
      "#6e7683",
      "#383e47", // 4 border
      "#2f343c", // 5 field / hover
      "#1c2127", // 6 surface (Paper)
      "#111418", // 7 bg (body)
      "#0d1013",
      "#090b0e",
    ],
    primary: [
      "#eceef9",
      "#d3d7ef",
      "#b7bde4",
      "#9aa2d8",
      "#7d87cb",
      "#5a66b3",
      "#394494", // token
      "#2f3a7e",
      "#262f67",
      "#1d2450",
    ],
    accent: [
      "#eaf3ff",
      "#d3e5ff",
      "#b0d0ff",
      "#9dc5ff",
      "#8abbff", // token
      "#6ea6f2",
      "#5590dd",
      "#437ac0",
      "#3364a2",
      "#244e84",
    ],
  },
  // Type ramp: body 14, small 12, caption 11.
  fontSizes: {
    xs: "0.6875rem",
    sm: "0.75rem",
    md: "0.875rem",
    lg: "1rem",
    xl: "1.125rem",
  },
  headings: {
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "2rem" },
      h2: { fontSize: "1.5rem" },
      h3: { fontSize: "1.125rem" },
    },
  },
  components: {
    // Fields sit a step above the surface (#2f343c) per the token sheet.
    Input: Input.extend({
      styles: { input: { backgroundColor: "var(--mantine-color-dark-5)" } },
    }),
    // Filled primary (#394494) is too dark for link text on dark surfaces.
    Anchor: Anchor.extend({ defaultProps: { c: "accent.4" } }),
  },
});
