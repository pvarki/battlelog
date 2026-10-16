import { expect, test } from "vitest";
import type { ChatMessage } from "./chat/chat.ts";
import { chatToKeep } from "./picture-cache.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;

const record = (id: string, time: number) => ({
  scope: "s",
  id,
  message: { id, time } as ChatMessage,
});

test("saved chat keeps the newest 5,000 messages within eight days, oldest first", () => {
  const recent = Array.from({ length: 6000 }, (_, i) => record(`m${i}`, NOW - 6000 + i));
  const expired = record("old", NOW - 9 * DAY_MS);
  const kept = chatToKeep([expired, ...recent.reverse()], NOW);
  expect(kept).toHaveLength(5000);
  expect(kept[0]?.id).toBe("m1000");
  expect(kept.at(-1)?.id).toBe("m5999");
});
