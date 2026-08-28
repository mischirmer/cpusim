import { describe, it, expect } from "vitest";
import { alu } from "./alu";

describe("ALU — arithmetic", () => {
  it("adds with carry flag", () => {
    expect(alu("ADD", 0x0005, 0x0003, false)).toMatchObject({ result: 0x0008, flags: { Z: false, N: false, C: false } });
    expect(alu("ADD", 0xffff, 0x0001, false)).toMatchObject({ result: 0x0000, flags: { Z: true, N: false, C: true } });
    expect(alu("ADD", 0x7fff, 0x0001, false)).toMatchObject({ result: 0x8000, flags: { Z: false, N: true, C: false } });
  });

  it("addc adds carry-in", () => {
    expect(alu("ADDC", 0x0000, 0x0000, true)).toMatchObject({ result: 0x0001 });
    expect(alu("ADDC", 0xffff, 0x0000, true)).toMatchObject({ result: 0x0000, flags: { C: true } });
  });

  it("sub calculates borrow => C=1", () => {
    expect(alu("SUB", 0x0005, 0x0003, false)).toMatchObject({ result: 0x0002, flags: { Z: false, N: false, C: false } });
    expect(alu("SUB", 0x0000, 0x0001, false)).toMatchObject({ result: 0xffff, flags: { Z: false, N: true, C: true } });
    expect(alu("SUB", 0x0003, 0x0003, false)).toMatchObject({ result: 0x0000, flags: { Z: true, N: false, C: false } });
  });

  it("subc subtracts carry-in", () => {
    expect(alu("SUBC", 0x0005, 0x0003, true)).toMatchObject({ result: 0x0001, flags: { C: false } });
    expect(alu("SUBC", 0x0000, 0x0000, true)).toMatchObject({ result: 0xffff, flags: { C: true } });
  });
});

describe("ALU — logical", () => {
  it("and, or, xor, set Z/N and clear C", () => {
    expect(alu("AND", 0x00f0, 0x00ff, false)).toMatchObject({ result: 0x00f0, flags: { C: false } });
    expect(alu("AND", 0x0000, 0xffff, false)).toMatchObject({ result: 0x0000, flags: { Z: true, N: false, C: false } });
    expect(alu("OR", 0x00f0, 0x000f, false)).toMatchObject({ result: 0x00ff, flags: { Z: false } });
    expect(alu("XOR", 0x00ff, 0x000f, false)).toMatchObject({ result: 0x00f0, flags: { Z: false } });
    expect(alu("XOR", 0x8000, 0x8000, false)).toMatchObject({ result: 0x0000, flags: { Z: true } });
  });

  it("not inverts the word", () => {
    expect(alu("NOT", 0x0000, 0, false)).toMatchObject({ result: 0xffff, flags: { Z: false, N: true, C: false } });
    expect(alu("NOT", 0xffff, 0, false)).toMatchObject({ result: 0x0000, flags: { Z: true, N: false, C: false } });
  });
});

describe("ALU — shifts and rotates", () => {
  it("shl shifts left, C gets top bit", () => {
    expect(alu("SHL", 0x8000, 0, false)).toMatchObject({ result: 0x0000, flags: { C: true, Z: true } });
    expect(alu("SHL", 0x0f00, 0, false)).toMatchObject({ result: 0x1e00, flags: { C: false } });
  });

  it("shr shifts right, C gets bottom bit", () => {
    expect(alu("SHR", 0x8000, 0, false)).toMatchObject({ result: 0x4000, flags: { C: false, N: false } });
    expect(alu("SHR", 0x0001, 0, false)).toMatchObject({ result: 0x0000, flags: { C: true, Z: true } });
  });

  it("rol rotates left through the MSB", () => {
    expect(alu("ROL", 0x8001, 0, false)).toMatchObject({ result: 0x0003, flags: { C: true } });
  });

  it("ror rotates right through the LSB", () => {
    expect(alu("ROR", 0x0001, 0, false)).toMatchObject({ result: 0x8000, flags: { C: true, N: true } });
  });

  it("rolc/rorc rotate through carry", () => {
    expect(alu("ROLC", 0x8000, 0, true)).toMatchObject({ result: 0x0001, flags: { C: true } });
    expect(alu("ROLC", 0x8000, 0, false)).toMatchObject({ result: 0x0000, flags: { C: true } });
    expect(alu("RORC", 0x0001, 0, true)).toMatchObject({ result: 0x8000, flags: { C: true } });
    expect(alu("RORC", 0x0001, 0, false)).toMatchObject({ result: 0x0000, flags: { C: true } });
  });
});

describe("ALU — 16-bit wrapping", () => {
  it("wraps all operations to uint16", () => {
    expect(alu("ADD", 0xffff, 0xffff, false).result).toBe(0xfffe);
    expect(alu("SUB", 0x0000, 0x0001, false).result).toBe(0xffff);
    expect(alu("NOT", 0x0000, 0, false).result).toBe(0xffff);
    expect(alu("SHL", 0xffff, 0, false).result).toBe(0xfffe);
  });

  it("sets N from bit 15", () => {
    expect(alu("ADD", 0x0001, 0x7fff, false).flags.N).toBe(true);
    expect(alu("ADD", 0x0001, 0x7ffe, false).flags.N).toBe(false);
  });
});
