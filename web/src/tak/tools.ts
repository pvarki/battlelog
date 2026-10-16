export type MapView = { center: [number, number]; zoom: number; bearing: number };

const round = (n: number, digits: number) => Number(n.toFixed(digits));

/** A view as one URL parameter, `lng,lat,zoom[,bearing]`, for links that open the map on it. */
export const viewParam = ({ center: [lng, lat], zoom, bearing }: MapView): string =>
  [round(lng, 5), round(lat, 5), round(zoom, 2), ...(bearing ? [round(bearing, 1)] : [])].join(",");

export const parseViewParam = (param: string | undefined): MapView | undefined => {
  const [lng, lat, zoom, bearing = 0] = (param ?? "").split(",").map(Number);
  if ([lng, lat, zoom, bearing].some((n) => n === undefined || !Number.isFinite(n)))
    return undefined;
  if (Math.abs(lng as number) > 180 || Math.abs(lat as number) > 90) return undefined;
  if ((zoom as number) < 0 || (zoom as number) > 24) return undefined;
  return { center: [lng as number, lat as number], zoom: zoom as number, bearing };
};
