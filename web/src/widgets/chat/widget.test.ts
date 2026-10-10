import { describe, expect, it } from "vitest";
import { deploymentForHost } from "./matrix.ts";
import descriptor, { chatDisplay } from "./widget.ts";

describe("chat widget", () => {
  const roomy = { width: 600, height: 500 };

  it("derives the PVARKI deployment from BattleLog's host", () => {
    expect(deploymentForHost("battlelog.diverse-labrador.solution.dev.pvarki.fi")).toBe(
      "diverse-labrador.solution.dev.pvarki.fi",
    );
    expect(deploymentForHost("mtls.battlelog.diverse-labrador.solution.dev.pvarki.fi")).toBe(
      "diverse-labrador.solution.dev.pvarki.fi",
    );
  });

  it("accepts room ids and rejects aliases", () => {
    const schema = descriptor.configSchema;
    expect(schema.safeParse({ roomId: "!abc:synapse.example" }).success).toBe(true);
    expect(schema.safeParse({ roomId: "#general:synapse.example" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("defaults to everything shown, and drops what a small widget can't fit", () => {
    expect(chatDisplay({}, roomy)).toMatchObject({
      timestamps: true,
      composer: true,
      compact: false,
    });
    expect(chatDisplay({}, { width: 0, height: 0 })).toMatchObject({
      timestamps: true,
      composer: true,
    });
    expect(chatDisplay({}, { width: 250, height: 500 })).toMatchObject({
      timestamps: false,
      compact: true,
    });
    expect(chatDisplay({}, { width: 600, height: 200 })).toMatchObject({
      composer: true,
      composerRows: 1,
    });
    expect(chatDisplay({}, { width: 600, height: 120 })).toMatchObject({ composer: false });
    expect(chatDisplay({ showTimestamps: false }, roomy)).toMatchObject({ timestamps: false });
  });

  it("read-only drops the composer and stops marking read unless asked to", () => {
    expect(chatDisplay({}, roomy)).toMatchObject({ readOnly: false, markAsRead: true });
    expect(chatDisplay({ readOnly: true }, roomy)).toMatchObject({
      composer: false,
      markAsRead: false,
    });
    expect(chatDisplay({ readOnly: true, markAsRead: true }, roomy)).toMatchObject({
      markAsRead: true,
    });
  });

  it("hides Seen by on read-only screens unless asked", () => {
    expect(chatDisplay({}, roomy)).toMatchObject({ reactions: true, seenBy: true });
    expect(chatDisplay({ readOnly: true }, roomy)).toMatchObject({
      reactions: true,
      seenBy: false,
    });
    expect(chatDisplay({ readOnly: true, showSeenBy: true }, roomy).seenBy).toBe(true);
  });

  it("scales text by the configured size", () => {
    expect(chatDisplay({}, roomy).textScale).toBe(1);
    expect(chatDisplay({ textSize: "xl" }, roomy).textScale).toBe(1.5);
  });
});
