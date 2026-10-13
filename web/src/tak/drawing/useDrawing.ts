import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Position } from "../cot.ts";
import type { NewShape } from "./new-items.ts";
import type { TacticalGraphic } from "./tactical-graphics.ts";

export const TOOLS = {
  marker: { label: "Marker", mode: "point" },
  line: { label: "Line", mode: "linestring" },
  polygon: { label: "Area", mode: "polygon" },
  rectangle: { label: "Rectangle", mode: "rectangle" },
  circle: { label: "Circle", mode: "circle" },
} as const;

export type Tool = keyof typeof TOOLS;

/** What the user just drew, before it has a name and style. */
export type Drawn = { kind: "marker"; position: Position } | NewShape;

const ACCENT = "#8abbff";
const EARTH_RADIUS_M = 6_371_008.8;

const distance = ([lon1, lat1]: Position, [lon2, lat2]: Position) => {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

const drawnFrom = (
  tool: Tool,
  geometry: { type: string; coordinates: unknown },
): Drawn | undefined => {
  if (geometry.type === "Point")
    return { kind: "marker", position: geometry.coordinates as Position };
  if (geometry.type === "LineString")
    return { kind: "line", points: geometry.coordinates as Position[] };
  if (geometry.type !== "Polygon") return undefined;
  const ring = ((geometry.coordinates as Position[][])[0] ?? []).slice(0, -1);
  if (tool === "circle") {
    const sum = ring.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
    const centre: Position = [sum[0] / ring.length, sum[1] / ring.length];
    return { kind: "circle", centre, radius: Math.round(distance(centre, ring[0] as Position)) };
  }
  return { kind: tool === "rectangle" ? "rectangle" : "polygon", points: ring };
};

/**
 * Drawing on the map with terra-draw: pick a tool, draw, and get back what was
 * drawn; the sketch stays on the map until `clear` (after save or cancel).
 */
export const useDrawing = (map: MapLibreMap | undefined) => {
  const draw = useRef<TerraDraw>(undefined);
  const [tool, setTool] = useState<Tool>();
  const [drawn, setDrawn] = useState<Drawn>();
  const [graphic, setGraphic] = useState<TacticalGraphic>();
  /** A tactical graphic's shape while it's being drawn, so it can be previewed. */
  const [sketch, setSketch] = useState<Drawn>();
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const graphicRef = useRef(graphic);
  graphicRef.current = graphic;

  useEffect(() => {
    if (!map) return;
    const terra = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode({ styles: { pointColor: ACCENT } }),
        new TerraDrawLineStringMode({ styles: { lineStringColor: ACCENT } }),
        new TerraDrawPolygonMode({ styles: { fillColor: ACCENT, outlineColor: ACCENT } }),
        new TerraDrawRectangleMode({ styles: { fillColor: ACCENT, outlineColor: ACCENT } }),
        new TerraDrawCircleMode({ styles: { fillColor: ACCENT, outlineColor: ACCENT } }),
      ],
    });
    terra.start();
    terra.on("change", (ids) => {
      const current = toolRef.current;
      if (!graphicRef.current || !current) return;
      const geometry = ids
        .map((id) => terra.getSnapshotFeature(id)?.geometry)
        .find((g) => g && g.type !== "Point");
      if (geometry) setSketch(drawnFrom(current, geometry));
    });
    terra.on("finish", (id) => {
      const feature = terra.getSnapshotFeature(id);
      const current = toolRef.current;
      if (!feature || !current) return;
      setDrawn(drawnFrom(current, feature.geometry));
      setSketch(undefined);
      // One item at a time: stop drawing while the user names and styles it.
      terra.setMode("static");
    });
    draw.current = terra;
    return () => {
      terra.stop();
      draw.current = undefined;
    };
  }, [map]);

  const clear = () => {
    draw.current?.clear();
    draw.current?.setMode("static");
    setDrawn(undefined);
    setSketch(undefined);
    setTool(undefined);
    setGraphic(undefined);
  };

  const choose = (next: Tool | undefined, nextGraphic?: TacticalGraphic) => {
    draw.current?.clear();
    setDrawn(undefined);
    setSketch(undefined);
    setTool(next);
    setGraphic(next && nextGraphic);
    draw.current?.setMode(next ? TOOLS[next].mode : "static");
  };

  return { tool, graphic, drawn, sketch, choose, clear };
};
