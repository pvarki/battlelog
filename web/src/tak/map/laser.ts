import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * A pointer for briefings, seen on this screen only: a red dot with a short
 * fading trail, and while the button is held a pen stroke that stays until a
 * moment after release. Points are kept as coordinates, so zooming or panning
 * keeps the strokes on what they point at.
 */

export type LaserPoint = { lngLat: [number, number]; t: number };

export const TRAIL_MS = 600;
export const STROKE_HOLD_MS = 1500;
export const STROKE_FADE_MS = 600;

const COLOR = "#ff3030";
const STEP_PX = 2;

/** How visible a trail point is; 0 once it has faded. */
export const trailAlpha = (point: LaserPoint, now: number) =>
  Math.max(0, 1 - (now - point.t) / TRAIL_MS);

/** How visible a stroke is: full while drawn and held, then fading; 0 when gone. */
export const strokeAlpha = (endedAt: number | undefined, now: number) =>
  endedAt === undefined
    ? 1
    : Math.max(0, Math.min(1, 1 - (now - endedAt - STROKE_HOLD_MS) / STROKE_FADE_MS));

export const followLaser = (map: MapLibreMap) => {
  const container = map.getCanvasContainer();
  const canvas = document.createElement("canvas");
  canvas.className = "tak-laser";
  map.getContainer().appendChild(canvas);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  map.dragPan.disable();
  container.style.cursor = "none";
  // Without drag-pan the browser would claim a finger stroke as a scroll and cancel it.
  container.style.touchAction = "none";

  let trail: LaserPoint[] = [];
  let strokes: { points: LaserPoint[]; endedAt?: number }[] = [];
  let drawing: LaserPoint[] | undefined;
  let drawingPointer: number | undefined;
  let dot: { x: number; y: number } | undefined;
  let frame = 0;

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  };

  const line = (points: LaserPoint[], alphaOf: (p: LaserPoint) => number, width: number) => {
    for (let i = 1; i < points.length; i++) {
      const a = map.project((points[i - 1] as LaserPoint).lngLat);
      const b = map.project((points[i] as LaserPoint).lngLat);
      ctx.globalAlpha = alphaOf(points[i] as LaserPoint);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  };

  const render = () => {
    frame = 0;
    const now = performance.now();
    trail = trail.filter((p) => trailAlpha(p, now) > 0);
    strokes = strokes.filter((s) => strokeAlpha(s.endedAt, now) > 0);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = COLOR;
    ctx.shadowBlur = 8;
    for (const s of strokes) line(s.points, () => strokeAlpha(s.endedAt, now), 4);
    line(trail, (p) => trailAlpha(p, now), 3);
    if (dot) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
    if (trail.length || strokes.some((s) => s.endedAt !== undefined)) schedule();
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(render);
  };

  const pointOf = (e: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const add = (points: LaserPoint[], e: PointerEvent) => {
    const { x, y } = pointOf(e);
    const last = points.at(-1);
    if (last) {
      const p = map.project(last.lngLat);
      if (Math.hypot(x - p.x, y - p.y) < STEP_PX) return;
    }
    const { lng, lat } = map.unproject([x, y]);
    points.push({ lngLat: [lng, lat], t: performance.now() });
  };

  const onMove = (e: PointerEvent) => {
    if (drawing && e.pointerId !== drawingPointer) return;
    dot = pointOf(e);
    add(drawing ?? trail, e);
    schedule();
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || drawing) return;
    drawingPointer = e.pointerId;
    drawing = [];
    strokes.push({ points: drawing });
    add(drawing, e);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== drawingPointer) return;
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    const stroke = strokes.at(-1);
    if (stroke) stroke.endedAt = performance.now();
    drawing = undefined;
    schedule();
  };
  const onLeave = () => {
    dot = undefined;
    schedule();
  };

  resize();
  map.on("resize", resize);
  map.on("move", schedule);
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerdown", onDown);
  container.addEventListener("pointerleave", onLeave);
  return () => {
    cancelAnimationFrame(frame);
    map.off("resize", resize);
    map.off("move", schedule);
    container.removeEventListener("pointermove", onMove);
    container.removeEventListener("pointerdown", onDown);
    container.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    canvas.remove();
    container.style.cursor = "";
    container.style.touchAction = "";
    map.dragPan.enable();
  };
};
