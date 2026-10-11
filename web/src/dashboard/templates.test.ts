import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { validateWidgetConfig } from "./registry.ts";

// An invalid config doesn't fail seeding — the widget just renders an error in
// the browser — so deployment templates are checked against the web schemas here.
const dir = new URL("../../../server/templates/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

type Widget = { id: string; type: string; config: unknown };

test.each(files)("%s widgets validate", (file) => {
  const template = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as { widgets: Widget[] };
  const tabs = template.widgets.flatMap((w) =>
    w.type === "tabs" ? (w.config as { tabs: Widget[] }).tabs : [],
  );
  for (const w of [...template.widgets, ...tabs]) {
    expect(validateWidgetConfig(w.type, w.config), `${file} → ${w.id}`).toMatchObject({ ok: true });
  }
});
