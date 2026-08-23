import { IconNote } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor, WidgetDocumentDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

const configSchema = z
  .object({
    ...baseWidgetConfig,
    /**
     * Logical event id the note follows: content lives in the event log as a
     * type:"note" event, and every edit appends a version to its chain.
     * Unset until the first save creates the event; editable in settings to
     * follow another note, or cleared to start a new one on next edit.
     */
    eventId: z.string().uuid().optional(),
  })
  .strict();

export type NoteConfig = z.infer<typeof configSchema>;
export type NoteDoc = { text: string };

/** Event header shown in the log: the note's first line. */
export const headerFor = (text: string): string => {
  const line = text.split("\n", 1)[0]?.trim() ?? "";
  return (line || "Note").slice(0, 80);
};

export const widgetDocument: WidgetDocumentDescriptor<NoteConfig, NoteDoc> = {
  eventType: "note",
  empty: { text: "" },
  parse: (data) => ({ text: (data as { text?: string } | null)?.text ?? "" }),
  headerFor: (_config, doc) => headerFor(doc.text),
  debounceMs: 2000,
};

export const descriptor: WidgetDescriptor<NoteConfig> = {
  type: "note",
  Icon: IconNote,
  name: "Note",
  description: "Free-text note, stored as a versioned event",
  configSchema,
  defaultConfig: {},
  defaultSize: { w: 10, h: 6 },
  minSize: { w: 5, h: 3 },
  document: widgetDocument,
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
