import { describe, it, expect } from "vitest";
import { statusMatrix, finalRegisters } from "../testutil";

describe("RAW hazards — forwarding off (default)", () => {
  it("direct RAW stalls the consumer one cycle; value correct", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
hlt
`;
    const { matrix, result } = statusMatrix(src);
    const [i1, i2] = matrix;
    expect(i1).toEqual(["waiting", "IF", "ID", "OF", "EX", "WB", null, null, null, null]);
    expect(i2).toEqual(["waiting", "waiting", "IF", "ID", "OF", "stall", "EX", "WB", null, null]);
    expect(result.statistics.stallCycles).toBe(1);
    // the RAW value is read correctly despite the stall
    expect(finalRegisters(result)[2]).toBe(5);
  });

  it("same-cycle WB→OF visibility: consumer reads register in the producer's WB cycle", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
hlt
`;
    const { matrix, result } = statusMatrix(src);
    // producer I1 WB; consumer I2 OF resolves in that same cycle (one `--` behind)
    expect(matrix[0]).toEqual(["waiting", "IF", "ID", "OF", "EX", "WB", null, null, null, null]);
    expect(matrix[1]).toEqual(["waiting", "waiting", "IF", "ID", "OF", "stall", "EX", "WB", null, null]);
    // confirm the read source is the register file (written same cycle, not forwarded)
    const add = result.dynamicInstructions[1];
    const read = result.snapshots
      .flatMap((s) => s.registerReads)
      .find((x) => x.kind === "read" && x.uid === add.uid && x.register === 1)!;
    expect(read.source).toBe("register-file");
  });
});

describe("RAW hazards — forwarding on", () => {
  it("adjacent RAW with forwarding has no stall and value is forwarded from EX", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
hlt
`;
    const { matrix, result } = statusMatrix(src, { forwarding: { enabled: true } });
    const [, i2] = matrix;
    expect(i2).toEqual(["waiting", "waiting", "IF", "ID", "OF", "EX", "WB", null, null]);
    expect(i2.includes("stall")).toBe(false);
    expect(result.statistics.forwardingEvents).toBe(1);
    expect(finalRegisters(result)[2]).toBe(5);
    // forwarding source identified: r1 forwarded from producer's EX
    const forwards = result.snapshots.flatMap((s) => s.forwarding);
    expect(forwards).toHaveLength(1);
    const real = forwards[0];
    expect(real.resource).toEqual({ type: "register", register: 1 });
    expect(real.value).toBe(5);
    const producer = result.dynamicInstructions.find((d) => d.uid === real.producerUid)!;
    expect(producer.mnemonic).toBe("ldi");
  });

  it("a chain of dependent ALU ops has zero stalls with forwarding", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
sub %r4 %r2 %r5
hlt
`;
    const { matrix, result } = statusMatrix(src, { forwarding: { enabled: true } });
    for (const row of matrix) expect(row.includes("stall")).toBe(false);
    expect(result.statistics.stallCycles).toBe(0);
    expect(result.statistics.forwardingEvents).toBe(2);
    expect(finalRegisters(result)[2]).toBe(5);
    expect(finalRegisters(result)[4]).toBe(5);
  });
});

describe("RAW hazards — comparison forwarding on/off", () => {
  it("forwarding removes stalls that exist without it", () => {
    const src = `ldi %r1 $3
add %r2 %r1 %r1
hlt
`;
    const off = statusMatrix(src, { forwarding: { enabled: false } });
    const on = statusMatrix(src, { forwarding: { enabled: true } });
    expect(off.result.statistics.stallCycles).toBeGreaterThan(0);
    expect(on.result.statistics.stallCycles).toBe(0);
    expect(on.result.statistics.forwardingEvents).toBeGreaterThan(0);
    // same architectural result either way
    expect(finalRegisters(on.result)[2]).toBe(finalRegisters(off.result)[2]);
  });
});

describe("RAW hazards — distance and multiple sources", () => {
  it("distance-two dependency needs no stall (consumer OF lands on producer WB)", () => {
    const src = `add %r1 %r6 %r7
nop
sub %r4 %r1 %r5
hlt
`;
    const { matrix, result } = statusMatrix(src);
    const sub = matrix.find((_, i) => i === 2)!;
    expect(result.statistics.stallCycles).toBe(0);
    // the extra instruction between producer and consumer delays the consumer's OF
    // until it coincides with the producer's WB, so no stall is required
    expect(sub.includes("stall")).toBe(false);
  });

  it("multiple source RAW registers stall until the latest producer writes back", () => {
    const src = `ldi %r1 $5
ldi %r2 $3
add %r3 %r1 %r2
hlt
`;
    const { matrix, result } = statusMatrix(src);
    const i3 = matrix[2];
    expect(finalRegisters(result)[3]).toBe(8);
    // r1 (producer 1) and r2 (producer 2) must both be ready; the consumer reads
    // them at the latest producer's WB cycle, so it stalls one cycle
    expect(result.statistics.stallCycles).toBe(1);
    // matrix index c equals cycle c; add: IF@3 ID@4 OF@5 stall@6 EX@7 WB@8
    expect(i3[3]).toBe("IF");
    expect(i3[4]).toBe("ID");
    expect(i3[5]).toBe("OF");
    expect(i3[6]).toBe("stall");
    expect(i3[7]).toBe("EX");
    expect(i3[8]).toBe("WB");
  });

  it("forwarding with multiple sources avoids stalls", () => {
    const src = `ldi %r1 $5
ldi %r2 $3
add %r3 %r1 %r2
hlt
`;
    const { result } = statusMatrix(src, { forwarding: { enabled: true } });
    expect(result.statistics.stallCycles).toBe(0);
    expect(finalRegisters(result)[3]).toBe(8);
    // r2 is still in EX when add's OF reads it, so it is forwarded; r1's WB already
    // wrote the register in the same cycle (same-cycle WB->OF), so it is read from
    // the register file rather than forwarded.
    expect(result.statistics.forwardingEvents).toBe(1);
  });
});

describe("RAW hazards — producer/consumer identity", () => {
  it("reports stalls with correct RAW resource and producer", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
hlt
`;
    const { result } = statusMatrix(src);
    const stall = result.snapshots
      .flatMap((s) => s.events)
      .find((e): e is import("./snapshots").StallEvent => e.type === "stall")!;
    expect(stall.blockedStage).toBe("OF");
    expect(stall.detail.reason).toBe("RAW");
    expect(stall.detail.resource).toBe("%r1");
    const producer = result.dynamicInstructions.find((d) => d.uid === stall.detail.producerUid)!;
    expect(producer.mnemonic).toBe("ldi");
  });
});
