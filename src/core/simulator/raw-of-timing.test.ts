import { describe, it, expect } from "vitest";
import { statusMatrix } from "../testutil";

// Regression test for end-of-WB register visibility (sameCycleWbToOfVisible=false).
// A register written by an instruction in WB becomes available to younger
// instructions only AFTER that WB cycle completes. Without forwarding, a consumer
// may enter/perform OF only in the cycle after the producer's WB cycle.
//
//   ldi %r1, $1
//   add %r2, %r1, %r3
//   hlt
//
// Expected (forwarding OFF):
//   cycle    1  2  3  4  5  6  7  8  9
//   ldi      IF ID OF EX WB
//   add         IF ID  -  - OF EX WB
//   hlt            IF  -  - ID OF EX WB
const SRC = `ldi %r1, $1
add %r2, %r1, %r3
hlt
`;

describe("RAW end-of-WB visibility (no forwarding)", () => {
  it("add: IF@2 ID@3 stall@4 stall@5 OF@6 EX@7 WB@8; hlt held during cycles 4 and 5", () => {
    const { matrix, result } = statusMatrix(SRC, { forwarding: { enabled: false } });
    const [ldi, add, hlt] = matrix;

    // producer: IF@1 ID@2 OF@3 EX@4 WB@5
    expect(ldi).toEqual(["waiting", "IF", "ID", "OF", "EX", "WB", null, null, null, null]);
    // consumer: two stalls (4 and 5), OF only in cycle after producer WB (6)
    expect(add[2]).toBe("IF");
    expect(add[3]).toBe("ID");
    expect(add[4]).toBe("stall");
    expect(add[5]).toBe("stall");
    expect(add[6]).toBe("OF");
    expect(add[7]).toBe("EX");
    expect(add[8]).toBe("WB");
    // hlt is held by backpressure during cycles 4 and 5
    expect(hlt[3]).toBe("IF");
    expect(hlt[4]).toBe("stall");
    expect(hlt[5]).toBe("stall");
    expect(hlt[6]).toBe("ID");
    expect(result.statistics.stallCycles).toBe(2);
  });

  it("producer WB is cycle 5; %r1 read from register file in cycle 6, not in 4 or 5", () => {
    const { result } = statusMatrix(SRC, { forwarding: { enabled: false } });

    // producer's WB cycle is 5
    const ldi = result.dynamicInstructions.find((d) => d.mnemonic === "ldi")!;
    const producerWBCycle = result.snapshots.find((s) => s.pipeline.WB?.uid === ldi.uid)?.cycle;
    expect(producerWBCycle).toBe(5);

    const add = result.dynamicInstructions.find((d) => d.mnemonic === "add")!;
    const reads = result.snapshots.flatMap((s) =>
      s.registerReads
        .filter((rd) => rd.uid === add.uid && rd.register === 1)
        .map((rd) => ({ cycle: s.cycle, source: rd.source, value: rd.value }))
    );
    // exactly one read of %r1, in cycle 6 (the cycle after producer WB), from the register file
    expect(reads).toEqual([{ cycle: 6, source: "register-file", value: 1 }]);

    // no register read of %r1 in cycles 4 or 5
    for (const c of [4, 5]) {
      const readsInC = result.snapshots
        .find((s) => s.cycle === c)!
        .registerReads.filter((rd) => rd.register === 1 && rd.kind === "read");
      expect(readsInC).toHaveLength(0);
    }

    expect(result.finalState.registers[2]).toBe(1);
  });
});

describe("RAW end-of-WB visibility (with forwarding)", () => {
  it("adjacent RAW forwards the EX result the cycle after the producer's EX", () => {
    const { matrix, result } = statusMatrix(SRC, { forwarding: { enabled: true } });
    // producer ldi: IF@1 EX@4 (computes %r1). The consumer may not read %r1 in the
    // same cycle the producer executes EX (no same-cycle EX->OF), so it stalls@4
    // and enters OF@5, forwarding the result computed in cycle 4.
    const add = matrix[1];
    expect(add[2]).toBe("IF");
    expect(add[3]).toBe("ID");
    expect(add[4]).toBe("stall");
    expect(add[5]).toBe("OF"); // EX result computed@4, forwarded now
    expect(add[6]).toBe("EX");
    expect(add[7]).toBe("WB");
    // one structural stall (the same-cycle EX->OF), but no extra WB wait
    expect(result.statistics.stallCycles).toBe(1);

    const reads = result.snapshots.flatMap((s) =>
      s.registerReads
        .filter((rd) => s.cycle === 5 && rd.register === 1 && rd.kind === "read")
        .map((rd) => ({ cycle: s.cycle, source: rd.source, value: rd.value }))
    );
    expect(reads).toEqual([{ cycle: 5, source: "forwarded", value: 1 }]);
    expect(result.finalState.registers[2]).toBe(1);
  });
});

// Dependency chain I1 -> I2 -> I3 on %r1 / %r2:
//   ldi %r1, $5
//   add %r2, %r1, %r1
//   add %r3, %r2, %r1
//   hlt
// Focus: the I2 -> I3 dependency. I2 computes %r2 in EX; that result is only
// forwardable in the NEXT cycle, so I3 must not consume %r2 during I2's EX cycle.
const CHAIN = `ldi %r1, $5
add %r2, %r1, %r1
add %r3, %r2, %r1
hlt
`;

describe("dependency chain I2 -> I3 (forwarding timing)", () => {
  it("OFF: I3 waits for I2's WB write-back, then reads %r2 from the register file", () => {
    const { result } = statusMatrix(CHAIN, { forwarding: { enabled: false } });
    const i2 = result.dynamicInstructions.find((d) => d.mnemonic === "add" && d.index === 1)!;
    const i3 = result.dynamicInstructions.find((d) => d.mnemonic === "add" && d.index === 2)!;
    const stageOf = (uid: string, c: number) =>
      result.snapshots.find((s) => s.cycle === c)!.rows.find((r) => r.uid === uid)?.status;

    // I2 WB@8 (register result of %r2 is written there); I3 OF only at cycle 9
    expect(stageOf(i2.uid, 8)).toBe("WB");
    expect(stageOf(i3.uid, 8)).toBe("stall");
    expect(stageOf(i3.uid, 9)).toBe("OF");

    const reads = result.snapshots.flatMap((s) =>
      s.registerReads
        .filter((rd) => rd.uid === i3.uid && rd.register === 2 && rd.kind === "read")
        .map((rd) => ({ cycle: s.cycle, source: rd.source, value: rd.value }))
    );
    expect(reads).toEqual([{ cycle: 9, source: "register-file", value: 10 }]);
    expect(result.finalState.registers[3]).toBe(15);
  });

  it("ON: I3 cannot consume %r2 during I2's EX cycle; it forwards it the next cycle", () => {
    const { result } = statusMatrix(CHAIN, { forwarding: { enabled: true } });
    const i2 = result.dynamicInstructions.find((d) => d.mnemonic === "add" && d.index === 1)!;
    const i3 = result.dynamicInstructions.find((d) => d.mnemonic === "add" && d.index === 2)!;
    const stageOf = (uid: string, c: number) =>
      result.snapshots.find((s) => s.cycle === c)!.rows.find((r) => r.uid === uid)?.status;

    // I2 EX@6; I3 is stalled that cycle (must not consume %r2 same-cycle)
    expect(stageOf(i2.uid, 6)).toBe("EX");
    expect(stageOf(i3.uid, 6)).toBe("stall");
    // I3 consumes %r2 in OF in the following cycle 7, without waiting for I2 WB
    expect(stageOf(i2.uid, 7)).toBe("WB");
    expect(stageOf(i3.uid, 7)).toBe("OF");

    // I3 reads %r2 only once, in cycle 7, reported as forwarding (value 10)
    const reads = result.snapshots.flatMap((s) =>
      s.registerReads
        .filter((rd) => rd.uid === i3.uid && rd.register === 2 && rd.kind === "read")
        .map((rd) => ({ cycle: s.cycle, source: rd.source, value: rd.value }))
    );
    expect(reads).toEqual([{ cycle: 7, source: "forwarded", value: 10 }]);
    // no %r2 read by I3 during I2's EX cycle
    const readsC6 = result.snapshots
      .find((s) => s.cycle === 6)!
      .registerReads.filter((rd) => rd.uid === i3.uid && rd.register === 2 && rd.kind === "read");
    expect(readsC6).toHaveLength(0);

    // the forwarding event records the producer/consumer pairing
    const fwd = result.snapshots
      .find((s) => s.cycle === 7)!
      .forwarding.find((f) => f.consumerUid === i3.uid);
    expect(fwd?.producerUid).toBe(i2.uid);
    expect(fwd?.resource).toEqual({ type: "register", register: 2 });
    expect(result.finalState.registers[3]).toBe(15);
  });
});
