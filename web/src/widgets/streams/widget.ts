import { IconVideo } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";

export const SOURCE_TYPES = ["auto", "whep", "hls", "mjpeg", "video"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const configSchema = z
  .object({
    /** Shown bold in the widget header (rendered by the wrapper). */
    title: z.string().max(100).optional(),
    /** Per-instance mobile visibility; default shown. */
    showOnMobile: z.boolean().optional(),
    /** Empty until configured — mid-edit states must validate or the settings form resets. */
    url: z.string().max(2000).default(""),
    /** "auto" picks a player from the URL shape; explicit for when detection guesses wrong. */
    sourceType: z.enum(SOURCE_TYPES).default("auto"),
  })
  .strict();

export type StreamsConfig = z.infer<typeof configSchema>;

/** Resolve a concrete player from the URL shape. */
export const detectSourceType = (url: string): Exclude<SourceType, "auto"> => {
  const path = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (path.endsWith("/whep")) return "whep";
  if (path.endsWith(".m3u8")) return "hls";
  if (/\.mjpe?g$|mjpeg/.test(path)) return "mjpeg";
  return "video";
};

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
