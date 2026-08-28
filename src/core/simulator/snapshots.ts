import type { FlagName, PipelineStage } from "../isa/types";

export type CellStatus =
  | PipelineStage
  | "stall"
  | "flush"
  | "waiting";

export interface RowView {
  uid: string;
  index: number;
  sourceLine: number;
  mnemonic: string;
  rawText: string;
  status: CellStatus | null;
}

export interface RegReadWrite {
  uid: string;
  instructionIndex: number;
  register: number;
  value: number;
  kind: "read" | "write";
  source?: "register-file" | "forwarded";
  forwardUid?: string;
  forwardStage?: "EX" | "WB";
}

export interface FlagAccess {
  uid: string;
  instructionIndex: number;
  flag: FlagName;
  value: boolean;
  kind: "read" | "write";
  source?: "register-file" | "forwarded";
}

export interface ForwardingEvent {
  cycle: number;
  producerUid: string;
  consumerUid: string;
  resource: { type: "register"; register: number } | { type: "flag"; flag: FlagName };
  value: number | boolean;
  fromStage: "EX" | "WB";
}

export interface AluSnapshot {
  uid: string;
  instructionIndex: number;
  mnemonic: string;
  operands: Array<{
    name: string;
    value: number;
    source: "register-file" | "forwarded";
    register: number;
    forwardUid?: string;
    forwardStage?: "EX" | "WB";
  }>;
  operation: string;
  result?: number;
  flags?: { Z: boolean; N: boolean; C: boolean };
}

export interface ExplanableEvent {
  type: "fetch" | "decode" | "operand-read" | "execute" | "writeback" | "stall" | "forwarding" | "branch" | "flush" | "halt" | "register-write" | "flag-write";
  cycle: number;
  uid: string;
  instructionIndex: number;
}

export interface StallDetail {
  reason: "RAW";
  resource: string;
  producerUid: string;
  producerStage: PipelineStage;
  neededAt: "OF";
  availableAt: PipelineStage;
}

export interface StallEvent extends ExplanableEvent {
  type: "stall";
  blockedStage: PipelineStage;
  detail: StallDetail;
}

export interface BranchDetail {
  mnemonic: string;
  flag?: { flag: FlagName; value: boolean };
  condition: string;
  taken: boolean;
  targetAddress: number;
}

export interface CpuView {
  pc: number;
  registers: number[];
  flags: { Z: boolean; N: boolean; C: boolean };
  halted: boolean;
}

export interface CycleSnapshot {
  cycle: number;
  cpuBefore: CpuView;
  cpuAfter: CpuView;
  memory: Array<[number, number]>;
  pipeline: Record<PipelineStage, RowView | null>;
  alu: AluSnapshot | null;
  registerReads: RegReadWrite[];
  registerWrites: RegReadWrite[];
  flagReads: FlagAccess[];
  flagWrites: FlagAccess[];
  forwarding: ForwardingEvent[];
  events: ExplanableEvent[];
  rows: RowView[];
  statisticsSoFar: Statistics;
}

export interface Statistics {
  totalCycles: number;
  fetchedInstructions: number;
  completedInstructions: number;
  flushedInstructions: number;
  stallCycles: number;
  flushCount: number;
  forwardingEvents: number;
  cpi: number | null;
}
