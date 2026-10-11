import { z } from "zod";

/** Fixed palette: token-friendly Mantine colors that stay legible on dark. */
export const STATUS_COLORS = ["gray", "blue", "green", "yellow", "orange", "red"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

export const optionSchema = z.object({
  value: z.string().min(1).max(40),
  color: z.enum(STATUS_COLORS).default("gray"),
  /** Shown as a tooltip when hovering the chip while this option is selected. */
  description: z.string().max(300).optional(),
});
export type StatusOption = z.infer<typeof optionSchema>;

/** How a bound value renders and edits; shared by status rows/properties and table columns. */
export type ValueSpec = {
  kind: "choice" | "count" | "text" | "boolean";
  options: StatusOption[];
  editable: boolean;
};
