import "@univerjs/preset-sheets-core/lib/index.css";
import "./univer.css";

import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { createUniver, darkBlueTheme, LocaleType, mergeLocales } from "@univerjs/presets";

/**
 * Univer otherwise starts with a bright office-sheet palette. Keep its color
 * scale in the same order as its built-in dark theme, but use the BattleLog
 * design tokens so the canvas, controls, selection and status colors belong
 * to the dashboard rather than looking like an embedded third-party app.
 */
const TABLE_THEME = {
  ...darkBlueTheme,
  primary: {
    50: "#eaf3ff",
    100: "#d3e5ff",
    200: "#b0d0ff",
    300: "#9dc5ff",
    400: "#8abbff",
    500: "#6ea6f2",
    600: "#5590dd",
    700: "#437ac0",
    800: "#3364a2",
    900: "#244e84",
  },
  gray: {
    0: "#111418",
    50: "#1c2127",
    100: "#252a31",
    200: "#2f343c",
    300: "#383e47",
    400: "#6e7683",
    500: "#a0a8b3",
    600: "#c9cdd3",
    700: "#f6f7f9",
    800: "#f6f7f9",
    900: "#f6f7f9",
    1000: "#ffffff",
  },
  blue: {
    50: "#244e84",
    100: "#3364a2",
    200: "#437ac0",
    300: "#5590dd",
    400: "#6ea6f2",
    500: "#8abbff",
    600: "#9dc5ff",
    700: "#b0d0ff",
    800: "#d3e5ff",
    900: "#eaf3ff",
  },
  red: {
    50: "#7d2f32",
    100: "#a03c40",
    200: "#c44a4e",
    300: "#e35d61",
    400: "#ef7a7f",
    500: "#fa999c",
    600: "#faadb0",
    700: "#fac2c4",
    800: "#fbd8d9",
    900: "#fdecec",
  },
  orange: {
    50: "#71461a",
    100: "#945c22",
    200: "#b8722a",
    300: "#db8b32",
    400: "#eb9f49",
    500: "#fbb360",
    600: "#fcc482",
    700: "#fcd4a4",
    800: "#fde4c6",
    900: "#fef2e3",
  },
  yellow: {
    50: "#71461a",
    100: "#945c22",
    200: "#b8722a",
    300: "#db8b32",
    400: "#eb9f49",
    500: "#fbb360",
    600: "#fcc482",
    700: "#fcd4a4",
    800: "#fde4c6",
    900: "#fef2e3",
  },
  green: {
    50: "#1f4e35",
    100: "#2a6746",
    200: "#368359",
    300: "#43a377",
    400: "#5ab789",
    500: "#72ca9b",
    600: "#91d5b2",
    700: "#b0e1c8",
    800: "#ccecdc",
    900: "#e6f6ee",
  },
} as const;

// The core preset does not include pictures or charts. These entries remove
// structural spreadsheet actions from the remaining contextual UI. Clipboard
// shortcuts and the context menu remain available.
const TABLE_MENU = {
  // Keep the basic font controls, but omit Excel's number-format ribbon,
  // layout/colour tools, large formula catalogue, and collaboration tools.
  // Formulas remain available by typing `=` into a cell or the formula bar.
  "sheet.operation.open.numfmt.panel": { hidden: true },
  "sheet.command.numfmt.set.percent": { hidden: true },
  "sheet.command.numfmt.set.currency": { hidden: true },
  "sheet.command.numfmt.add.decimal.command": { hidden: true },
  "sheet.command.numfmt.subtract.decimal.command": { hidden: true },
  "formula-ui.operation.insert-function.common": { hidden: true },
  "formula-ui.operation.insert-function.financial": { hidden: true },
  "formula-ui.operation.insert-function.logical": { hidden: true },
  "formula-ui.operation.insert-function.text": { hidden: true },
  "formula-ui.operation.insert-function.date": { hidden: true },
  "formula-ui.operation.insert-function.lookup": { hidden: true },
  "formula-ui.operation.insert-function.math": { hidden: true },
  "formula-ui.operation.insert-function.statistical": { hidden: true },
  "formula-ui.operation.insert-function.engineering": { hidden: true },
  "formula-ui.operation.insert-function.information": { hidden: true },
  "formula-ui.operation.insert-function.database": { hidden: true },
  "sheet.command.set-horizontal-text-align": { hidden: true },
  "sheet.command.set-vertical-text-align": { hidden: true },
  "sheet.command.set-text-wrap": { hidden: true },
  "sheet.command.set-shrink-to-fit": { hidden: true },
  "sheet.command.set-text-rotation": { hidden: true },
  "sheet.command.set-range-text-color": { hidden: true },
  "sheet.command.reset-text-color": { hidden: true },
  "sheet.command.set-background-color": { hidden: true },
  "sheet.command.reset-background-color": { hidden: true },
  "sheet.command.set-border-basic": { hidden: true },
  "sheet.command.add-worksheet-merge": { hidden: true },
  "sheet.command.remove-worksheet-merge": { hidden: true },
  "sheet.command.toggle-gridlines": { hidden: true },
  "base-ui.operation.toggle-fullscreen": { hidden: true },
  "sheet.menu.paste": { hidden: true },
  // These occupy a separate top-right toolbar group. The table is local to a
  // dashboard, so range protection and the shortcut reference panel add
  // visual weight without a useful action here.
  "sheet.command.add-range-protection-from-toolbar": { hidden: true },
  "base-ui.operation.toggle-shortcut-panel": { hidden: true },
  "ui.operation.open-feature-search": { hidden: true },
  "sheet.command.insert-row": { hidden: true },
  "sheet.command.insert-row-before": { hidden: true },
  "sheet.command.insert-row-after": { hidden: true },
  "sheet.command.insert-multi-rows-above": { hidden: true },
  "sheet.command.insert-multi-rows-after": { hidden: true },
  "sheet.command.insert-col": { hidden: true },
  "sheet.command.insert-col-before": { hidden: true },
  "sheet.command.insert-col-after": { hidden: true },
  "sheet.command.insert-multi-cols-before": { hidden: true },
  "sheet.command.insert-multi-cols-right": { hidden: true },
  "sheet.command.remove-row": { hidden: true },
  "sheet.command.remove-row-confirm": { hidden: true },
  "sheet.command.remove-col": { hidden: true },
  "sheet.command.remove-col-confirm": { hidden: true },
  "sheet.command.insert-sheet": { hidden: true },
  "sheet.command.remove-sheet": { hidden: true },
  "sheet.command.remove-sheet-confirm": { hidden: true },
  "sheet.command.copy-worksheet": { hidden: true },
  "sheet.command.set-worksheet-name": { hidden: true },
  "sheet.command.set-worksheet-hidden": { hidden: true },
} as const;

const TABLE_FONT_CANDIDATES = [
  "Inter",
  "Arial",
  "Calibri",
  "Cambria",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Noto Sans",
  "DejaVu Sans",
];

// Univer's default menu lists a large catalogue of operating-system fonts.
// Keep only fonts that this browser can actually render. Inter is bundled by
// BattleLog and remains the safe fallback while its webfont finishes loading.
const availableTableFonts = () => {
  const canvas = globalThis.document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return [{ value: "Inter", label: "Inter" }];

  const sample = "abcdefghijklmnopqrstuvwxyz0123456789";
  const baseFonts = ["monospace", "serif", "sans-serif"];
  const baselineWidths = new Map(
    baseFonts.map((base) => {
      context.font = `72px ${base}`;
      return [base, context.measureText(sample).width];
    }),
  );
  const supported = TABLE_FONT_CANDIDATES.filter((font) =>
    baseFonts.some((base) => {
      context.font = `72px "${font}", ${base}`;
      return context.measureText(sample).width !== baselineWidths.get(base);
    }),
  );
  const fonts = supported.includes("Inter") ? supported : ["Inter", ...supported];
  return fonts.map((value) => ({ value, label: value }));
};

/**
 * Kept in its own dynamic module so the full spreadsheet editor is not part
 * of the normal dashboard payload or its service-worker app shell.
 */
export const createTableUniver = (container: HTMLElement, snapshot: unknown) => {
  // Scope table-specific Univer adjustments so they cannot affect another
  // spreadsheet instance added elsewhere in the application.
  container.classList.add("table-univer");

  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    theme: TABLE_THEME,
    locales: {
      [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS),
    },
    presets: [
      UniverSheetsCorePreset({
        container,
        header: true,
        toolbar: true,
        // A flat compact toolbar has the Excel-like controls without the
        // ribbon tabs and application menu.
        ribbonType: "simple",
        formulaBar: true,
        footer: false,
        contextMenu: true,
        disableAutoFocus: true,
        menu: TABLE_MENU,
        customFontFamily: { override: true, list: availableTableFonts() },
      }),
    ],
  });

  // The core preset installs its menu items while it boots. Apply the table
  // overrides once more after that registration so these items are removed
  // from the toolbar rather than merely inheriting a disabled state.
  univerAPI.updateMenuConfig(TABLE_MENU);

  const workbook = univerAPI.createWorkbook(
    snapshot as Parameters<typeof univerAPI.createWorkbook>[0],
  );
  return { univer, univerAPI, workbook };
};
