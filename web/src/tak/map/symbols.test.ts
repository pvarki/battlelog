import { expect, test } from "vitest";
import { imageArgs, imageId, labelImage } from "./symbols.ts";

test("an image id gives back exactly what it was made from, whatever the text", () => {
  const text = 'Alpha | "2" \\ ]';
  expect(imageArgs(imageId("label", "marker", text))).toEqual(["label", "marker", text]);
  expect(imageArgs("tak-tactical-image-0")).toBeUndefined();
});

test("a label's id changes with its text and style, so a new look is a new image", () => {
  const ids = new Set([
    labelImage("A").id,
    labelImage("B").id,
    labelImage("A", "emphasis").id,
    labelImage("A", "graphic").id,
  ]);
  expect(ids.size).toBe(4);
  expect(labelImage("A").id).toBe(labelImage("A", "marker").id);
});
