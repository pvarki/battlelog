export type ExtractInput = {
  xff: string | undefined;
  remoteAddr: string | undefined;
  hops: number;
};

// Pick the client IP, peeling `hops` trusted-proxy entries from the right of XFF.
// hops = 0 means: ignore XFF, use socket remote address.
export const extractClientIp = ({ xff, remoteAddr, hops }: ExtractInput): string => {
  if (hops <= 0 || !xff) return remoteAddr ?? "";
  const parts = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = parts.length - 1 - hops;
  if (idx < 0) return remoteAddr ?? "";
  return parts[idx] ?? remoteAddr ?? "";
};
