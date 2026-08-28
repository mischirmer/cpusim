import { describe, it, expect } from "vitest";
import { statusMatrix, simulate } from "../testutil";
import { DEFAULT_CONFIG } from "../config";
import { parseAssembly } from "../parser/parser";

describe("pipeline patterns", () => {
  it("no-hazard instructions flow diagonally with no stalls", () => {
    const { matrix } = statusMatrix("ldi %r1 $1\nldi %r2 $2\nhlt\n");
    const [i1, i2, i3] = matrix;
    expect(i1).toEqual(["waiting", "IF", "ID", "OF", "EX", "WB", null, null]);
    expect(i2).toEqual(["waiting", "waiting", "IF", "ID", "OF", "EX", "WB", null]);
    expect(i3).toEqual(["waiting", "waiting", "waiting", "IF", "ID", "OF", "EX", "WB"]);
    const r = simulate(parseAssembly("ldi %r1 $1\nldi %r2 $2\nhlt\n"), DEFAULT_CONFIG);
    expect(r.statistics.stallCycles).toBe(0);
  });

  it("RAW without forwarding stalls the consumer two cycles (end-of-WB visibility)", () => {
    const { matrix, result } = statusMatrix("ldi %r1 $5\nadd %r2 %r1 %r3\nhlt\n", {
      forwarding: { enabled: false },
    });
    const [i1, i2, i3] = matrix;
    expect(i1).toEqual(["waiting", "IF", "ID", "OF", "EX", "WB", null, null, null, null]);
    // producer WB@5; the consumer's OF reads r1 in cycle 6 (after WB), so it is held
    // at ID in cycles 4 and 5 (two stalls), never entering OF early
    expect(i2).toEqual(["waiting", "waiting", "IF", "ID", "stall", "stall", "OF", "EX", "WB", null]);
    expect(i3).toEqual(["waiting", "waiting", "waiting", "IF", "stall", "stall", "ID", "OF", "EX", "WB"]);
    expect(result.statistics.stallCycles).toBe(2);
    expect(result.statistics.completedInstructions).toBe(2);
    expect(result.statistics.totalCycles).toBe(9);
    expect(result.statistics.cpi).toBeCloseTo(4, 5); // lastUseful(8) / 2
  });
});
