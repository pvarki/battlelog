import { notifications } from "@mantine/notifications";
import type { CotEvent, Position } from "./cot.ts";
import { escapeXml } from "./protocol/cot-xml.ts";
import { fetchLatestCot } from "./rest.ts";
import { sendCot } from "./session.ts";

const STALE_MS = 10 * 60_000;
const VERIFY_DELAY_MS = 2_000;

/**
 * Dev-only proof that this browser can write to TAK as the user: sends one
 * short-lived spot marker, then asks TAK's REST API whether it stored it.
 */
export const sendTestMarker = async ([lon, lat]: Position, callsign: string) => {
  const now = Date.now();
  const event: CotEvent = {
    uid: `battlelog-test-${crypto.randomUUID()}`,
    type: "b-m-p-s-m",
    how: "h-g-i-g-o",
    time: now,
    start: now,
    stale: now + STALE_MS,
    lat,
    lon,
    hae: 9_999_999,
    ce: 9_999_999,
    le: 9_999_999,
    detail: `<contact callsign="${escapeXml(`${callsign} test`)}"/><color argb="-256"/><remarks>BattleLog write test</remarks><archive/>`,
  };
  if (!sendCot(event)) {
    notifications.show({ color: "red", message: "Not connected to TAK" });
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, VERIFY_DELAY_MS));
  try {
    const stored = await fetchLatestCot(event.uid);
    notifications.show(
      stored
        ? { color: "teal", title: "TAK stored the test marker", message: event.uid }
        : { color: "red", title: "TAK did not store the test marker", message: event.uid },
    );
  } catch (err) {
    notifications.show({
      color: "red",
      title: "Couldn't verify the test marker",
      message: String(err),
    });
  }
};
