import { IconVideo } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";
import { detectSourceType, SOURCE_TYPES, type SourceType } from "../../media/source.ts";

const configSchema = z
  .object({
    ...baseWidgetConfig,
    /** Empty until configured — mid-edit states must validate or the settings form resets. */
    url: z.string().max(2000).default(""),
    /** "auto" picks a player from the URL shape; explicit for when detection guesses wrong. */
    sourceType: z.enum(SOURCE_TYPES).default("auto"),
  })
  .strict();

export type StreamsConfig = z.infer<typeof configSchema>;

export const resolveType = (
  config: Pick<StreamsConfig, "url" | "sourceType">,
): Exclude<SourceType, "auto"> =>
  config.sourceType === "auto" ? detectSourceType(config.url) : config.sourceType;

const descriptor: WidgetDescriptor<StreamsConfig> = {
  type: "streams",
  Icon: IconVideo,
  name: "Stream",
  description: "Live video from MediaMTX (WHEP/HLS) or an external source",
  configSchema,
  defaultConfig: { url: "", sourceType: "auto" },
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 4, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
