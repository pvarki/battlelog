/**
 * Parse an X.509 Distinguished Name as injected by the mTLS-terminating proxy.
 * Accepts both OpenSSL slash format (`/CN=foo/O=bar`) and RFC 2253 comma
 * format (`CN=foo, O=bar`). First occurrence of a key wins.
 */
export const parseDistinguishedName = (rawDn: string | undefined): Record<string, string> => {
  if (!rawDn?.trim()) return {};

  const entries = rawDn.startsWith("/")
    ? rawDn.slice(1).split("/").filter(Boolean)
    : rawDn.split(",");

  const parsed: Record<string, string> = {};
  for (const entry of entries) {
    const sep = entry.indexOf("=");
    if (sep < 1) continue;
    const key = entry.slice(0, sep).trim().toUpperCase();
    const value = entry.slice(sep + 1).trim();
    if (key && value && !parsed[key]) parsed[key] = value;
  }
  return parsed;
};

/** The CN from a proxy-injected DN header, or undefined when absent/malformed. */
export const cnFromDn = (rawDn: string | undefined): string | undefined =>
  parseDistinguishedName(rawDn).CN;
