import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { widgetSchema } from "../routes/dashboards/dashboards.apiSchema.ts";
import { db } from "./client.ts";
import { dashboards } from "./schema.ts";

const templateFileSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(280).optional(),
  widgets: z.array(widgetSchema).max(50),
  templateEvents: z
    .array(
      z.object({
        widgetId: z.string().min(1).max(64),
        header: z.string().min(1).max(100),
        type: z.string().min(1).max(64),
        data: z.any().optional(),
      }),
    )
    .max(50)
    .default([]),
});

/**
 * Deployment-provided templates: every *.json in `dir` is upserted as a
 * template keyed by name — redeploys update the template in place but never
 * touch dashboards instantiated from it. Pre-start templates must not carry
 * eventIds (the events don't exist yet); each instance forks fresh state.
 * Missing dir means nothing to seed.
 */
export const seedTemplates = async (dir = "./templates"): Promise<number> => {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return 0;
  }
  let count = 0;
  for (const file of files) {
    let parsed: ReturnType<typeof templateFileSchema.safeParse>;
    try {
      parsed = templateFileSchema.safeParse(
        JSON.parse(await readFile(path.join(dir, file), "utf8")),
      );
    } catch (err) {
      logger.error({ file, err }, "template file unreadable; skipped");
      continue;
    }
    if (!parsed.success) {
      logger.error({ file, issues: parsed.error.issues }, "template file invalid; skipped");
      continue;
    }
    const { name, description = null, widgets, templateEvents } = parsed.data;
    // Upsert against the partial unique index — safe under concurrent boots.
    await db
      .insert(dashboards)
      .values({
        id: uuidv7(),
        name,
        description,
        widgets,
        templateEvents,
        isTemplate: true,
        version: uuidv7(),
        createdBy: "system",
      })
      .onConflictDoUpdate({
        target: dashboards.name,
        targetWhere: sql`${dashboards.isTemplate}`,
        set: {
          description,
          widgets,
          templateEvents,
          version: uuidv7(),
          updatedAt: new Date(),
          updatedBy: "system",
        },
      });
    count++;
  }
  if (count > 0) logger.info({ count }, "templates seeded");
  return count;
};
