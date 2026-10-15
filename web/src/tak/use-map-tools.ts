import { useState } from "react";
import { useStoredSetting } from "../stored-setting.ts";
import { defaultRingsLook, type RingsLook } from "./drawing/RingsDialog.tsx";
import { TOOLS, type Tool, type useDrawing } from "./drawing/useDrawing.ts";
import type { useMeasure } from "./drawing/useMeasure.ts";

/** What a map click does besides selecting, apart from drawing and measuring, which own their state. */
type Mode = "lasso" | "laser" | "move";

/**
 * The map's interaction tools and the switches between them: one at a time,
 * so starting any tool ends the others (a group Move left on would turn the next
 * map click into a move). Also the group of items picked together.
 */
export const useMapTools = ({
  drawing,
  measure,
  nameFor,
  setRingsLook,
  selectedUid,
  setSelectedUid,
}: {
  drawing: ReturnType<typeof useDrawing>;
  measure: ReturnType<typeof useMeasure>;
  nameFor: (label: string) => string;
  setRingsLook: (look: RingsLook) => void;
  selectedUid: string | undefined;
  setSelectedUid: (uid: string | undefined) => void;
}) => {
  const [mode, setMode] = useState<Mode>();
  // Closed by default: most time on the map is spent watching it, not drawing on it.
  const [drawOpen, setDrawOpen] = useStoredSetting({
    key: "battlelog.tak.drawOpen",
    defaultValue: false,
  });
  const [grouped, setGrouped] = useState<ReadonlySet<string>>(new Set());

  const stopMode = () => setMode(undefined);
  const toggleMode = (next: Mode) => setMode((current) => (current === next ? undefined : next));

  /** The item selected on its own becomes the first of the group. */
  const groupBase = () => new Set(grouped.size || !selectedUid ? grouped : [selectedUid]);
  const toggleGrouped = (uid: string) => {
    const next = groupBase();
    if (!next.delete(uid)) next.add(uid);
    setGrouped(next);
    setSelectedUid(undefined);
  };
  const addToGroup = (uids: string[]) => {
    setGrouped(new Set([...groupBase(), ...uids]));
    setSelectedUid(undefined);
  };
  const clearGroup = () => {
    setGrouped(new Set());
    if (mode === "move") stopMode();
  };

  // Whatever is under way keeps its tools in view, whether or not they were opened.
  const toolbarShown =
    drawOpen || !!drawing.tool || !!drawing.editing || measure.active || !!mode || grouped.size > 0;

  const chooseTool = (tool: Tool | undefined) => {
    stopMode();
    measure.stop();
    drawing.choose(tool);
    if (tool === "rings" || tool === "bullseye")
      setRingsLook(defaultRingsLook(nameFor(TOOLS[tool].label)));
  };

  return {
    mode,
    lassoing: mode === "lasso",
    laser: mode === "laser",
    movingGroup: mode === "move",
    stopMode,
    /** A tool is in the middle of something: map clicks belong to it. */
    busy: !!(drawing.tool || drawing.editing || measure.active || mode === "laser"),
    drawOpen,
    setDrawOpen,
    toolbarShown,
    grouped,
    toggleGrouped,
    addToGroup,
    clearGroup,
    chooseTool,
    /** Drawing from the symbol or graphic pickers, which choose the tool themselves. */
    beforeDrawing: () => {
      stopMode();
      measure.stop();
    },
    toggleMeasure: () => {
      stopMode();
      if (measure.active) return measure.stop();
      drawing.choose(undefined);
      measure.start();
    },
    toggleLasso: () => {
      measure.stop();
      drawing.choose(undefined);
      toggleMode("lasso");
    },
    toggleLaser: () => {
      measure.stop();
      drawing.choose(undefined);
      setDrawOpen(true);
      toggleMode("laser");
    },
    startMove: () => {
      chooseTool(undefined);
      setMode("move");
    },
    /** Closing the tools ends what they were doing, as Esc would; a drawn shape awaiting its dialog stays. */
    toggleDrawing: () => {
      if (!toolbarShown) return setDrawOpen(true);
      setDrawOpen(false);
      measure.stop();
      stopMode();
      setGrouped(new Set());
      if (drawing.editing || !drawing.drawn) drawing.clear();
    },
  };
};
