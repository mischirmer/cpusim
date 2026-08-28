import { describe, it, expect } from "vitest";
import { statusMatrix, finalFlags, finalRegisters, simulate } from "../testutil";
import { parseAssembly } from "../parser/parser";
import { DEFAULT_CONFIG } from "../config";

// pre-load registers via initial state so tests isolate flag behavior
// without unrelated register RAW hazards
function flagSim(source: string, regs: Record<number, number> = {}) {
  return simulate(parseAssembly(source), DEFAULT_CONFIG, {
    registers: Array.from({ length: 16 }, (_, i) => regs[i] ?? 0),
  });
}

describe("flags — architectural state after EX/WB", () => {
  it("sub 0-1 sets N and C (borrow), wraps to 0xffff", () => {
    const { result } = statusMatrix(`ldi %r1 $0
ldi %r2 $1
sub %r3 %r1 %r2
hlt
`);
    expect(finalFlags(result)).toEqual({ Z: false, N: true, C: true });
    expect(finalRegisters(result)[3]).toBe(0xffff);
  });

  it("add overflow sets C and Z", () => {
    const { result } = statusMatrix(`ldi %r1 $0xffff
ldi %r2 $1
add %r3 %r1 %r2
hlt
`);
    expect(finalFlags(result)).toEqual({ Z: true, N: false, C: true });
    expect(finalRegisters(result)[3]).toBe(0);
  });

  it("xor with itself sets Z", () => {
    const { result } = statusMatrix(`ldi %r1 $0x8000
xor %r2 %r1 %r1
hlt
`);
    expect(finalFlags(result).Z).toBe(true);
    expect(finalFlags(result).N).toBe(false);
  });

  it("ldi does not change flags", () => {
    const { result } = statusMatrix(`ldi %r1 $0
hlt
`);
    expect(finalFlags(result)).toEqual({ Z: false, N: false, C: false });
  });
});

describe("flags — always-available after EX (no forwarding checkbox needed)", () => {
  it("a conditional branch reads the just-computed flag in EX without stalling", () => {
    // sub reads pre-loaded registers (no RAW); produces Z=true; bz must take
    // the branch even with forwarding OFF — only the flag dependency matters.
    const src = `sub %r2 %r1 %r1
bz $0
ldi %r3 $9
hlt
`;
    const r = flagSim(src, { 1: 0 });
    const br = r.dynamicInstructions.find((d) => d.mnemonic === "bz")!;
    expect(br.branchDetail?.taken).toBe(true);
    expect(br.branchDetail?.flag).toEqual({ flag: "Z", value: true });
    // No register RAW here, so any stall would be a flag stall. There must be none.
    expect(r.statistics.stallCycles).toBe(0);
  });

  it("forwarding checkbox does not change flag-dependent behavior", () => {
    const src = `sub %r2 %r1 %r1
bz $0
hlt
`;
    const p = parseAssembly(src);
    const off = simulate(p, DEFAULT_CONFIG, { registers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    const on = simulate(p, { ...DEFAULT_CONFIG, forwarding: { enabled: true } }, { registers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    // flag hazard adds no stall and no forwarding event regardless of checkbox
    expect(off.statistics.stallCycles).toBe(0);
    expect(on.statistics.stallCycles).toBe(0);
    expect(off.statistics.forwardingEvents).toBe(0);
  });
});

describe("flags — carry chain addc/subc (carry-in read from latest EX)", () => {
  it("addc uses current carry after an overflowing add", () => {
    const { result } = statusMatrix(`ldi %r1 $0xffff
ldi %r2 $1
add %r3 %r1 %r2
ldi %r4 $0
addc %r5 %r4 %r4
hlt
`);
    // add overflow leaves C=1; addc computes 0+0+C = 1
    expect(finalRegisters(result)[5]).toBe(1);
  });

  it("subc subtracts the borrow as well", () => {
    const { result } = statusMatrix(`ldi %r1 $0
ldi %r2 $1
sub %r3 %r1 %r2
ldi %r4 $5
ldi %r5 $3
subc %r6 %r4 %r5
hlt
`);
    // sub sets C=1 (borrow); subc computes 5-3-1 = 1
    expect(finalRegisters(result)[6]).toBe(1);
  });
});

describe("flags — visible in the cycle after EX (not before)", () => {
  it("a branch right after a flag producer sees the EX flag, not a stale one", () => {
    const { result } = statusMatrix(`ldi %r1 $5
ldi %r2 $5
sub %r3 %r1 %r2
bnz $0
ldi %r4 $7
hlt
`);
    // sub 5-5=0 => Z=1 => bnz NOT taken
    const br = result.dynamicInstructions.find((d) => d.mnemonic === "bnz")!;
    expect(br.branchDetail?.taken).toBe(false);
    expect(br.branchDetail?.flag).toEqual({ flag: "Z", value: true });
  });
});
