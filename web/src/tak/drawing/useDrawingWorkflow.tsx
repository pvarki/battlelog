import { useState } from "react";
import { type CotEvent, type Position, type TakItem, toChange } from "../cot.ts";
import type { takSender } from "../identity.ts";
import { NewItemDialog } from "./NewItemDialog.tsx";
import {
  newBullseyeEvent,
  newMarkerEvent,
  newRangeRingsEvent,
  newRouteEvent,
  newShapeEvent,
  type ShapeStyle,
} from "./new-items.ts";
import { RingsDialog, type RingsLook } from "./RingsDialog.tsx";
import { cotTypeOf, sidcOf } from "./symbol-catalogue.ts";
import { TacticalGraphicDialog } from "./TacticalGraphicDialog.tsx";
import { newTacticalGraphicEvent, type TacticalLook } from "./tactical-graphics.ts";
import type { Drawn, useDrawing } from "./useDrawing.ts";

const KIND_NAME: Record<Drawn["kind"], string> = {
  marker: "Marker",
  line: "Line",
  polygon: "Area",
  rectangle: "Rectangle",
  circle: "Circle",
  route: "Route",
};

/** How a shape looks while it's being drawn: the new-item dialog's defaults. */
const PREVIEW_STYLE: ShapeStyle = {
  name: "",
  remarks: "",
  stroke: "#ffff00",
  strokeWeight: 3,
  strokeStyle: "solid",
  fillOpacity: 0.25,
  labelsOn: false,
};

/** What's being drawn as it will look once saved, and the dialog that saves it. */
export const useDrawingWorkflow = ({
  drawing,
  sender,
  nameFor,
  submit,
  submitLabel,
}: {
  drawing: ReturnType<typeof useDrawing>;
  sender: ReturnType<typeof takSender>;
  nameFor: (label: string) => string;
  submit: (event: CotEvent) => void;
  submitLabel: string;
}) => {
  const [tacticalLook, setTacticalLook] = useState<TacticalLook>();
  const pointsOf = (shape: Drawn | undefined) => (shape && "points" in shape ? shape.points : []);
  const tacticalPoints = pointsOf(drawing.drawn);
  const tacticalEvent = (points: Position[], uid?: string) =>
    drawing.graphic && tacticalLook
      ? newTacticalGraphicEvent(drawing.graphic, points, tacticalLook, sender, Date.now(), uid)
      : undefined;
  const [chosenStyle, setChosenStyle] = useState<ShapeStyle>();
  const ringsKind =
    drawing.tool === "rings" || drawing.tool === "bullseye" ? drawing.tool : undefined;
  const [ringsLook, setRingsLook] = useState<RingsLook>();
  const ringsEvent = (uid?: string) => {
    if (!ringsKind || !ringsLook || drawing.drawn?.kind !== "marker") return undefined;
    const placed = { ...ringsLook, centre: drawing.drawn.position };
    if (ringsKind === "rings") return newRangeRingsEvent(placed, sender, Date.now(), uid);
    const rings = ringsLook.showRings
      ? { spacing: ringsLook.spacing, count: ringsLook.count }
      : undefined;
    return newBullseyeEvent({ ...placed, rings }, sender, Date.now(), uid);
  };
  /** The shape being drawn as it will look once saved. */
  const previewOf = (sketch: Drawn | undefined, cursor: Position | undefined): TakItem[] => {
    const shape = drawing.drawn ?? sketch;
    // A symbol chosen before placing rides under the pointer until the click.
    const placing = drawing.tool === "marker" && !drawing.drawn ? drawing.symbol : undefined;
    const event = placing
      ? cursor &&
        newMarkerEvent(
          {
            position: cursor,
            name: "",
            remarks: "",
            kind: "symbol",
            color: "",
            symbol: { sidc: sidcOf(placing), type: cotTypeOf(placing) },
          },
          sender,
          Date.now(),
          "preview",
        )
      : ringsKind
        ? ringsEvent("preview")
        : drawing.graphic
          ? pointsOf(shape).length > 1
            ? tacticalEvent(pointsOf(shape), "preview")
            : undefined
          : shape && shape.kind !== "marker" && shape.kind !== "route"
            ? newShapeEvent(
                shape,
                (drawing.drawn && chosenStyle) || {
                  ...PREVIEW_STYLE,
                  name: nameFor(KIND_NAME[shape.kind]),
                },
                sender,
                Date.now(),
                "preview",
              )
            : undefined;
    const change = event && toChange(event);
    if (change?.kind !== "upsert") return [];
    return [placing ? { ...change.item, hideLabel: true } : change.item];
  };
  const newItemDialog = drawing.drawn && (
    <NewItemDialog
      drawn={drawing.drawn}
      defaultName={nameFor(KIND_NAME[drawing.drawn.kind])}
      onCancel={drawing.clear}
      onStyle={setChosenStyle}
      saveLabel={submitLabel}
      initialSymbol={drawing.symbol}
      onSaveShape={(style) => {
        if (drawing.drawn && drawing.drawn.kind !== "marker" && drawing.drawn.kind !== "route")
          submit(newShapeEvent(drawing.drawn, style, sender));
        drawing.clear();
      }}
      onSaveMarker={(marker) => {
        if (drawing.drawn?.kind === "marker")
          submit(newMarkerEvent({ ...marker, position: drawing.drawn.position }, sender));
        drawing.clear();
      }}
      onSaveRoute={(route) => {
        if (drawing.drawn?.kind === "route")
          submit(newRouteEvent({ ...route, points: drawing.drawn.points }, sender));
        drawing.clear();
      }}
    />
  );
  const tacticalDialog = drawing.drawn && drawing.graphic && tacticalLook && (
    <TacticalGraphicDialog
      graphic={drawing.graphic}
      pointCount={tacticalPoints.length}
      value={tacticalLook}
      onChange={setTacticalLook}
      onCancel={drawing.clear}
      saveLabel={submitLabel}
      onSave={() => {
        const event = tacticalEvent(tacticalPoints);
        if (event) submit(event);
        drawing.clear();
      }}
    />
  );
  const ringsDialog = ringsKind && ringsLook && drawing.drawn && (
    <RingsDialog
      kind={ringsKind}
      value={ringsLook}
      onChange={setRingsLook}
      onCancel={drawing.clear}
      saveLabel={submitLabel}
      onSave={() => {
        const event = ringsEvent();
        if (event) submit(event);
        drawing.clear();
      }}
    />
  );
  const dialog = drawing.graphic ? tacticalDialog : ringsDialog || newItemDialog;
  return { previewOf, dialog, setTacticalLook, setRingsLook };
};
