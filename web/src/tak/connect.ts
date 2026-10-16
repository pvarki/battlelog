/**
 * The TAK connection with every feature that takes events from the stream.
 * They register as their modules load, so a page holding the connection loads
 * them all here: one that waited for its drawer would miss what arrived before,
 * such as chat received while a dashboard map was the only page open.
 */
import "./chat/store.ts";
import "./checklists/api.ts";
import "./inbox/store.ts";
import "./missions/store.ts";

export { useTakSession } from "./session.ts";
