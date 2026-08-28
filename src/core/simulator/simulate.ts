import { DEFAULT_CONFIG, ProcessorConfig } from "../config";
import { INSTRUCTION_DEFS, evaluateBranch } from "../isa/instructionMeta";
import { toI16, toU16 } from "../isa/registers";
import type {
  FlagName,
  ParsedInstruction,
  ParsedProgram,
  PipelineStage,
} from "../isa/types";
import { alu, AluOperation } from "./alu";
import { MemoryState } from "./memory";
import type {
  AluSnapshot,
  BranchDetail,
  CellStatus,
  CpuView,
  CycleSnapshot,
  ExplanableEvent,
  FlagAccess,
  ForwardingEvent,
  RegReadWrite,
  RowView,
  StallEvent,
  Statistics,
} from "./snapshots";

export interface InitialCpuState {
  pc?: number;
  registers?: number[];
  flags?: { Z?: boolean; N?: boolean; C?: boolean };
  memory?: Map<number, number>;
}

export interface DynamicInstruction {
  uid: string;
  staticId: string;
  index: number;
  fetchSeq: number;
  address: number;
  sourceLine: number;
  mnemonic: string;
  operands: ParsedInstruction["operands"];
  status: "in-flight" | "completed" | "flushed" | "halted";
  fetchedAt: number;
  stage: PipelineStage | null;
  resultValue?: number;
  resultFlags?: { Z: boolean; N: boolean; C: boolean };
  opValues?: number[];
  opReady: boolean;
  branchDetail?: BranchDetail;
  memoryEffect?: Array<{ address: number; value: number; width: 1 | 2 }>;
  blockedSet: Set<number>;
}

export interface SimulationResult {
  program: ParsedProgram;
  config: ProcessorConfig;
  snapshots: CycleSnapshot[];
  dynamicInstructions: DynamicInstruction[];
  finalState: CpuView;
  statistics: Statistics;
  termination:
    | { type: "hlt"; cycle: number }
    | { type: "program-end"; cycle: number }
    | { type: "max-cycles"; cycle: number }
    | { type: "runtime-error"; cycle: number; message: string };
}

const STAGES: PipelineStage[] = ["IF", "ID", "OF", "EX", "WB"];
type Slots = Record<PipelineStage, DynamicInstruction | null>;

export function simulate(
  program: ParsedProgram,
  config: ProcessorConfig = DEFAULT_CONFIG,
  initialState?: InitialCpuState
): SimulationResult {
  return new Sim(config, program, initialState).run();
}

class Sim {
  config: ProcessorConfig;
  program: ParsedProgram;
  private pc = 0;
  private regs: Uint16Array;
  private archF: { Z: boolean; N: boolean; C: boolean };
  private postExF: { Z: boolean; N: boolean; C: boolean };
  private memory: MemoryState;
  private halted = false;

  private dyns: DynamicInstruction[] = [];
  private uidCounter = 0;
  private slots: Slots = { IF: null, ID: null, OF: null, EX: null, WB: null };
  private pendingReg: Map<number, DynamicInstruction> = new Map();

  private snapshots: CycleSnapshot[] = [];
  private forwarding: boolean;
  private maxCycles: number;

  private completed = 0;
  private flushedCount = 0;
  private stallCycles = 0;
  private flushEvents = 0;
  private forwardingEvents = 0;
  private lastUsefulCycle = 0;

  private reads: RegReadWrite[] = [];
  private writes: RegReadWrite[] = [];
  private flagReads: FlagAccess[] = [];
  private flagWrites: FlagAccess[] = [];
  private forwards: ForwardingEvent[] = [];

  constructor(config: ProcessorConfig, program: ParsedProgram, init?: InitialCpuState) {
    this.config = config;
    this.program = program;
    this.forwarding = config.forwarding.enabled;
    this.maxCycles = config.maxCycles;
    this.regs = new Uint16Array(config.registerCount);
    if (init?.registers) for (let i = 0; i < this.regs.length; i++) this.regs[i] = toU16(init.registers[i] ?? 0);
    this.archF = { Z: init?.flags?.Z ?? false, N: init?.flags?.N ?? false, C: init?.flags?.C ?? false };
    this.postExF = { ...this.archF };
    this.memory = new MemoryState(init?.memory);
    this.pc = toU16(init?.pc ?? 0);
  }

  private parsed(d: DynamicInstruction): ParsedInstruction {
    return {
      id: d.staticId,
      index: d.index,
      sourceLine: d.sourceLine,
      address: d.address,
      rawText: d.mnemonic,
      mnemonic: d.mnemonic as ParsedInstruction["mnemonic"],
      operands: d.operands,
      definition: INSTRUCTION_DEFS[d.mnemonic as keyof typeof INSTRUCTION_DEFS],
    };
  }

  private instructionAt(addr: number): ParsedInstruction | null {
    return this.program.instructions.find((i) => i.address === toU16(addr)) ?? null;
  }

  private cpuView(): CpuView {
    return { pc: this.pc, registers: Array.from(this.regs), flags: { ...this.archF }, halted: this.halted };
  }

  private stats(cycle: number): Statistics {
    return {
      totalCycles: cycle,
      fetchedInstructions: this.dyns.length,
      completedInstructions: this.completed,
      flushedInstructions: this.flushedCount,
      stallCycles: this.stallCycles,
      flushCount: this.flushEvents,
      forwardingEvents: this.forwardingEvents,
      cpi: this.lastUsefulCycle > 0 && this.completed > 0 ? this.lastUsefulCycle / this.completed : null,
    };
  }

  run(): SimulationResult {
    this.pushSnapshot(0, this.cpuView(), []);
    let cycle = 1;
    let term: SimulationResult["termination"] | null = null;
    for (;;) {
      const before = this.cpuView();
      const events: ExplanableEvent[] = [];
      this.step(cycle, events);
      this.pushSnapshot(cycle, before, events);
      term = this.termination(cycle);
      if (term) break;
      if (cycle >= this.maxCycles) { term = { type: "max-cycles", cycle }; break; }
      cycle++;
    }
    return {
      program: this.program,
      config: this.config,
      snapshots: this.snapshots,
      dynamicInstructions: this.dyns,
      finalState: this.cpuView(),
      statistics: this.stats(cycle),
      termination: term!,
    };
  }

  private termination(cycle: number): SimulationResult["termination"] | null {
    if (this.halted) {
      const residue =
        this.dyns.some((d) => d.status === "in-flight" && d.mnemonic !== "hlt") ||
        STAGES.some((st) => { const d = this.slots[st]; return !!d && d.status === "in-flight" && d.mnemonic !== "hlt"; });
      if (!residue) return { type: "hlt", cycle };
      return null;
    }
    if (!this.dyns.some((d) => d.status === "in-flight") && this.instructionAt(this.pc) === null) {
      return { type: "program-end", cycle };
    }
    return null;
  }

  private step(cycle: number, events: ExplanableEvent[]) {
    const cur = this.slots;
    const next: Slots = { IF: null, ID: null, OF: null, EX: null, WB: null };
    let anyStall = false;

    // The instruction in OF resolved its operands last cycle and is ready to advance
    // to EX. (The OF-entry gate guarantees an instruction only enters OF once its
    // operands are available, so it is always ready here; `ofStuck` is defensive.)
    const exInstr = cur.OF && cur.OF.status === "in-flight" && cur.OF.opReady ? cur.OF : null;
    const ofStuck = cur.OF && cur.OF.status === "in-flight" && !cur.OF.opReady ? cur.OF : null;

    // ---- WB commit FIRST: memory/register writes become visible before any
    //      younger EX/OF instruction reads them in this same cycle ----
    if (cur.EX && cur.EX.status === "in-flight") this.commit(cur.EX, cycle, events);

    // ---- EX work happens at the cycle the instruction is displayed in EX ----
    if (exInstr && exInstr.status === "in-flight") this.executeEx(exInstr, cycle, events);

    // ---- advance EX -> WB, OF -> EX ----
    if (cur.EX && cur.EX.status === "in-flight") { next.WB = cur.EX; cur.EX.stage = "WB"; }
    if (exInstr && exInstr.status === "in-flight") { next.EX = exInstr; exInstr.stage = "EX"; }

    // ---- branch control hazard (EX@cycle) ----
    let branchTaken = false;
    if (exInstr && exInstr.status === "in-flight" && exInstr.branchDetail && exInstr.branchDetail.taken) {
      this.flushYounger(exInstr);
      this.pc = toU16(exInstr.branchDetail.targetAddress);
      branchTaken = true;
    }

    // ---- OF entry gating: cur.ID may enter OF only if all operands are available
    //      at this cycle; otherwise it is held at ID (stall) with backpressure. ----
    const idIn = cur.ID && cur.ID.status === "in-flight" && !branchTaken ? cur.ID : null;
    let idHeld = false;
    if (idIn && !ofStuck) {
      if (this.canEnterOf(cycle, events)) {
        next.OF = idIn;
        idIn.stage = "OF";
      } else {
        idHeld = true;
        anyStall = true;
      }
    } else if (ofStuck) {
      next.OF = ofStuck;
      ofStuck.stage = "OF";
      anyStall = true;
    }

    // ---- ID / IF advance + fetch with backpressure ----
    if (branchTaken) {
      // wrong-path instructions already flushed; fetch from the target next cycle
      next.IF = null;
    } else if (idHeld || ofStuck) {
      if (idIn) { next.ID = idIn; idIn.stage = "ID"; idIn.blockedSet.add(cycle); }
      if (cur.IF && cur.IF.status === "in-flight") {
        next.IF = cur.IF;
        cur.IF.stage = "IF";
        cur.IF.blockedSet.add(cycle);
      }
    } else {
      if (cur.IF && cur.IF.status === "in-flight") { next.ID = cur.IF; cur.IF.stage = "ID"; }
      const f = this.doFetch(cycle, events);
      if (f) { next.IF = f; f.stage = "IF"; }
    }

    // ---- OF operand resolution on the just-advanced (displayed) occupancy ----
    this.slots = next;
    if (next.OF && next.OF.status === "in-flight") {
      const r = this.resolveOperands(next.OF, cycle, events);
      if (r === "blocked") {
        anyStall = true;
        next.OF.opReady = false;
        next.OF.blockedSet.add(cycle);
      } else {
        next.OF.opReady = true;
        next.OF.opValues = r;
      }
    }
    if (next.WB) this.finishWriteback(next.WB, cycle);
    if (anyStall) this.stallCycles++;
  }

  // Decides whether the instruction in ID may enter OF this cycle (RAW check done
  // BEFORE entering OF). An instruction that is not ready stays upstream in ID.
  private canEnterOf(cycle: number, events: ExplanableEvent[]): boolean {
    const id = this.slots.ID;
    if (!id || id.status !== "in-flight") return true;
    const parsed = this.parsed(id);
    for (const ref of parsed.definition.readsRegisters(parsed)) {
      const producer = this.pendingReg.get(ref.register);
      if (!producer || producer === id || producer.status !== "in-flight") continue;
      // With sameCycleWbToOfVisible=false a register written in WB only becomes
      // available AFTER that WB cycle completes, so an OF consumer cannot read a
      // producer that is still resolving in the pipeline.
      //
      // Forwarding timing: an EX result produced in cycle N becomes forwardable
      // only in cycle N+1 (never same-cycle EX->OF, and WB->OF is also not
      // same-cycle). A producer currently sitting in cur.OF executes EX in THIS
      // cycle, so its result is not forwardable yet -> the consumer stalls. A
      // producer already in cur.EX computed its result LAST cycle and is therefore
      // forwardable now, without waiting for WB/register-file.
      const avail =
        this.slots.EX === producer && this.forwarding && producer.resultValue !== undefined;
      if (!avail) {
        events.push({
          type: "stall",
          cycle,
          uid: id.uid,
          instructionIndex: id.index,
          blockedStage: "ID",
          detail: {
            reason: "RAW",
            resource: `%r${ref.register}`,
            producerUid: producer.uid,
            producerStage: "EX",
            neededAt: "OF",
            availableAt: this.forwarding ? "EX (forwarding, next cycle)" : "WB",
          },
        } as StallEvent);
        return false;
      }
    }
    return true;
  }

  private doFetch(cycle: number, events: ExplanableEvent[]): DynamicInstruction | null {
    const instr = this.instructionAt(this.pc);
    if (!instr || this.halted) return null;
    const d: DynamicInstruction = {
      uid: `dyn-${this.uidCounter++}`,
      staticId: instr.id,
      index: instr.index,
      fetchSeq: this.uidCounter,
      address: instr.address,
      sourceLine: instr.sourceLine,
      mnemonic: instr.mnemonic,
      operands: instr.operands,
      status: "in-flight",
      fetchedAt: cycle,
      stage: "IF",
      opReady: false,
      blockedSet: new Set(),
    };
    this.dyns.push(d);
    events.push({ type: "fetch", cycle, uid: d.uid, instructionIndex: d.index });
    this.pc = toU16(d.address + 2);
    return d;
  }

  private flushYounger(branch: DynamicInstruction) {
    for (const d of this.dyns) {
      if (d.status === "in-flight" && d.fetchSeq > branch.fetchSeq && d !== branch) {
        d.status = "flushed";
        this.flushedCount++;
        for (const st of STAGES) if (this.slots[st] === d) this.slots[st] = null;
        for (const [k, v] of this.pendingReg) if (v === d) this.pendingReg.delete(k);
      }
    }
    this.flushEvents++;
  }

  private resolveOperands(d: DynamicInstruction, cycle: number, events: ExplanableEvent[]): number[] | "blocked" {
    const def = this.parsed(d).definition;
    const reads = def.readsRegisters(this.parsed(d));
    const values: number[] = [];
    for (const ref of reads) {
      const avail = this.regAvailable(ref.register, d, cycle, events);
      if (avail.kind === "blocked") return "blocked";
      values.push(avail.value);
      this.reads.push({
        uid: d.uid,
        instructionIndex: d.index,
        register: ref.register,
        value: avail.value,
        kind: "read",
        source: avail.kind === "forwarded" ? "forwarded" : "register-file",
        forwardUid: avail.kind === "forwarded" ? avail.fromUid : undefined,
        forwardStage: avail.kind === "forwarded" ? avail.fromStage : undefined,
      });
      if (avail.kind === "forwarded") {
        this.forwards.push({
          cycle,
          producerUid: avail.fromUid!,
          consumerUid: d.uid,
          resource: { type: "register", register: ref.register },
          value: avail.value,
          fromStage: avail.fromStage!,
        });
        this.forwardingEvents++;
        events.push({ type: "forwarding", cycle, uid: d.uid, instructionIndex: d.index });
      } else {
        events.push({ type: "operand-read", cycle, uid: d.uid, instructionIndex: d.index });
      }
    }
    return values;
  }

  private regAvailable(
    reg: number,
    consumer: DynamicInstruction,
    cycle: number,
    events: ExplanableEvent[]
  ):
    | { kind: "register-file"; value: number }
    | { kind: "forwarded"; value: number; fromUid: string; fromStage: "EX" | "WB" }
    | { kind: "blocked" } {
    const producer = this.pendingReg.get(reg);
    if (!producer || producer === consumer || producer.status !== "in-flight") {
      return { kind: "register-file", value: this.regs[reg] };
    }
    const pStage = this.stageOf(producer) ?? "EX";
    if (this.forwarding && producer.resultValue !== undefined && pStage !== "OF") {
      return {
        kind: "forwarded",
        value: producer.resultValue!,
        fromUid: producer.uid,
        fromStage: pStage === "WB" ? "WB" : "EX",
      };
    }
    events.push({
      type: "stall",
      cycle,
      uid: consumer.uid,
      instructionIndex: consumer.index,
      blockedStage: "OF",
      detail: {
        reason: "RAW",
        resource: `%r${reg}`,
        producerUid: producer.uid,
        producerStage: pStage,
        neededAt: "OF",
        availableAt: "WB",
      },
    } as StallEvent);
    return { kind: "blocked" };
  }

  private stageOf(d: DynamicInstruction): PipelineStage | null {
    for (const st of STAGES) if (this.slots[st] === d) return st;
    return null;
  }

  private executeEx(d: DynamicInstruction, cycle: number, events: ExplanableEvent[]) {
    const parsed = this.parsed(d);
    const def = parsed.definition;
    const opVals = d.opValues ?? [];
    if (def.isBranch) {
      const flagName: FlagName | null = def.branchFlag;
      let flagVal: boolean | undefined;
      if (flagName) {
        flagVal = this.postExF[flagName];
        this.flagReads.push({ uid: d.uid, instructionIndex: d.index, flag: flagName, value: flagVal, kind: "read" });
      }
      const taken = evaluateBranch(parsed.mnemonic, this.postExF);
      const imm = d.operands[0]?.type === "immediate" ? d.operands[0].value : 0;
      d.branchDetail = {
        mnemonic: d.mnemonic,
        flag: flagName && flagVal !== undefined ? { flag: flagName, value: flagVal } : undefined,
        condition: d.mnemonic.toUpperCase(),
        taken,
        targetAddress: toU16(d.address + 2 + 2 * toI16(imm)),
      };
      events.push({ type: "execute", cycle, uid: d.uid, instructionIndex: d.index });
      return;
    }
    if (def.isMemoryRead) {
      const addr = toU16(opVals[0] ?? 0);
      const word = d.mnemonic === "ldw";
      d.resultValue = word ? this.memory.readWord(addr) : this.memory.readByte(addr);
      events.push({ type: "execute", cycle, uid: d.uid, instructionIndex: d.index });
      return;
    }
    if (def.isMemoryWrite) {
      const addr = toU16(opVals[0] ?? 0);
      const data = toU16(opVals[1] ?? 0);
      d.memoryEffect = [{ address: addr, value: toU16(data), width: d.mnemonic === "stw" ? 2 : 1 }];
      events.push({ type: "execute", cycle, uid: d.uid, instructionIndex: d.index });
      return;
    }
    if (d.mnemonic === "ldi") {
      const imm = d.operands[1]?.type === "immediate" ? d.operands[1].value : 0;
      d.resultValue = toU16(imm);
      events.push({ type: "execute", cycle, uid: d.uid, instructionIndex: d.index });
      this.registerProducer(d);
      return;
    }
    if (d.mnemonic === "mov") {
      d.resultValue = toU16(opVals[0] ?? 0);
      events.push({ type: "execute", cycle, uid: d.uid, instructionIndex: d.index });
      this.registerProducer(d);
      return;
    }
    if (d.mnemonic === "hlt" || d.mnemonic === "nop") {
      events.push({ type: "execute", cycle, uid: d.uid, instructionIndex: d.index });
      return;
    }
    const op = this.aluOp(d.mnemonic);
    if (op) {
      const r = alu(op, opVals[0] ?? 0, opVals[1] ?? 0, this.postExF.C);
      d.resultValue = r.result;
      d.resultFlags = r.flags;
      this.postExF = { ...r.flags };
      events.push({ type: "execute", cycle, uid: d.uid, instructionIndex: d.index });
      this.registerProducer(d);
      return;
    }
    // ldb/ldw handled above; others fall through
  }

  private registerProducer(d: DynamicInstruction) {
    const wr = this.parsed(d).definition.writesRegister(this.parsed(d));
    if (wr !== null) {
      this.pendingReg.set(wr.register, d);
    }
  }

  private aluOp(m: string): AluOperation | undefined {
    const map: Record<string, AluOperation> = {
      add: "ADD", addc: "ADDC", sub: "SUB", subc: "SUBC", and: "AND", or: "OR",
      xor: "XOR", not: "NOT", shl: "SHL", shr: "SHR", rol: "ROL",
      ror: "ROR", rolc: "ROLC", rorc: "RORC",
    };
    return map[m];
  }

  // Release a producer from pending during its WB commit (see commit). This makes
  // the written value visible to an OF consumer in the same cycle.
  private removeFromPending(d: DynamicInstruction) {
    const wr = this.parsed(d).definition.writesRegister(this.parsed(d));
    if (wr !== null && this.pendingReg.get(wr.register) === d) {
      this.pendingReg.delete(wr.register);
    }
  }

  private commit(d: DynamicInstruction, cycle: number, events: ExplanableEvent[]) {
    const def = this.parsed(d).definition;
    const wr = def.writesRegister(this.parsed(d));
    if (wr !== null && d.resultValue !== undefined) {
      this.regs[wr.register] = toU16(d.resultValue);
      this.writes.push({ uid: d.uid, instructionIndex: d.index, register: wr.register, value: toU16(d.resultValue), kind: "write" });
      events.push({ type: "writeback", cycle, uid: d.uid, instructionIndex: d.index });
      // End-of-WB visibility (sameCycleWbToOfVisible=false): the register is written
      // to the architectural file during this WB cycle, but its pending entry is only
      // released AFTER the WB cycle completes, so a same-cycle OF consumer is still
      // blocked on the RAW hazard (see finishWriteback). An OF consumer may read the
      // value only starting the cycle after the producer's WB cycle.
    }
    if (d.resultFlags) {
      for (const f of ["Z", "N", "C"] as FlagName[]) {
        this.archF[f] = d.resultFlags[f];
        this.flagWrites.push({ uid: d.uid, instructionIndex: d.index, flag: f, value: d.resultFlags[f], kind: "write" });
      }
      events.push({ type: "flag-write", cycle, uid: d.uid, instructionIndex: d.index });
    }
    if (d.memoryEffect) {
      for (const m of d.memoryEffect) {
        if (m.width === 2) this.memory.writeWord(m.address, m.value);
        else this.memory.writeByte(m.address, m.value);
      }
    }
    if (d.mnemonic === "hlt") {
      this.halted = true;
      this.discardYounger(d);
      events.push({ type: "halt", cycle, uid: d.uid, instructionIndex: d.index });
    }
  }

  // Spec §20: after hlt commits, younger in-flight instructions are not allowed
  // to retire. Mark them discarded (they must not write architectural state).
  private discardYounger(hlt: DynamicInstruction) {
    for (const y of this.dyns) {
      if (y.status === "in-flight" && y.fetchSeq > hlt.fetchSeq && y !== hlt) {
        y.status = "flushed";
        this.flushedCount++;
        for (const st of STAGES) if (this.slots[st] === y) this.slots[st] = null;
        for (const [k, v] of this.pendingReg) if (v === y) this.pendingReg.delete(k);
      }
    }
  }

  // Called at the end of the WB cycle (after OF resolution) to finalize counts.
  // The producer's pending register entry is released only here, i.e. only AFTER
  // its WB cycle has completed, so an OF consumer in the same WB cycle remains
  // blocked on the RAW hazard (sameCycleWbToOfVisible=false).
  private finishWriteback(d: DynamicInstruction, cycle: number) {
    this.removeFromPending(d);
    if (d.mnemonic === "hlt") {
      d.status = "halted";
    } else {
      d.status = "completed";
      this.completed++;
      this.lastUsefulCycle = cycle;
    }
  }

  private pushSnapshot(cycle: number, before: CpuView, events: ExplanableEvent[]) {
    const pipeline = {} as Record<PipelineStage, RowView | null>;
    for (const st of STAGES) {
      const d = this.slots[st];
      pipeline[st] = d
        ? { uid: d.uid, index: d.index, sourceLine: d.sourceLine, mnemonic: d.mnemonic, rawText: d.mnemonic, status: st }
        : null;
    }
    let alu: AluSnapshot | null = null;
    const ex = this.slots.EX;
    if (ex) {
      const op = this.aluOp(ex.mnemonic);
      alu = {
        uid: ex.uid,
        instructionIndex: ex.index,
        mnemonic: ex.mnemonic,
        operands: (ex.opValues ?? []).map((v, i) => {
          const o = ex.operands[i];
          return {
            name: o && o.type === "register" ? `%r${o.register}` : "$",
            value: v,
            source: "register-file" as const,
            register: o && o.type === "register" ? o.register : -1,
          };
        }),
        operation: op ?? ex.mnemonic.toUpperCase(),
        result: ex.resultValue,
        flags: ex.resultFlags,
      };
    }
    const stalledUids = new Set(
      events.filter((e) => e.type === "stall").map((e) => e.uid)
    );
    const rows: RowView[] = this.snapshots.length
      ? this.dyns.map((d) => ({
          uid: d.uid,
          index: d.index,
          sourceLine: d.sourceLine,
          mnemonic: d.mnemonic,
          rawText: d.mnemonic,
          status: stalledUids.has(d.uid) ? "stall" : this.rowStatus(d, cycle),
        }))
      : [];
    this.snapshots.push({
      cycle,
      cpuBefore: before,
      cpuAfter: this.cpuView(),
      memory: this.memory.entries(),
      pipeline,
      alu,
      registerReads: this.reads,
      registerWrites: this.writes,
      flagReads: this.flagReads,
      flagWrites: this.flagWrites,
      forwarding: this.forwards,
      events,
      rows,
      statisticsSoFar: this.stats(cycle),
    });
    this.reads = [];
    this.writes = [];
    this.flagReads = [];
    this.flagWrites = [];
    this.forwards = [];
  }

  private rowStatus(d: DynamicInstruction, cycle: number): CellStatus | null {
    for (const st of STAGES) if (this.slots[st] === d) {
      return d.blockedSet.has(cycle) ? "stall" : st;
    }
    if (d.status === "flushed") return "flush";
    if (d.status === "in-flight") return "waiting";
    return null;
  }
}
