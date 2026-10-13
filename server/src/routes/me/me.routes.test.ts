import "varlock/auto-load";
import { ENV } from "varlock/env";
import { expect, test } from "vitest";
import { meRoutes } from "./me.routes.ts";

test("callsign is the CN of the proxy-verified client cert", async () => {
  const res = await meRoutes.request("/me", {
    headers: { [ENV.RM_MTLS_HEADER]: "CN=KETTU23a, O=PVARKI" },
  });
  expect(await res.json()).toEqual({ callsign: "KETTU23a" });
});

test("no client cert means no callsign", async () => {
  const res = await meRoutes.request("/me");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ callsign: null });
});
