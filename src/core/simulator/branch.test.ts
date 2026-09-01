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

describe("branch — target computation (instruction-address base)", () => {
  it("b $0 targets the branch instruction itself", () => {
    const src = `b $0`;
    const program = parseAssembly(src);
    const result = simulate(program, { ...DEFAULT_CONFIG, maxCycles: 5 });
    const b = result.dynamicInstructions[0];
    expect(b.branchDetail!.taken).toBe(true);
    expect(b.branchDetail!.targetAddress).toBe(0);
    expect(result.termination.type).toBe("max-cycles");
  });

  it("computes forward target A + 2*i", () => {
    const { result } = statusMatrix(`nop
b $3
hlt
`);
    const b = result.dynamicInstructions.find((d) => d.mnemonic === "b")!;
    expect(b.address).toBe(2);
    expect(b.branchDetail!.targetAddress).toBe(2 + 2 * 3);
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
    expect(bnz.branchDetail!.targetAddress).toBe(2);
  });
});

describe("branch — taken branch flushes wrong-path", () => {
  it("flushes younger wrong-path instructions and resumes at target", () => {
    const src = `ldi %r1 $1
sub %r2 %r1 %r1
bz $3
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

  it("shows the wrong-path instruction in its stage during branch EX and flushes it next cycle", () => {
    const src = `ldi %r1 $1
sub %r2 %r1 %r1
bz $3
xor %r3 %r3 %r3
ldi %r4 $7
hlt
`;
    const { result, matrix } = statusMatrix(src);
    const branch = result.dynamicInstructions.find((d) => d.mnemonic === "bz")!;
    const branchRow = matrix[result.dynamicInstructions.indexOf(branch)];
    const branchExCycle = branchRow.findIndex((status) => status === "EX");
    const flushed = result.dynamicInstructions.find((d) => d.status === "flushed" && d.fetchSeq > branch.fetchSeq)!;
    const flushedRow = matrix[result.dynamicInstructions.indexOf(flushed)];

    expect(branchExCycle).toBeGreaterThan(0);
    expect(flushedRow[branchExCycle]).not.toBe("flush");
    expect(flushedRow[branchExCycle + 1]).toBe("flush");
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

  it("runs the original multiplication program branch offsets without adjustment", () => {
    expect(runMultiplyProgram(2, 3).product).toBe(6);
    expect(runMultiplyProgram(7, 9).product).toBe(63);
  });
});

function runMultiplyProgram(a: number, b: number): { product: number; result: ReturnType<typeof simulate> } {
  const src = `ldi %r0 $0x200
shl %r0 %r0
shl %r0 %r0
shl %r0 %r0
shl %r0 %r0
ldi %r1 $1
ldi %r2 $2
ldw %r3 %r0
add %r0 %r0 %r2
ldw %r4 %r0
ldi %r5 $0
and %r6 %r4 %r1
bz $3
add %r5 %r5 %r3
bc $6
shr %r4 %r4
bz $6
shl %r3 %r3
bc $2
b $-8
ldi %r5 $0
not %r5 %r5
add %r0 %r0 %r2
stw %r0 %r5
hlt
`;
  const program = parseAssembly(src);
  const initialMemory = new Map([
    [0x2000, (a >> 8) & 0xff],
    [0x2001, a & 0xff],
    [0x2002, (b >> 8) & 0xff],
    [0x2003, b & 0xff],
  ]);
  const result = simulate(program, DEFAULT_CONFIG, { memory: initialMemory });
  const memory = new Map(result.snapshots[result.snapshots.length - 1]!.memory);
  const product = ((memory.get(0x2004) ?? 0) << 8) | (memory.get(0x2005) ?? 0);
  const overflowHandler = result.dynamicInstructions.filter((d) => d.address === 0x28 || d.address === 0x2a);

  expect(result.termination.type).toBe("hlt");
  expect(memory.get(0x2000)).toBe((a >> 8) & 0xff);
  expect(memory.get(0x2001)).toBe(a & 0xff);
  expect(memory.get(0x2002)).toBe((b >> 8) & 0xff);
  expect(memory.get(0x2003)).toBe(b & 0xff);
  expect(overflowHandler.every((d) => d.status === "flushed")).toBe(true);

  return { product, result };
}
