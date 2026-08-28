import { describe, it, expect } from "vitest";
import { parseAssembly } from "./parser";

describe("parseAssembly — valid instructions", () => {
  it("parses canonical register-style instructions", () => {
    const p = parseAssembly(`ldi %r1 $5
add %r3 %r1 %r4
hlt
`);
    expect(p.diagnostics).toEqual([]);
    expect(p.instructions.map((i) => i.mnemonic)).toEqual(["ldi", "add", "hlt"]);
    expect(p.instructions[0].address).toBe(0);
    expect(p.instructions[1].address).toBe(2);
    expect(p.instructions[2].address).toBe(4);
  });

  it("accepts comma-separated variants", () => {
    const p = parseAssembly(`ldi %r1, $5
add %r3, %r1, %r4
`);
    expect(p.diagnostics).toEqual([]);
    expect(p.instructions).toHaveLength(2);
  });

  it("ignores comments and blank lines", () => {
    const p = parseAssembly(`; header

add %r1 %r2 %r3 ; inline comment
`);
    expect(p.diagnostics).toEqual([]);
    expect(p.instructions).toHaveLength(1);
    expect(p.instructions[0].sourceLine).toBe(3);
    expect(p.instructions[0].address).toBe(0);
  });
});

describe("parseAssembly — operands", () => {
  it("parses immediate of each base", () => {
    const p = parseAssembly(`ldi %r1 $42
ldi %r2 $0x2A
ldi %r3 $0b101010
ldi %r4 $-8
`);
    expect(p.diagnostics).toEqual([]);
    expect(p.instructions.map((i) => i.operands[1].type === "immediate" && i.operands[1].value)).toEqual([42, 42, 42, 0xfff8]);
  });

  it("parses signed branch offsets into 16-bit two's complement", () => {
    const p = parseAssembly(`b $-2
bz $1
`);
    expect(p.diagnostics).toEqual([]);
    expect(p.instructions[0].operands[0]).toEqual({ type: "immediate", value: 0xfffe });
    expect(p.instructions[1].operands[0]).toEqual({ type: "immediate", value: 1 });
  });

  it("parses all register-only instruction forms", () => {
    const p = parseAssembly(`add %r1 %r2 %r3
not %r4 %r5
shl %r6 %r7
mov %r8 %r9
nop
`);
    expect(p.diagnostics).toEqual([]);
    expect(p.instructions).toHaveLength(5);
  });

  it("parses all memory forms", () => {
    const p = parseAssembly(`ldb %r1 %r2
ldw %r3 %r4
stb %r5 %r6
stw %r7 %r8
`);
    expect(p.diagnostics).toEqual([]);
    expect(p.instructions.map((i) => i.mnemonic)).toEqual(["ldb", "ldw", "stb", "stw"]);
  });
});

describe("parseAssembly — German diagnostics", () => {
  it("reports unknown mnemonic", () => {
    const p = parseAssembly(`ad %r1 %r2 %r3
`);
    expect(p.instructions).toHaveLength(0);
    expect(p.diagnostics[0].severity).toBe("error");
    expect(p.diagnostics[0].code).toBe("UNKNOWN_MNEMONIC");
    expect(p.diagnostics[0].message).toContain('Unbekannte Instruktion "ad"');
    expect(p.diagnostics[0].line).toBe(1);
  });

  it("reports missing operands with expected count", () => {
    const p = parseAssembly(`add %r1 %r2
`);
    expect(p.instructions).toHaveLength(0);
    expect(p.diagnostics[0].code).toBe("MISSING_OPERAND");
    expect(p.diagnostics[0].message).toMatch(/Erwartet 3/);
  });

  it("reports too many operands", () => {
    const p = parseAssembly(`add %r1 %r2 %r3 %r4
`);
    expect(p.diagnostics.some((d) => d.code === "EXTRA_OPERAND")).toBe(true);
    expect(p.diagnostics.find((d) => d.code === "EXTRA_OPERAND")!.message).toContain("Zu viele Operanden");
  });

  it("reports invalid register and out-of-range register", () => {
    const p = parseAssembly(`ldi %q1 $5
ldi %r16 $5
`);
    expect(p.diagnostics.map((d) => d.code)).toContain("INVALID_REGISTER");
    expect(p.diagnostics.find((d) => d.message.includes("%r16"))?.message).toContain("maximal %r15");
  });

  it("reports invalid and out-of-range immediates", () => {
    const p = parseAssembly(`ldi %r1 $abc
ldi %r2 $999999
`);
    expect(p.diagnostics.map((d) => d.code)).toContain("INVALID_IMMEDIATE");
    expect(p.diagnostics.map((d) => d.code)).toContain("IMMEDIATE_RANGE");
  });

  it("populates line and column spans", () => {
    const p = parseAssembly(`nop
add %r1 %r2 %x3
`);
    const d = p.diagnostics.find((x) => x.code === "INVALID_REGISTER")!;
    expect(d.line).toBe(2);
    expect(d.columnStart).toBeGreaterThanOrEqual(1);
    expect(d.columnEnd).toBeGreaterThan(d.columnStart);
  });

  it("does not emit diagnostics on valid branch offsets", () => {
    const p = parseAssembly(`b $2
bnc $-2
`);
    expect(p.diagnostics).toEqual([]);
    expect(p.instructions).toHaveLength(2);
  });
});
