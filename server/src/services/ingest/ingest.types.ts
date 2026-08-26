/**
 * Shared vocabulary for the ingesters. Kept in one file so the TAK stream, the
 * Matrix reader, the settings API and the web page cannot drift on what a
 * source's config looks like or what lands in `input_source`.
 */

export type IngestKind = "tak" | "matrix";

/** Value written to events.input_source, per kind. */
export const INPUT_SOURCE: Record<IngestKind, string> = {
  tak: "tak",
  matrix: "matrix",
};

/**
 * events.type discriminators. Stable per payload shape, deliberately not the raw
 * CoT type: there are hundreds of those and they describe the thing on the map,
 * not the shape of `data`. The raw one goes in tags and data instead.
 */
export const EVENT_TYPE = {
  takChat: "tak-chat",
  takCot: "tak-cot",
  matrixMessage: "matrix.message",
} as const;

/**
 * What one TAK setup pulls out of the CoT stream.
 *
 * Every field is a list of unanchored regular expressions. An empty or absent
 * list means no constraint on that field, so a setup with nothing set matches
 * every CoT event on the stream. All the constraints that are set must hold.
 */
export type TakSourceConfig = {
  /** CoT `type`, e.g. "^a-f-" for friendly tracks or "^b-t-f" for chat. */
  cotTypes?: string[];
  /** GeoChat room, e.g. "^RECON$" for exactly that room. */
  chatRooms?: string[];
  /** Chat recipient. */
  destCallsigns?: string[];
  /** Sender, falling back to the contact callsign when the event is not chat. */
  senderCallsigns?: string[];
  /**
   * Matched against the raw CoT <detail> XML. This is how you select on things
   * TAK has no server-side concept of — an ATAK client's role, for instance,
   * appears only inside detail.
   */
  detailContains?: string[];
};

/** What to read from Matrix. One room per source, so each can be toggled alone. */
export type MatrixSourceConfig = {
  /** Room ID ("!abc:domain"), which is what /sync keys rooms by. */
  roomId: string;
  /** Human-readable room name or alias, for the settings list. Display only. */
  roomName?: string;
};

/**
 * Live state of one ingest source, surfaced through the settings API so an
 * operator can see why nothing is arriving instead of reading container logs.
 */
export type IngestStatusName =
  | "disabled"
  | "connecting"
  | "connected"
  | "error"
  /**
   * The room exists and is selectable, but the bot is not a member, so /sync
   * returns nothing for it. Distinct from "connected" on purpose: a source that
   * looks fine while silently delivering nothing is the worst state to be in.
   */
  | "not-joined"
  /** Joined and reachable, but the room is end-to-end encrypted and unreadable. */
  | "encrypted";

export type IngestStatus = {
  status: IngestStatusName;
  /** Last thing that went wrong, kept even after recovery for diagnosis. */
  lastError?: string;
  /** When this source last produced an event, ISO 8601. */
  lastEventAt?: string;
  /** Events created from this source since boot. */
  eventCount: number;
};
