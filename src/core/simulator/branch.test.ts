import { describe, it, expect } from "vitest";
import { statusMatrix, simulate } from "../testutil";
import { parseAssembly } from "../parser/parser";
import { DEFAULT_CONFIG } from "../config";

// helper: run a program and return branch evaluation details by mnemonic
function branchDetail(source: string, flags?: { Z?: boolean; N?: boolean; C?: boolean }) {
  const init = flags ? { flags } : undefined;
  const program = parseAssembly(source);
  const result = simulate(program, DEFAULT_CONFIG, init as { flags: { Z: boolean } });
  return result.dynamicInstructions
    .filter((d) => d.branchDetail)
    .map((d) => ({ mnemonic: d.mnemonic, detail: d.branchDetail! }));
}

describe("branch — condition evaluation", () => {
  it("unconditional b is always taken", () => {
    const r = branchDetail(`b $2`);
    expect(r[0].detail.taken).toBe(true);
  });

  it("bz/bnz read Z", () => {
    expect(branchDetail(`bz $1\nhlt\n`, { Z: true })[0].detail.taken).toBe(true);
    expect(branchDetail(`bz $1\nhlt\n`, { Z: false })[0].detail.taken).toBe(false);
    expect(branchDetail(`bnz $1\nhlt\n`, { Z: false })[0].detail.taken).toBe(true);
    expect(branchDetail(`bnz $1\nhlt\n`, { Z: true })[0].detail.taken).toBe(false);
  });

  it("bn/bnn read N", () => {
    expect(branchDetail(`bn $1\nhlt\n`, { N: true })[0].detail.taken).toBe(true);
    expect(branchDetail(`bn $1\nhlt\n`, { N: false })[0].detail.taken).toBe(false);
    expect(branchDetail(`bnn $1\nhlt\n`, { N: false })[0].detail.taken).toBe(true);
    expect(branchDetail(`bnn $1\nhlt\n`, { N: true })[0].detail.taken).toBe(false);
  });

  it("bc/bnc read C", () => {
    expect(branchDetail(`bc $1\nhlt\n`, { C: true })[0].detail.taken).toBe(true);
    expect(branchDetail(`bc $1\nhlt\n`, { C: false })[0].detail.taken).toBe(false);
    expect(branchDetail(`bnc $1\nhlt\n`, { C: false })[0].detail.taken).toBe(true);
    expect(branchDetail(`bnc $1\nhlt\n`, { C: true })[0].detail.taken).toBe(false);
  });
});

describe("branch — target computation (advanced-pc base)", () => {
  it("b $0 continues with the next sequential instruction", () => {
    const src = `ldi %r1 $1
b $0
ldi %r2 $2
hlt
`;
    const { result } = statusMatrix(src);
    // branch does not flush the following instruction (target = next)
    const b = result.dynamicInstructions.find((d) => d.mnemonic === "b")!;
    expect(b.branchDetail!.taken).toBe(true);
    // advanced-pc base: b $0 targets the next sequential instruction (address 4)
    expect(b.branchDetail!.targetAddress).toBe(4);
    // sequential continuation semantics hold: the following instruction runs
    expect(result.finalState.registers[2]).toBe(2);
  });

  it("computes forward target A + 2 + 2*i", () => {
    const { result } = statusMatrix(`b $3
hlt
`);
    const b = result.dynamicInstructions[0];
    expect(b.branchDetail!.targetAddress).toBe(0 + 2 + 2 * 3);
  });

  it("computes backward target with negative offset", () => {
    const { result } = statusMatrix(`ldi %r1 $3
ldi %r2 $1
sub %r1 %r1 %r2
bnz $-2
hlt
`);
    const bnz = result.dynamicInstructions.find((d) => d.mnemonic === "bnz")!;
    expect(bnz.address).toBe(6);
    expect(bnz.branchDetail!.targetAddress).toBe(4);
  });
});

describe("branch — taken branch flushes wrong-path", () => {
  it("flushes younger wrong-path instructions and resumes at target", () => {
    const src = `ldi %r1 $1
sub %r2 %r1 %r1
bz $0
xor %r3 %r3 %r3
ldi %r4 $7
hlt
`;
    const { result, matrix } = statusMatrix(src);
    const bz = result.dynamicInstructions.find((d) => d.mnemonic === "bz")!;
    expect(bz.branchDetail!.taken).toBe(true);
    expect(result.statistics.flushCount).toBe(1);
    const flushed = result.dynamicInstructions.filter((d) => d.status === "flushed");
    expect(flushed.length).toBeGreaterThan(0);
    // flushed instructions must still appear in history (not vanish)
    for (const f of flushed) {
      const row = matrix[result.dynamicInstructions.indexOf(f)];
      expect(row.includes("flush")).toBe(true);
    }
    // the flushed wrong-path target must NOT have written a register
    const xorWrites = result.dynamicInstructions
      .filter((d) => d.mnemonic === "xor" && d.status === "flushed");
    expect(xorWrites.length).toBeGreaterThan(0);
    // r3 must not have been written by the flushed xor
    expect(result.finalState.registers[3]).toBe(0);
  });

  it("a non-taken branch causes no flush", () => {
    // ldi produces no new flag; initial Z=0, so bz is NOT taken
    const src = `ldi %r1 $1
bz $1
ldi %r3 $9
hlt
`;
    const { result } = statusMatrix(src);
    const bz = result.dynamicInstructions.find((d) => d.mnemonic === "bz")!;
    expect(bz.branchDetail!.taken).toBe(false);
    expect(result.statistics.flushCount).toBe(0);
    expect(result.statistics.flushedInstructions).toBe(0);
    // sequential execution continues into the following instruction
    expect(result.finalState.registers[3]).toBe(9);
  });
});
