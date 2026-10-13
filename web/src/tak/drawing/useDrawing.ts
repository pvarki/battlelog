import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Position, TakItem } from "../cot.ts";
import { editTarget } from "./edit-geometry.ts";
import type { NewShape } from "./new-items.ts";
import type { SymbolChoice } from "./symbol-catalogue.ts";
import type { TacticalGraphic } from "./tactical-graphics.ts";

export const TOOLS = {
  marker: { label: "Marker", mode: "point" },
  line: { label: "Line", mode: "linestring" },
  polygon: { label: "Area", mode: "polygon" },
  rectangle: { label: "Rectangle", mode: "rectangle" },
  circle: { label: "Circle", mode: "circle" },
  route: { label: "Route", mode: "linestring" },
} as const;

export type Tool = keyof typeof TOOLS;

/** What the user just drew, before it has a name and style. */
export type Drawn =
  | { kind: "marker"; position: Position }
  | NewShape
  | { kind: "route"; points: Position[] };

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
    return {
      kind: tool === "route" ? "route" : "line",
      points: geometry.coordinates as Position[],
    };
  if (geometry.type !== "Polygon") return undefined;
  const ring = ((geometry.coordinates as Position[][])[0] ?? []).slice(0, -1);
  if (tool === "circle") {
    const sum = ring.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
    const centre: Position = [sum[0] / ring.length, sum[1] / ring.length];
    return { kind: "circle", centre, radius: Math.round(distance(centre, ring[0] as Position)) };
  }
  return { kind: tool === "rectangle" ? "rectangle" : "polygon", points: ring };
};

const selectFlags = (tool: Tool, item: TakItem) => {
  if (tool === "marker") return { feature: { draggable: true } };
  if (tool === "circle") {
    const resizable = item.ellipse?.major === item.ellipse?.minor;
    return {
      feature: {
        draggable: true,
        coordinates: resizable
          ? { draggable: true, resizable: "center-fixed" as const }
          : undefined,
      },
    };
  }
  if (tool === "rectangle")
    return {
      feature: {
        draggable: true,
        coordinates: { draggable: true, resizable: "opposite" as const },
      },
    };
  // A tactical graphic's points carry meaning by position: they may move, not come or go.
  const reshape = !item.sidc;
  return {
    feature: {
      draggable: reshape,
      coordinates: { draggable: true, midpoints: reshape, deletable: reshape },
    },
  };
};

/**
 * Drawing on the map with terra-draw: pick a tool, draw, and get back what was
 * drawn; the sketch stays on the map until `clear` (after save or cancel).
 * `edit` puts an existing item on the sketch layer to move and reshape it.
 */
export const useDrawing = (map: MapLibreMap | undefined) => {
  const draw = useRef<TerraDraw>(undefined);
  const [tool, setTool] = useState<Tool>();
  const [drawn, setDrawn] = useState<Drawn>();
  const [graphic, setGraphic] = useState<TacticalGraphic>();
  /** The 2525 symbol the marker tool places, chosen before clicking the map. */
  const [symbol, setSymbol] = useState<SymbolChoice>();
  /** A tactical graphic's shape while it's being drawn, so it can be previewed. */
  const [sketch, setSketch] = useState<Drawn>();
  const [editing, setEditing] = useState<{ item: TakItem; tool: Tool; featureId: string }>();
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
        new TerraDrawSelectMode({
          // Only the item being edited is on the layer, and Save or Cancel ends the edit.
          allowManualSelection: false,
          allowManualDeselection: false,
          keyEvents: null,
        }),
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
    terra.on("finish", (id, context) => {
      const feature = terra.getSnapshotFeature(id);
      const current = toolRef.current;
      if (context.action !== "draw" || !feature || !current) return;
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
    setSymbol(undefined);
    setEditing(undefined);
  };

  const choose = (
    next: Tool | undefined,
    nextGraphic?: TacticalGraphic,
    nextSymbol?: SymbolChoice,
  ) => {
    draw.current?.clear();
    setDrawn(undefined);
    setSketch(undefined);
    setEditing(undefined);
    setTool(next);
    setGraphic(next && nextGraphic);
    setSymbol(next && nextSymbol);
    draw.current?.setMode(next ? TOOLS[next].mode : "static");
  };

  /** False when the item's geometry can't be edited here. */
  const edit = (item: TakItem): boolean => {
    const terra = draw.current;
    const target = editTarget(item);
    if (!terra || !target) return false;
    choose(undefined);
    const mode = TOOLS[target.tool].mode;
    const featureId = crypto.randomUUID();
    terra.updateModeOptions<typeof TerraDrawSelectMode>("select", {
      flags: { [mode]: selectFlags(target.tool, item) },
    });
    const [added] = terra.addFeatures([
      { id: featureId, type: "Feature", geometry: target.geometry, properties: { mode } },
    ]);
    if (!added?.valid) return false;
    terra.setMode("select");
    terra.selectFeature(featureId);
    setEditing({ item, tool: target.tool, featureId });
    return true;
  };

  /** Where the edited item's geometry is now; undefined when not editing. */
  const edited = (): Drawn | undefined => {
    const feature = editing && draw.current?.getSnapshotFeature(editing.featureId);
    return feature && editing ? drawnFrom(editing.tool, feature.geometry) : undefined;
  };

  return {
    tool,
    graphic,
    symbol,
    drawn,
    sketch,
    choose,
    clear,
    editing: editing?.item,
    edit,
    edited,
  };
};
