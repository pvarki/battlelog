export const SOURCE_TYPES = ["auto", "whep", "hls", "mjpeg", "video"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Resolve a concrete player from the URL shape. */
export const detectSourceType = (url: string): Exclude<SourceType, "auto"> => {
  const path = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (path.endsWith("/whep")) return "whep";
  if (path.endsWith(".m3u8")) return "hls";
  if (/\.mjpe?g$|mjpeg/.test(path)) return "mjpeg";
  return "video";
};

/** Browsers only fetch http(s); RTSP, RTMP, UDP and SRT need a native player or a gateway. */
export const isBrowserPlayable = (url: string): boolean => /^https?:\/\//i.test(url.trim());
