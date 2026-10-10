import type { MatrixEvent } from "matrix-js-sdk";
import { describe, expect, it } from "vitest";
import {
  buildEditContent,
  buildTextContent,
  displayBody,
  mentionsUser,
  previewText,
  replyToId,
  threadRootId,
} from "./mentions.ts";

const alice = { userId: "@alice:synapse.example", name: "Alice" };

describe("buildTextContent", () => {
  it("sends plain text with an empty m.mentions when nobody is mentioned", () => {
    expect(buildTextContent("hello", [])).toEqual({
      msgtype: "m.text",
      body: "hello",
      "m.mentions": {},
    });
  });

  it("pills picked mentions and escapes the rest of the HTML", () => {
    const content = buildTextContent("Alice <b>look</b>", [alice]);
    expect(content).toMatchObject({
      "m.mentions": { user_ids: ["@alice:synapse.example"] },
      formatted_body:
        '<a href="https://matrix.to/#/%40alice%3Asynapse.example">Alice</a> &#60;b&#62;look&#60;/b&#62;',
    });
  });

  it("never nests a short name's pill inside a longer one, and treats $ literally", () => {
    const al = { userId: "@al:synapse.example", name: "Al" };
    const dollar = { userId: "@d:synapse.example", name: "$&" };
    expect(buildTextContent("Alice Al $&", [alice, al, dollar])).toMatchObject({
      formatted_body:
        '<a href="https://matrix.to/#/%40alice%3Asynapse.example">Alice</a> ' +
        '<a href="https://matrix.to/#/%40al%3Asynapse.example">Al</a> ' +
        '<a href="https://matrix.to/#/%40d%3Asynapse.example">$&#38;</a>',
    });
  });

  it("drops mentions whose name was deleted from the draft", () => {
    expect(buildTextContent("never mind", [alice])["m.mentions"]).toEqual({});
  });
});

describe("mentionsUser", () => {
  it("trusts m.mentions when present", () => {
    const content = { body: "Alice hi", "m.mentions": { user_ids: [] } };
    expect(mentionsUser(content, alice.userId, "Alice")).toBe(false);
    expect(
      mentionsUser({ "m.mentions": { user_ids: [alice.userId] } }, alice.userId, "Alice"),
    ).toBe(true);
  });

  it("falls back to the display name or localpart in the body", () => {
    expect(mentionsUser({ body: "ping alice" }, alice.userId, undefined)).toBe(true);
    expect(mentionsUser({ body: "nothing here" }, alice.userId, "Alice")).toBe(false);
  });
});

describe("replies", () => {
  const reply = { eventId: "$orig", senderId: "@bob:x" };

  it("relates to the original and mentions its sender", () => {
    expect(buildTextContent("sure", [], reply)).toMatchObject({
      body: "sure",
      "m.mentions": { user_ids: ["@bob:x"] },
      "m.relates_to": { "m.in_reply_to": { event_id: "$orig" } },
    });
  });

  it("strips the legacy quote fallback only from replies", () => {
    const body = "> <@bob:x> where?\n> second line\n>\n\nat the gate";
    expect(displayBody({ body }, true)).toBe("at the gate");
    expect(displayBody({ body }, false)).toBe(body);
  });

  it("tells real replies from thread fallbacks", () => {
    const reply = { "m.in_reply_to": { event_id: "$orig" } };
    expect(replyToId(reply)).toBe("$orig");
    const threadOnly = { rel_type: "m.thread", event_id: "$root", is_falling_back: true, ...reply };
    expect(replyToId(threadOnly)).toBeUndefined();
    expect(threadRootId(threadOnly)).toBe("$root");
    expect(replyToId({ ...threadOnly, is_falling_back: false })).toBe("$orig");
  });

  it("posts into a thread, as a reply when replying", () => {
    const thread = { rootId: "$root", latestEventId: "$latest" };
    expect(buildTextContent("x", [], undefined, thread)["m.relates_to"]).toEqual({
      rel_type: "m.thread",
      event_id: "$root",
      is_falling_back: true,
      "m.in_reply_to": { event_id: "$latest" },
    });
    expect(buildTextContent("x", [], { eventId: "$r", senderId: "@b:x" }, thread)).toMatchObject({
      "m.relates_to": { is_falling_back: false, "m.in_reply_to": { event_id: "$r" } },
    });
  });

  it("previews media and first lines", () => {
    expect(previewText({ msgtype: "m.image", body: "a.png" }, false)).toBe("sent an image");
    expect(previewText({ msgtype: "m.text", body: "one\ntwo" }, false)).toBe("one");
  });
});

const fakeEvent = (id: string, msgtype: string) =>
  ({ getId: () => id, getContent: () => ({ msgtype }) }) as unknown as MatrixEvent;

describe("buildEditContent", () => {
  it("keeps the original msgtype", () => {
    expect(buildEditContent(fakeEvent("$e", "m.emote"), "waves", [])).toMatchObject({
      msgtype: "m.emote",
      "m.new_content": { msgtype: "m.emote", body: "waves" },
    });
  });

  it("replaces the original without re-notifying", () => {
    expect(buildEditContent(fakeEvent("$orig", "m.text"), "fixed", [])).toMatchObject({
      body: "* fixed",
      "m.new_content": { body: "fixed" },
      "m.mentions": {},
      "m.relates_to": { rel_type: "m.replace", event_id: "$orig" },
    });
  });
});
