import { expect, test } from "vitest";
import { cnFromDn, parseDistinguishedName } from "./client-cert.ts";

test("parses OpenSSL slash format", () => {
  expect(parseDistinguishedName("/C=FI/O=PVARKI/CN=rasenmaeher")).toEqual({
    C: "FI",
    O: "PVARKI",
    CN: "rasenmaeher",
  });
});

test("parses RFC 2253 comma format", () => {
  expect(parseDistinguishedName("CN=KETTU23a, O=PVARKI, C=FI")).toEqual({
    CN: "KETTU23a",
    O: "PVARKI",
    C: "FI",
  });
});

test("first occurrence of a key wins", () => {
  expect(cnFromDn("CN=first, CN=second")).toBe("first");
});

test("malformed and empty input yields nothing", () => {
  expect(parseDistinguishedName(undefined)).toEqual({});
  expect(parseDistinguishedName("   ")).toEqual({});
  expect(parseDistinguishedName("no-equals-here")).toEqual({});
  expect(cnFromDn("O=PVARKI")).toBeUndefined();
  expect(cnFromDn("=value-without-key")).toBeUndefined();
});
