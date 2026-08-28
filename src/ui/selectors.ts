import type { SimulationResult, AluSnapshot, RowView, ForwardingEvent, StallEvent } from "../core/index";
import type { ExplanableEvent } from "../core/simulator/snapshots";
import type { DynamicInstruction } from "../core/simulator/simulate";

export type CellStatus = NonNullable<RowView["status"]> | "waiting";

export interface PipelineRow {
  uid: string;
  ordinal: number;
  mnemonic: string;
  address: number;
  sourceLine: number;
  cells: CellStatus[];
}

export interface RegVM {
  index: number;
  value: number;
  read: boolean;
  written: boolean;
  forwarded: boolean;
  forwardedFrom?: number;
}

export interface FlagsVM {
  Z: boolean;
  N: boolean;
  C: boolean;
  changed: FlagName[];
}

type FlagName = "Z" | "N" | "C";

export interface StatsVM {
  fetched: string;
  completed: string;
  flushed: string;
  cpi: string;
  totalCycles: string;
  stallCycles: string;
  flushCount: string;
  forwardingEvents: string;
  termination: string;
}

function dynByUid(result: SimulationResult): Map<string, DynamicInstruction> {
  const m = new Map<string, DynamicInstruction>();
  result.dynamicInstructions.forEach((d) => m.set(d.uid, d));
  return m;
}

function ordinalFor(dyns: DynamicInstruction[], uid: string): number {
  return dyns.findIndex((d) => d.uid === uid) + 1;
}

export function instrName(result: SimulationResult, uid: string): string {
  return `Instruktion ${ordinalFor(result.dynamicInstructions, uid)}`;
}

export function pipelineRows(result: SimulationResult): PipelineRow[] {
  return result.dynamicInstructions.map((d) => ({
    uid: d.uid,
    ordinal: ordinalFor(result.dynamicInstructions, d.uid),
    mnemonic: d.mnemonic,
    address: d.address,
    sourceLine: d.sourceLine,
    cells: result.snapshots.map((s) => {
      const row = s.rows.find((r) => r.uid === d.uid);
      return row && row.status ? row.status : "waiting";
    }),
  }));
}

export function registersAt(result: SimulationResult, cycle: number): RegVM[] {
  const snap = result.snapshots[cycle];
  const reads = new Set(snap.registerReads.filter((r) => r.kind === "read").map((r) => r.register));
  const writes = new Set(snap.registerWrites.filter((r) => r.kind === "write").map((r) => r.register));
  const forwarded = new Map<number, number>();
  for (const f of snap.forwarding) {
    if (f.resource.type === "register") {
      forwarded.set(f.resource.register, ordinalFor(result.dynamicInstructions, f.producerUid));
    }
  }
  return snap.cpuAfter.registers.map((value, index) => ({
    index,
    value,
    read: reads.has(index),
    written: writes.has(index),
    forwarded: forwarded.has(index),
    forwardedFrom: forwarded.get(index),
  }));
}

export function flagsAt(result: SimulationResult, cycle: number): FlagsVM {
  const snap = result.snapshots[cycle];
  const changed = snap.flagWrites
    .filter((f) => f.value)
    .map((f) => f.flag as FlagName);
  return { ...snap.cpuAfter.flags, changed };
}

export function aluAt(result: SimulationResult, cycle: number): AluSnapshot | null {
  return result.snapshots[cycle].alu;
}

export function explanationsAt(result: SimulationResult, cycle: number): string[] {
  const snap = result.snapshots[cycle];
  const dyns = dynByUid(result);
  const out: string[] = [];
  for (const e of snap.events) out.push(explainEvent(result, dyns, cycle, e));
  for (const f of snap.forwarding) out.push(explainForwarding(result, f));
  return out;
}

function explainEvent(
  result: SimulationResult,
  dyns: Map<string, DynamicInstruction>,
  cycle: number,
  e: ExplanableEvent
): string {
  const name = instrName(result, e.uid);
  const dyn = dyns.get(e.uid);
  const snap = result.snapshots[cycle];
  switch (e.type) {
    case "fetch":
      return `${name} wird geholt (IF) aus Adresse ${dyn?.address ?? "?"}.`;
    case "decode":
      return `${name} wird dekodiert (ID).`;
    case "operand-read":
      return `${name} liest seine Operanden in der Stufe OF.`;
    case "execute":
      return `${name} führt seine Operation in der Stufe EX aus.`;
    case "writeback":
      return `${name} schreibt das Ergebnis zurück (WB).`;
    case "stall":
      return stallText(name, e as StallEvent);
    case "forwarding":
      return `${name} erhält einen Operanden per Forwarding.`;
    case "branch": {
      const bd = dyn?.branchDetail;
      if (bd?.taken) return `${name} (${bd.mnemonic}) wird genommen: Sprung zu Adresse ${bd.targetAddress}.`;
      return `${name} (${bd?.mnemonic ?? "?"}) wird nicht genommen, sequenzielle Ausführung.`;
    }
    case "flush":
      return `${name} liegt auf dem falschen Pfad und wird verworfen.`;
    case "halt":
      return `${name} (hlt) beendet die Ausführung.`;
    case "register-write": {
      const w = snap.registerWrites.find((x) => x.uid === e.uid && x.kind === "write");
      return w ? `${name} schreibt ${w.value} nach %r${w.register} (WB).` : `${name} schreibt ein Register (WB).`;
    }
    case "flag-write": {
      const w = snap.flagWrites.find((x) => x.uid === e.uid && x.kind === "write");
      return w ? `${name} setzt das Flag ${w.flag} auf ${w.value ? "1" : "0"}.` : `${name} setzt ein Flag.`;
    }
    default:
      return "";
  }
}

function stallText(name: string, e: StallEvent): string {
  const d = e.detail;
  if (d.reason === "RAW") {
    return `${name} benötigt in der Stufe ${d.neededAt} den Wert von ${d.resource}. Dieser wird erst in ${d.producerStage} von einer vorhergehenden Instruktion berechnet und ist auf dem normalen Pfad noch nicht verfügbar. Dadurch entsteht ein Pipeline-Stall.`;
  }
  return `${name} kann nicht weitertakten.`;
}

function explainForwarding(result: SimulationResult, f: ForwardingEvent): string {
  const producer = instrName(result, f.producerUid);
  const consumer = instrName(result, f.consumerUid);
  const resource =
    f.resource.type === "register" ? `%r${f.resource.register}` : `Flag ${f.resource.flag}`;
  return `${consumer} erhält den Wert von ${resource} direkt aus dem Ergebnis von ${producer} (Forwarding aus ${fromStageLabel(f.fromStage)}), statt auf die Writeback-Stufe zu warten.`;
}

function fromStageLabel(s: "EX" | "WB"): string {
  return s === "EX" ? "der EX-Stufe" : "der WB-Stufe";
}

export function statisticsView(result: SimulationResult): StatsVM {
  const s = result.statistics;
  return {
    fetched: `Geholte Instruktionen: ${s.fetchedInstructions}`,
    completed: `Ausgeführte (nützliche) Instruktionen: ${s.completedInstructions}`,
    flushed: `Verworfene Instruktionen: ${s.flushedInstructions}`,
    cpi: s.cpi === null ? "CPI: –" : `CPI: ${s.cpi.toFixed(2)}`,
    totalCycles: `Gesamte Takte: ${s.totalCycles}`,
    stallCycles: `Stall-Takte: ${s.stallCycles}`,
    flushCount: `Flush-Ereignisse: ${s.flushCount}`,
    forwardingEvents: `Forwarding-Ereignisse: ${s.forwardingEvents}`,
    termination: "Ausführung beendet",
  };
}

export function registerLabel(index: number): string {
  return `%r${index}`;
}

export interface MemoryCellVM {
  address: number;
  value: number;
  read: boolean;
  written: boolean;
  initialized: boolean;
}

export function memoryAt(result: SimulationResult, cycle: number): MemoryCellVM[] {
  const snap = result.snapshots[cycle];
  const prev = cycle > 0 ? result.snapshots[cycle - 1] : result.snapshots[0];
  const cur = new Map(snap.memory);
  const before = new Map(prev.memory);
  const init = new Map(result.snapshots[0].memory);

  const readAddrs = new Set<number>();
  const writeAddrs = new Set<number>();

  const loads = loadExecs(result, cycle);
  for (const { addr, word } of loads) {
    readAddrs.add(addr);
    if (word) readAddrs.add(toAddr(addr + 1));
  }
  for (const [a, v] of cur) {
    if (before.get(a) !== v) writeAddrs.add(a);
  }

  const addrs = new Set<number>([...cur.keys(), ...readAddrs, ...writeAddrs]);
  const cells: MemoryCellVM[] = [];
  for (const a of addrs) {
    cells.push({
      address: a,
      value: cur.get(a) ?? 0,
      read: readAddrs.has(a),
      written: writeAddrs.has(a),
      initialized: init.has(a),
    });
  }
  cells.sort((x, y) => x.address - y.address);
  return cells;
}

export function memoryExplanation(result: SimulationResult, cycle: number): string | null {
  const snap = result.snapshots[cycle];
  const cur = new Map(snap.memory);
  const loads = loadExecs(result, cycle);
  for (const { dyn, addr, word } of loads) {
    if (word) {
      const hi = cur.get(addr) ?? 0;
      const lo = cur.get(toAddr(addr + 1)) ?? 0;
      const value = ((hi << 8) | lo) & 0xffff;
      return `${dyn.mnemonic} liest ${hexByte(hi)} aus ${hexAddr(addr)} und ${hexByte(lo)} aus ${hexAddr(toAddr(addr + 1))} → ${hexAddr(value)}`;
    }
    return `${dyn.mnemonic} liest ${hexByte(cur.get(addr) ?? 0)} aus ${hexAddr(addr)}`;
  }
  return null;
}

function loadExecs(result: SimulationResult, cycle: number): Array<{ dyn: DynamicInstruction; addr: number; word: boolean }> {
  const snap = result.snapshots[cycle];
  const dyns = new Map(result.dynamicInstructions.map((d) => [d.uid, d]));
  const out: Array<{ dyn: DynamicInstruction; addr: number; word: boolean }> = [];
  for (const e of snap.events) {
    if (e.type !== "execute") continue;
    const dyn = dyns.get(e.uid);
    if (!dyn || (dyn.mnemonic !== "ldb" && dyn.mnemonic !== "ldw")) continue;
    out.push({ dyn, addr: toAddr(dyn.opValues?.[0] ?? 0), word: dyn.mnemonic === "ldw" });
  }
  return out;
}

function toAddr(v: number): number {
  return v & 0xffff;
}
function hexAddr(v: number): string {
  return `0x${(v & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
}
function hexByte(v: number): string {
  return `0x${(v & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;
}
