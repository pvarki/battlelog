import { IconChecklist } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

const configSchema = z
  .object({
    ...baseWidgetConfig,
    /**
     * Logical event id the list follows: items live in the event log as a
     * type:"todo" event, and every change appends a version to its chain.
     * Unset until the first save creates the event; point two widgets at the
     * same id to share a list, or clear to start a new one on next edit.
     */
    eventId: z.string().uuid().optional(),
  })
  .strict();

export type TodoConfig = z.infer<typeof configSchema>;

const todoItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

/** Tolerant read: an event with foreign or malformed data renders empty, not a crash. */
export const parseItems = (data: unknown): TodoItem[] => {
  const parsed = z.object({ items: z.array(todoItemSchema) }).safeParse(data);
  return parsed.success ? parsed.data.items : [];
};

/** Event header shown in the log: completion count. */
export const headerFor = (items: TodoItem[]): string =>
  `Todo ${items.filter((i) => i.done).length}/${items.length}`;

const descriptor: WidgetDescriptor<TodoConfig> = {
  type: "todo",
  Icon: IconChecklist,
  name: "Todo",
  description: "Checkbox list stored as a versioned event — tap to mark done",
  configSchema,
  defaultConfig: {},
  defaultSize: { w: 8, h: 8 },
  minSize: { w: 4, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
