/**
 * A Cursor-on-Target event as TAK sends it, whichever transport it came by.
 * `detail` is the inner XML of `<detail>`, kept verbatim: TAK clients put
 * their own extensions there, and an edit must send them back untouched.
 */
export type CotEvent = {
  uid: string;
  type: string;
  how: string;
  /** Epoch milliseconds. */
  time: number;
  start: number;
  stale: number;
  lat: number;
  lon: number;
  hae: number;
  ce: number;
  le: number;
  detail: string;
};

export const childNamed = (parent: Element, name: string): Element | undefined =>
  Array.from(parent.children).find((el) => el.tagName === name);
