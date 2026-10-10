import "@univerjs/preset-sheets-core/lib/index.css";

import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";

// The core preset does not include pictures or charts. These entries remove
// structural spreadsheet actions from the remaining contextual UI, while
// keeping normal cut/copy/paste available.
const TABLE_MENU = {
  // Keep the basic font controls, but omit Excel's number-format ribbon,
  // layout/colour tools, and large formula catalogue. Formulas remain
  // available by typing `=` into a cell or the formula bar.
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
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
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

  const workbook = univerAPI.createWorkbook(
    snapshot as Parameters<typeof univerAPI.createWorkbook>[0],
  );
  return { univer, univerAPI, workbook };
};
