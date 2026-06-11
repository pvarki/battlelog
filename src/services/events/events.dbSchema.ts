import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { events } from "../../db/schema.ts";

const pointTuple = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).nullable();

export const eventDbInsertSchema = createInsertSchema(events, {
  locationPoint: () => pointTuple.optional(),
  data: () => z.unknown().optional(),
});

export const eventDbSelectSchema = createSelectSchema(events, {
  locationPoint: () => pointTuple,
  data: () => z.unknown().nullable(),
});

export type EventDbInsert = z.infer<typeof eventDbInsertSchema>;
export type EventDbRow = z.infer<typeof eventDbSelectSchema>;
