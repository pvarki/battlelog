import { describe, expect, test, vi } from "vitest";
import { answerPick, cancelPick, canPick, registerPicker, requestPick } from "./map-pick.ts";

const request = () => ({ label: "Location", onPick: vi.fn(), onCancel: vi.fn() });

describe("map pick", () => {
  test("a click answers the request once", () => {
    const r = request();
    requestPick(r);
    answerPick([24.9, 60.2]);
    answerPick([0, 0]);
    expect(r.onPick).toHaveBeenCalledExactlyOnceWith([24.9, 60.2]);
    expect(r.onCancel).not.toHaveBeenCalled();
  });

  test("a new request cancels the previous one", () => {
    const first = request();
    const second = request();
    requestPick(first);
    requestPick(second);
    answerPick([1, 2]);
    expect(first.onCancel).toHaveBeenCalledOnce();
    expect(first.onPick).not.toHaveBeenCalled();
    expect(second.onPick).toHaveBeenCalledWith([1, 2]);
  });

  test("withdrawing a request leaves a newer one alone", () => {
    const first = request();
    const withdraw = requestPick(first);
    withdraw();
    answerPick([1, 2]);
    expect(first.onPick).not.toHaveBeenCalled();
    expect(first.onCancel).not.toHaveBeenCalled();

    const old = requestPick(request());
    const second = request();
    requestPick(second);
    old();
    answerPick([3, 4]);
    expect(second.onPick).toHaveBeenCalledWith([3, 4]);
  });

  test("cancelling from a map tells the requester", () => {
    const r = request();
    requestPick(r);
    cancelPick();
    answerPick([1, 2]);
    expect(r.onCancel).toHaveBeenCalledOnce();
    expect(r.onPick).not.toHaveBeenCalled();
  });

  test("handled only while a map is registered", () => {
    expect(canPick()).toBe(false);
    const unregister = registerPicker();
    const other = registerPicker();
    expect(canPick()).toBe(true);
    unregister();
    expect(canPick()).toBe(true);
    other();
    expect(canPick()).toBe(false);
  });
});
