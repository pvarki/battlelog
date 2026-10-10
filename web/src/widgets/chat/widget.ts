import { IconMessages } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

const configSchema = z
  .object({
    ...baseWidgetConfig,
    /** Matrix room id (`!opaque:server`) the widget shows and posts to. */
    roomId: z.string().startsWith("!").max(255).optional(),
    // Display toggles: unset means on (except `compact`), so older configs keep today's look.
    showTimestamps: z.boolean().optional(),
    showMedia: z.boolean().optional(),
    /** Wall-display mode: no message box or reactions, and no read receipts by default. */
    readOnly: z.boolean().optional(),
    /** Unset follows `readOnly`: a shared screen shouldn't clear your unread messages. */
    markAsRead: z.boolean().optional(),
    compact: z.boolean().optional(),
    showReactions: z.boolean().optional(),
    /** Unset follows `readOnly`: "Seen by" is noise on a shared screen. */
    showSeenBy: z.boolean().optional(),
    textSize: z.enum(["sm", "md", "lg", "xl"]).optional(),
    /** Sound, plus a desktop notification while the tab is in the background. */
    notify: z.enum(["off", "mentions", "all"]).optional(),
  })
  .strict();

export type ChatConfig = z.infer<typeof configSchema>;

/** What a message list renders, after config and the widget's current size. */
export type ChatDisplay = {
  timestamps: boolean;
  media: boolean;
  composer: boolean;
  readOnly: boolean;
  markAsRead: boolean;
  compact: boolean;
  reactions: boolean;
  seenBy: boolean;
  /** Too short for anything but messages: banners shrink to a button. */
  short: boolean;
  /** Multiplier for every font size in the widget. */
  textScale: number;
  composerRows: number;
};

const TEXT_SCALE = { sm: 0.875, md: 1, lg: 1.25, xl: 1.5 } as const;

const NARROW_PX = 320;
const SHORT_PX = 240;
const TINY_PX = 160;

/** Config toggles, then size: a cramped widget drops what it can't fit. */
export const chatDisplay = (
  config: ChatConfig,
  size: { width: number; height: number },
): ChatDisplay => {
  // 0 = not measured yet; treat as roomy rather than flash a cramped layout.
  const narrow = size.width > 0 && size.width < NARROW_PX;
  const short = size.height > 0 && size.height < SHORT_PX;
  const tiny = size.height > 0 && size.height < TINY_PX;
  const readOnly = config.readOnly === true;
  return {
    timestamps: config.showTimestamps !== false && !narrow,
    media: config.showMedia !== false,
    composer: !readOnly && !tiny,
    readOnly,
    markAsRead: config.markAsRead ?? !readOnly,
    compact: config.compact === true || narrow,
    reactions: config.showReactions !== false,
    seenBy: config.showSeenBy ?? !readOnly,
    short,
    textScale: TEXT_SCALE[config.textSize ?? "md"],
    composerRows: short ? 1 : 5,
  };
};

const descriptor: WidgetDescriptor<ChatConfig> = {
  type: "chat",
  Icon: IconMessages,
  name: "Chat",
  description: "Matrix room chat, sent as your own Matrix account",
  showOnMobile: false,
  configSchema,
  defaultConfig: {},
  defaultSize: { w: 10, h: 10 },
  minSize: { w: 6, h: 6 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
