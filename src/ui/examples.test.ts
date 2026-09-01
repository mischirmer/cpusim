import { describe, it, expect } from "vitest";
import { parseAssembly, simulate } from "../core/index";
import { EXAMPLES } from "./examples";

describe("Beispielprogramme", () => {
  for (const ex of EXAMPLES) {
    it(`lässt sich ausführen: ${ex.title}`, () => {
      const parsed = parseAssembly(ex.source);
      expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const result = simulate(parsed, undefined, ex.initialState);
      expect(result.snapshots.length).toBeGreaterThan(1);
      expect(["hlt", "program-end"]).toContain(result.termination.type);
    });
  }

  it("prefills the 2x3 multiplication example as Big-Endian words and stores 6", () => {
    const ex = EXAMPLES.find((example) => example.id === "multiply-2x3")!;
    const result = simulate(parseAssembly(ex.source), undefined, ex.initialState);
    const memory = new Map(result.snapshots[result.snapshots.length - 1]!.memory);

    expect(memory.get(0x2000)).toBe(0x00);
    expect(memory.get(0x2001)).toBe(0x02);
    expect(memory.get(0x2002)).toBe(0x00);
    expect(memory.get(0x2003)).toBe(0x03);
    expect(memory.get(0x2004)).toBe(0x00);
    expect(memory.get(0x2005)).toBe(0x06);
  });
});
