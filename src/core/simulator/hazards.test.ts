import { describe, it, expect } from "vitest";
import { statusMatrix, finalRegisters } from "../testutil";

describe("RAW hazards — forwarding off (default)", () => {
  it("direct RAW stalls the consumer two cycles; value correct (end-of-WB visibility)", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
hlt
`;
    const { matrix, result } = statusMatrix(src);
    const [i1, i2] = matrix;
    expect(i1).toEqual(["waiting", "IF", "ID", "OF", "EX", "WB", null, null, null, null]);
    // producer WB@5; consumer may perform OF only in cycle 6 -> two stalls (4,5)
    expect(i2).toEqual(["waiting", "waiting", "IF", "ID", "stall", "stall", "OF", "EX", "WB", null]);
    expect(result.statistics.stallCycles).toBe(2);
    // the RAW value is read correctly despite the stall
    expect(finalRegisters(result)[2]).toBe(5);
  });

  it("end-of-WB visibility: consumer reads the register in the cycle after the producer's WB", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
hlt
`;
    const { matrix, result } = statusMatrix(src);
    // producer I1 WB@5; consumer I2 performs OF@6 (the cycle after WB), so the read
    // comes from the register file that cycle
    expect(matrix[0]).toEqual(["waiting", "IF", "ID", "OF", "EX", "WB", null, null, null, null]);
    expect(matrix[1]).toEqual(["waiting", "waiting", "IF", "ID", "stall", "stall", "OF", "EX", "WB", null]);
    // confirm the read source is the register file, in cycle 6 (after producer WB@5)
    const add = result.dynamicInstructions[1];
    const read = result.snapshots
      .flatMap((s) => s.registerReads)
      .find((x) => x.kind === "read" && x.uid === add.uid && x.register === 1)!;
    const readCycle = result.snapshots.find((s) => s.registerReads.includes(read))!.cycle;
    expect(readCycle).toBe(6);
    expect(read.source).toBe("register-file");
  });
});

describe("RAW hazards — forwarding on", () => {
  it("adjacent RAW with forwarding: EX result is forwarded the cycle after production", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
hlt
`;
    const { matrix, result } = statusMatrix(src, { forwarding: { enabled: true } });
    const [, i2] = matrix;
    // producer ldi EX@4 computes %r1; no same-cycle EX->OF, so the consumer stalls@4
    // and enters OF@5, forwarding the value computed in cycle 4 (no extra WB wait)
    expect(i2).toEqual(["waiting", "waiting", "IF", "ID", "stall", "OF", "EX", "WB", null]);
    expect(result.statistics.stallCycles).toBe(1);
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

  it("a chain of dependent ALU ops is forwarded without waiting for WB (one structural stall per dependency)", () => {
    const src = `ldi %r1 $5
add %r2 %r1 %r3
sub %r4 %r2 %r5
hlt
`;
    const { matrix, result } = statusMatrix(src, { forwarding: { enabled: true } });
    // add: stall@4 (ldi EX@4), OF@5 forwarded; sub: stall@6 (add EX@6), OF@7 forwarded
    const add = matrix[1];
    const sub = matrix[2];
    expect(add[4]).toBe("stall");
    expect(add[5]).toBe("OF");
    expect(sub[4]).toBe("stall");
    expect(sub[6]).toBe("stall");
    expect(sub[7]).toBe("OF");
    // one structural same-cycle-EX stall per dependency, but no WB wait
    expect(result.statistics.stallCycles).toBe(2);
    expect(result.statistics.forwardingEvents).toBe(2);
    expect(finalRegisters(result)[2]).toBe(5);
    expect(finalRegisters(result)[4]).toBe(5);
  });
});

describe("RAW hazards — comparison forwarding on/off", () => {
  it("forwarding removes the WB waits that exist without it", () => {
    const src = `ldi %r1 $3
add %r2 %r1 %r1
hlt
`;
    const off = statusMatrix(src, { forwarding: { enabled: false } });
    const on = statusMatrix(src, { forwarding: { enabled: true } });
    // without forwarding: poll wait for WB (stall@4 and @5) -> 2 stalls
    expect(off.result.statistics.stallCycles).toBe(2);
    // with forwarding: only the structural same-cycle-EX stall remains (stall@4),
    // the WB wait disappears
    expect(on.result.statistics.stallCycles).toBe(1);
    expect(on.result.statistics.forwardingEvents).toBe(2);
    // same architectural result either way
    expect(finalRegisters(on.result)[2]).toBe(finalRegisters(off.result)[2]);
  });
});

describe("RAW hazards — distance and multiple sources", () => {
  it("distance-two dependency stalls one cycle (consumer OF in the cycle after producer WB)", () => {
    const src = `add %r1 %r6 %r7
nop
sub %r4 %r1 %r5
hlt
`;
    const { result } = statusMatrix(src);
    // sub@4: IF@3 ID@4 stall@5 OF@6 (producer add WB@5, so sub OF only @6) EX@7 WB@8
    expect(result.statistics.stallCycles).toBe(1);
    const sub = result.dynamicInstructions.find((d) => d.mnemonic === "sub")!;
    const stages = result.snapshots.map((s) => s.rows.find((r) => r.uid === sub.uid)?.status ?? "waiting");
    expect(stages[3]).toBe("IF");
    expect(stages[4]).toBe("ID");
    expect(stages[5]).toBe("stall");
    expect(stages[6]).toBe("OF");
    // even with an instruction between producer and consumer, the producer's value
    // is only available the cycle after its WB, so one stall remains
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
    // r1 and r2 must both be ready after their WB cycles; the consumer stalls two
    // cycles (5,6) and performs OF in cycle 7
    expect(result.statistics.stallCycles).toBe(2);
    // matrix index c equals cycle c; add: IF@3 ID@4 stall@5 stall@6 OF@7 EX@8 WB@9
    expect(i3[3]).toBe("IF");
    expect(i3[4]).toBe("ID");
    expect(i3[5]).toBe("stall");
    expect(i3[6]).toBe("stall");
    expect(i3[7]).toBe("OF");
    expect(i3[8]).toBe("EX");
    expect(i3[9]).toBe("WB");
  });

  it("multi-source RAW with forwarding: the latest producer is forwarded, one structural stall", () => {
    const src = `ldi %r1 $5
ldi %r2 $3
add %r3 %r1 %r2
hlt
`;
    // add wants OF@5: %r2 (from ldi2) is still in EX that cycle (no same-cycle
    // EX->OF), so it stalls@5 and enters OF@6, forwarding %r2; %r1 was already
    // written by ldi1 and is read from the register file.
    const { result } = statusMatrix(src, { forwarding: { enabled: true } });
    expect(result.statistics.stallCycles).toBe(1);
    expect(finalRegisters(result)[3]).toBe(8);
    expect(result.statistics.forwardingEvents).toBe(1);
    const fwd = result.snapshots.flatMap((s) => s.forwarding);
    expect(fwd).toHaveLength(1);
    expect(fwd[0].resource).toEqual({ type: "register", register: 2 });
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
    expect(stall.blockedStage).toBe("ID");
    expect(stall.detail.reason).toBe("RAW");
    expect(stall.detail.resource).toBe("%r1");
    const producer = result.dynamicInstructions.find((d) => d.uid === stall.detail.producerUid)!;
    expect(producer.mnemonic).toBe("ldi");
  });
});
