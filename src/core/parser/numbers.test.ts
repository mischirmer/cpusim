import { describe, it, expect } from "vitest";
import { parseNumber, formatImmediate } from "./numbers";

describe("parseNumber", () => {
  it("parses decimal integers", () => {
    expect(parseNumber("42")).toEqual({ value: 42, ok: true });
    expect(parseNumber("-8")).toEqual({ value: -8, ok: true });
    expect(parseNumber("0")).toEqual({ value: 0, ok: true });
  });

  it("parses hex literals", () => {
    expect(parseNumber("0x2A")).toEqual({ value: 42, ok: true });
    expect(parseNumber("0xFFFF")).toEqual({ value: 65535, ok: true });
    expect(parseNumber("0x")).toEqual({ value: 0, ok: false });
    expect(parseNumber("0xZZ")).toEqual({ value: 0, ok: false });
  });

  it("parses binary literals", () => {
    expect(parseNumber("0b101010")).toEqual({ value: 42, ok: true });
    expect(parseNumber("0b102")).toEqual({ value: 0, ok: false });
    expect(parseNumber("0b")).toEqual({ value: 0, ok: false });
  });

  it("rejects garbage and leading zeros", () => {
    expect(parseNumber("abc").ok).toBe(false);
    expect(parseNumber("5.5").ok).toBe(false);
    expect(parseNumber("").ok).toBe(false);
    expect(parseNumber(" ").ok).toBe(false);
  });
});

describe("formatImmediate", () => {
  it("renders signed 16-bit values", () => {
    expect(formatImmediate(0)).toBe("0");
    expect(formatImmediate(5)).toBe("5");
    expect(formatImmediate(-8)).toBe("-8");
    expect(formatImmediate(0xffff)).toBe("-1");
    expect(formatImmediate(0x8000)).toBe("-32768");
    expect(formatImmediate(0x7fff)).toBe("32767");
  });
});
