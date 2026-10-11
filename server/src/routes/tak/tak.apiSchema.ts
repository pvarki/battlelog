import { z } from "@hono/zod-openapi";

const position = z.tuple([z.number(), z.number()]).describe("[lon, lat]");
const color = z.object({ color: z.string(), opacity: z.number() });

export const takFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    id: z.string().describe("CoT uid"),
    geometry: z.discriminatedUnion("type", [
      z.object({ type: z.literal("Point"), coordinates: position }),
      z.object({ type: z.literal("LineString"), coordinates: z.array(position) }),
      z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(position)) }),
    ]),
    properties: z.object({
      cotType: z.string(),
      callsign: z.string().optional(),
      time: z.string(),
      stale: z.string(),
      remarks: z.string().optional(),
      team: z.string().optional(),
      role: z.string().optional(),
      battery: z.number().optional(),
      device: z.string().optional(),
      offline: z.literal(true).optional().describe("Contact disconnected from TAK"),
      radius: z.number().optional().describe("Circle radius in metres; geometry is the centre"),
      stroke: color.optional(),
      strokeWidth: z.number().optional(),
      fill: color.optional(),
      checkpoints: z.array(z.object({ name: z.string(), coordinates: position })).optional(),
    }),
  })
  .openapi("TakFeature");
export type TakFeature = z.infer<typeof takFeatureSchema>;

export const takMissionSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    creatorUid: z.string().optional(),
    createTime: z.string().optional(),
    keywords: z.array(z.string()),
    readable: z
      .boolean()
      .describe(
        "False when BattleLog's TAK identity can't read the contents (password-protected or restricted); items is then empty",
      ),
    items: z.array(takFeatureSchema),
  })
  .openapi("TakMission");
export type TakMission = z.infer<typeof takMissionSchema>;

export const takStateResponseSchema = z
  .object({
    enabled: z.boolean().describe("False when the server has no TAK connection configured"),
    items: z.array(takFeatureSchema),
  })
  .openapi("TakState");
