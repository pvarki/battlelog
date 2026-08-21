import type { ComponentType } from "react";
import type { Widget } from "../api.ts";
import { ClockWidget } from "./ClockWidget.tsx";

export type WidgetType = Widget["type"];

type WidgetDefinition = {
  title: string;
  component: ComponentType;
  /** Grid units (24-col grid, 40px rows) used when the widget is added. */
  defaultSize: { w: number; h: number };
  minSize: { minW: number; minH: number };
};

/** Every widget the UI can render. New widget types register here. */
export const WIDGET_REGISTRY: Record<WidgetType, WidgetDefinition> = {
  clock: {
    title: "Clock",
    component: ClockWidget,
    defaultSize: { w: 5, h: 4 },
    minSize: { minW: 3, minH: 3 },
  },
};

export const WIDGET_TYPES = Object.keys(WIDGET_REGISTRY) as WidgetType[];
