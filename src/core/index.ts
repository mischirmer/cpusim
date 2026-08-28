export { parseAssembly } from "./parser/parser";
export { parseNumber, formatImmediate } from "./parser/numbers";
export { INSTRUCTION_DEFS, isMnemonic, evaluateBranch } from "./isa/instructionMeta";
export type { InstructionDefinition } from "./isa/types";
export { alu, branchTaken } from "./simulator/alu";
export type { AluOperation, AluResult, AluFlags } from "./simulator/alu";
export { MemoryState } from "./simulator/memory";
export { simulate } from "./simulator/simulate";
export type { SimulationResult, DynamicInstruction, InitialCpuState } from "./simulator/simulate";
export { DEFAULT_CONFIG } from "./config";
export type { ProcessorConfig } from "./config";
export type { ParsedProgram, ParsedInstruction, Diagnostic } from "./isa/types";
export type {
  CycleSnapshot,
  Statistics,
  RowView,
  AluSnapshot,
  ForwardingEvent,
  StallEvent,
} from "./simulator/snapshots";
