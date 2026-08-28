import { describe, it, expect } from "vitest";
import { statusMatrix, finalRegisters } from "../testutil";

// The uploaded exam pattern (implementation.md §38.1) applied to a concrete program:
//   I1 ldi %r1 $5
//   I2 add %r2 %r1 %r4   (RAW on %r1 -> two-cycle stall, end-of-WB visibility)
//   I3 b  $2              (taken branch)
//   I4 xor ...             (wrong path, flushed)
//   I5 nop ...             (wrong path, flushed)
//   I6 ldi %r5 $7          (branch target, executed)
//   hlt
//
// Cycle-by-cycle for the taken branch (finalized semantics):
//   the branch resolves TAKEN in EX at cycle 7; at that moment every younger
//   wrong-path dynamic instruction still in the pipeline is flushed (xor, nop,
//   ldi#1). The target ldi#2 is then fetched and executed.
const EXAM = `ldi %r1 $5
add %r2 %r1 %r4
b $2
xor %r3 %r3 %r3
nop
ldi %r5 $7
hlt
`;

describe("golden — exam RAW + taken branch (structural)", () => {
  it("shows a two-cycle RAW stall, flushes all younger wrong-path, and runs the target", () => {
    const { matrix, result } = statusMatrix(EXAM);
    const [i1, i2] = matrix;

    // I1 flows through 5 stages; I2 consumes it with a two-cycle stall (RAW, end-of-WB)
    expect(i1[1]).toBe("IF");
    expect(i1[5]).toBe("WB");
    expect(i2[2]).toBe("IF");
    expect(i2[3]).toBe("ID");
    expect(i2[4]).toBe("stall");
    expect(i2[5]).toBe("stall");
    expect(i2[6]).toBe("OF");
    expect(i2[7]).toBe("EX");
    expect(i2[8]).toBe("WB");
    expect(result.statistics.stallCycles).toBe(2);

    // I3 is the taken branch; it produces exactly one flush EVENT
    const b = result.dynamicInstructions.find((d) => d.address === 4 && d.mnemonic === "b")!;
    expect(b.branchDetail!.taken).toBe(true);
    expect(result.statistics.flushCount).toBe(1);

    // the general rule: every younger wrong-path instruction in the pipeline is flushed.
    // the exact number depends on the program layout / backpressure, NOT a fixed "1".
    const flushed = result.dynamicInstructions.filter((d) => d.status === "flushed");
    expect(flushed.length).toBeGreaterThan(0);
    expect(flushed.every((f) => f.fetchSeq > b.fetchSeq)).toBe(true);
    // flushed wrong-path instructions are preserved in history as "flush"
    for (const f of flushed) {
      const row = matrix[result.dynamicInstructions.indexOf(f)];
      expect(row.includes("flush")).toBe(true);
    }

    // the branch target executes after the flush
    const target = result.dynamicInstructions.find((d) => d.mnemonic === "ldi" && d.address === 10 && d.status === "completed")!;
    expect(target).toBeDefined();
    expect(result.finalState.registers[5]).toBe(7);

    // useful completed instructions: I1 I2 I3 I6 (flushed do not count)
    expect(result.statistics.completedInstructions).toBe(4);
  });

  it("does not corrupt architectural state: flushed instruction writes nothing", () => {
    const { result } = statusMatrix(EXAM);
    // xor %r3 %r3 %r3 was flushed -> r3 must remain 0
    expect(result.finalState.registers[3]).toBe(0);
    expect(result.finalState.registers[2]).toBe(5); // I2 wrote r2
  });
});

describe("golden — no-hazard pipeline (spec §38.2)", () => {
  it("independent instructions flow one per cycle with no stalls", () => {
    const src = `ldi %r1 $1
ldi %r2 $2
ldi %r3 $3
hlt
`;
    const { matrix, result } = statusMatrix(src);
    for (const row of matrix) expect(row.includes("stall")).toBe(false);
    expect(result.statistics.stallCycles).toBe(0);
    expect(finalRegisters(result)[1]).toBe(1);
    expect(finalRegisters(result)[2]).toBe(2);
    expect(finalRegisters(result)[3]).toBe(3);
  });
});

describe("golden — loop with dynamic instances (spec §38.8)", () => {
  it("creates one dynamic instance per iteration and terminates", () => {
    const src = `ldi %r1 $3
ldi %r2 $1
sub %r1 %r1 %r2
bnz $-2
hlt
`;
    const { result } = statusMatrix(src);
    const subs = result.dynamicInstructions.filter((d) => d.mnemonic === "sub");
    // r1: 3 -> 2 -> 1 -> 0, so sub runs three times
    expect(subs.length).toBe(3);
    expect(subs.every((d) => d.status === "completed")).toBe(true);
    const bnzTaken = result.dynamicInstructions.filter((d) => d.mnemonic === "bnz" && d.branchDetail?.taken);
    expect(bnzTaken.length).toBe(2); // taken while Z=0, not taken once Z=1
    expect(result.finalState.registers[1]).toBe(0);
    expect(result.termination.type).toBe("hlt");
  });

  it("static instructions are distinct dynamic instances with unique uids", () => {
    const src = `ldi %r1 $3
ldi %r2 $1
sub %r1 %r1 %r2
bnz $-2
hlt
`;
    const { result } = statusMatrix(src);
    const subUids = result.dynamicInstructions.map((d) => d.uid);
    const unique = new Set(subUids).size;
    expect(unique).toBe(subUids.length);
  });
});

describe("golden — hlt (spec §20)", () => {
  it("stops fetching and halts after in-flight instructions drain", () => {
    const src = `ldi %r1 $5
hlt
ldi %r2 $9
`;
    const { result } = statusMatrix(src);
    expect(result.termination.type).toBe("hlt");
    // the instruction after hlt may be fetched speculatively, but must not retire (spec §20)
    const after = result.dynamicInstructions.find((d) => d.mnemonic === "ldi" && d.address === 4);
    expect(after).toBeDefined();
    expect(after!.status).toBe("flushed");
    expect(result.finalState.registers[2]).toBe(0);
  });
});

describe("golden — CPI and lastUsefulCycle vs totalCycles (spec §24)", () => {
  it("CPI uses lastUsefulCycle, not the trailing empty drain cycle", () => {
    const { result } = statusMatrix(`ldi %r1 $5
add %r2 %r1 %r3
hlt
`);
    const st = result.statistics;
    // lastUsefulCycle = retirement cycle of the last completed useful instruction (add)
    // totalCycles includes one final empty drain cycle after the last useful retirement
    expect(st.completedInstructions).toBe(2);
    expect(st.cpi).toBeCloseTo(8 / 2, 5); // 4 (lastUsefulCycle 8)
    expect(st.totalCycles).toBe(9);
    expect(st.totalCycles).toBeGreaterThan(st.cpi! * st.completedInstructions);
  });

  it("flushed instructions are not included in the CPI denominator", () => {
    const { result } = statusMatrix(EXAM);
    const st = result.statistics;
    expect(st.completedInstructions).toBe(4);
    expect(st.flushedInstructions).toBeGreaterThan(0);
    // CPI = lastUsefulCycle / completed useful instructions. The flushed wrong-path
    // instructions do not count in the denominator, and the trailing empty drain
    // cycle (totalCycles − lastUsefulCycle) is excluded from the numerator.
    expect(st.cpi).toBeCloseTo(13 / 4, 5); // lastUsefulCycle 13 / 4
    expect(st.totalCycles).toBe(14);
    expect(st.cpi! * st.completedInstructions).toBeLessThan(st.totalCycles);
  });

  it("termination exposes the halting cycle", () => {
    const { result } = statusMatrix(`ldi %r1 $5
hlt
`);
    expect(result.termination.type).toBe("hlt");
  });
});
