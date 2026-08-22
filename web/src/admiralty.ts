import type { EventResponse } from "./api.ts";

// NATO Admiralty Code scales (AJP-2.1 / STANAG 2511). Values are duplicated
// from the server enums (@server alias is type-only), but the satisfies
// clauses flag drift against the API types at compile time.
export const RELIABILITY = ["A", "B", "C", "D", "E", "F"] as const satisfies readonly NonNullable<
  EventResponse["admiraltyReliability"]
>[];
export const CREDIBILITY = ["1", "2", "3", "4", "5", "6"] as const satisfies readonly NonNullable<
  EventResponse["admiraltyAccuracy"]
>[];
