import { useEffect, useSyncExternalStore } from "react";

export type LngLat = [lng: number, lat: number];

export type PickRequest = {
  label: string;
  onPick: (lngLat: LngLat) => void;
  /** Cancelled from elsewhere: a map's Cancel or Esc, or a newer request. */
  onCancel: () => void;
};

/**
 * One map click asked for by a form, answered by whichever pickable map gets
 * it. Memory only, one at a time.
 */
let active: PickRequest | undefined;
let pickers = 0;
const listeners = new Set<() => void>();

const set = (next: PickRequest | undefined) => {
  active = next;
  for (const listener of listeners) listener();
};

/** Replaces any earlier request; the returned function withdraws this one without calling its `onCancel`. */
export const requestPick = (request: PickRequest): (() => void) => {
  const previous = active;
  set(request);
  previous?.onCancel();
  return () => {
    if (active === request) set(undefined);
  };
};

export const answerPick = (lngLat: LngLat) => {
  const request = active;
  set(undefined);
  request?.onPick(lngLat);
};

export const cancelPick = () => {
  const request = active;
  set(undefined);
  request?.onCancel();
};

/** Whether a map on screen can take a request. */
export const canPick = () => pickers > 0;

export const registerPicker = () => {
  pickers++;
  return () => {
    pickers--;
  };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Registers a map as able to pick while `enabled`, and returns the request it should answer. */
export const usePickRequest = (enabled: boolean): PickRequest | undefined => {
  useEffect(() => (enabled ? registerPicker() : undefined), [enabled]);
  const request = useSyncExternalStore(subscribe, () => active);
  return enabled ? request : undefined;
};
