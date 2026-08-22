import { Anchor, createTheme, Input } from "@mantine/core";

/**
 * Battlelog design tokens (dark-only): Inter, 6px radius.
 * bg #111418 · surface #1c2127 · surface-secondary #252a31 · field #2f343c ·
 * border #383e47 · text #f6f7f9 · text-muted #a0a8b3 · accent #8abbff ·
 * primary #394494 · success #72ca9b · warning #fbb360 · danger #fa999c
 *
 * Mantine's dark scheme reads: body ← dark-7, Paper ← dark-6, borders ← dark-4,
 * dimmed text ← dark-2 — the tokens are placed on those slots.
 *
 * Semantic ramps carry the sheet's success/warning/danger tones: shade 4 is
 * the token (legible text on dark), shade 6 the vivid fill. They also override
 * Mantine's stock red/green/orange so existing call sites inherit the sheet.
 */
const DANGER = [
  "#fdecec",
  "#fbd8d9",
  "#fac2c4",
  "#faadb0",
  "#fa999c", // token
  "#ef7a7f",
  "#e35d61", // fill
  "#c44a4e",
  "#a03c40",
  "#7d2f32",
] as const;

const SUCCESS = [
  "#e6f6ee",
  "#ccecdc",
  "#b0e1c8",
  "#91d5b2",
  "#72ca9b", // token
  "#5ab789",
  "#43a377", // fill
  "#368359",
  "#2a6746",
  "#1f4e35",
] as const;

const WARNING = [
  "#fef2e3",
  "#fde4c6",
  "#fcd4a4",
  "#fcc482",
  "#fbb360", // token
  "#eb9f49",
  "#db8b32", // fill
  "#b8722a",
  "#945c22",
  "#71461a",
] as const;

export const theme = createTheme({
  fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
  defaultRadius: 6,
  primaryColor: "primary",
  primaryShade: 6,
  // Filled components pick dark text on light fills (AA on user-chosen chip colors).
  autoContrast: true,
  colors: {
    danger: DANGER,
    success: SUCCESS,
    warning: WARNING,
    red: DANGER,
    green: SUCCESS,
    orange: WARNING,
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
