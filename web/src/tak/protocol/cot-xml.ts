import { type CotEvent, childNamed, MARKING_FIELDS } from "./cot-event.ts";

/**
 * CoT XML as TAK's REST API returns it: one `<event>` or many (archive
 * queries concatenate them, each possibly with its own XML declaration).
 * Malformed input yields no events rather than throwing.
 */
export const parseCotXml = (xml: string): CotEvent[] => {
  const body = xml.replace(/<\?xml[^?]*\?>/g, "");
  const doc = new DOMParser().parseFromString(`<events>${body}</events>`, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return [];
  const serializer = new XMLSerializer();
  // Archive queries wrap their events in TAK's own <events>; single lookups don't.
  return Array.from(doc.getElementsByTagName("event")).map((event) => {
    const point = childNamed(event, "point");
    const detail = childNamed(event, "detail");
    const time = (name: string) => Date.parse(event.getAttribute(name) ?? "") || 0;
    const num = (name: string) => Number(point?.getAttribute(name) ?? 0) || 0;
    const markings = Object.fromEntries(
      MARKING_FIELDS.flatMap((name) => {
        const value = event.getAttribute(name);
        return value ? [[name, value]] : [];
      }),
    );
    return {
      ...markings,
      uid: event.getAttribute("uid") ?? "",
      type: event.getAttribute("type") ?? "",
      how: event.getAttribute("how") ?? "",
      time: time("time"),
      start: time("start"),
      stale: time("stale"),
      lat: num("lat"),
      lon: num("lon"),
      hae: num("hae"),
      ce: num("ce"),
      le: num("le"),
      detail: detail
        ? Array.from(detail.childNodes)
            .map((n) => serializer.serializeToString(n))
            .join("")
        : "",
    };
  });
};
