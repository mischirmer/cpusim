import { describe, it, expect } from "vitest";
import { parseAssembly, simulate } from "../core/index";
import { EXAMPLES } from "./examples";

describe("Beispielprogramme", () => {
  for (const ex of EXAMPLES) {
    it(`lässt sich ausführen: ${ex.title}`, () => {
      const parsed = parseAssembly(ex.source);
      expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const result = simulate(parsed);
      expect(result.snapshots.length).toBeGreaterThan(1);
      expect(["hlt", "program-end"]).toContain(result.termination.type);
    });
  }
});
