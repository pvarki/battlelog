import { expect, test } from "vitest";
import { maskCredentials } from "./VideoFeed.tsx";

test("stream passwords are hidden on screen, the rest of the URL kept", () => {
  expect(maskCredentials(`rtmps://mtx:1936/live/uas/Kilo15?user=Kilo15&pass=${"x"}`)).toBe(
    "rtmps://mtx:1936/live/uas/Kilo15?user=Kilo15&pass=•••",
  );
  expect(maskCredentials(`rtsp://cam:${"x"}@10.0.0.5/stream`)).toBe(
    "rtsp://cam:•••@10.0.0.5/stream",
  );
});
