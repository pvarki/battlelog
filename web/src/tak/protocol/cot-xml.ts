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

const attr = (value: string | number) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** One event as CoT XML, e.g. for a data package; the detail goes back verbatim. */
export const serializeCot = (e: CotEvent): string => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const markings = MARKING_FIELDS.flatMap((name) =>
    e[name] ? [` ${name}="${attr(e[name] as string)}"`] : [],
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><event version="2.0" uid="${attr(e.uid)}" type="${attr(e.type)}" how="${attr(e.how)}" time="${iso(e.time)}" start="${iso(e.start)}" stale="${iso(e.stale)}"${markings}><point lat="${e.lat}" lon="${e.lon}" hae="${e.hae}" ce="${e.ce}" le="${e.le}"/><detail>${e.detail}</detail></event>`;
};
