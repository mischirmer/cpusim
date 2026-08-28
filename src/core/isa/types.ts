export type Word = number;

export type Mnemonic =
  | "nop"
  | "hlt"
  | "add"
  | "addc"
  | "sub"
  | "subc"
  | "and"
  | "or"
  | "xor"
  | "not"
  | "shl"
  | "shr"
  | "rol"
  | "ror"
  | "rolc"
  | "rorc"
  | "ldi"
  | "mov"
  | "ldb"
  | "ldw"
  | "stb"
  | "stw"
  | "b"
  | "bz"
  | "bnz"
  | "bn"
  | "bnn"
  | "bc"
  | "bnc";

export type PipelineStage = "IF" | "ID" | "OF" | "EX" | "WB";

export type FlagName = "Z" | "N" | "C";

export type Operand =
  | { type: "register"; register: number }
  | { type: "immediate"; value: Word };

export interface ParsedInstruction {
  id: string;
  index: number;
  sourceLine: number;
  address: number;
  rawText: string;
  mnemonic: Mnemonic;
  operands: Operand[];
  definition: InstructionDefinition;
}

export interface ParsedProgram {
  instructions: ParsedInstruction[];
  diagnostics: Diagnostic[];
}

export interface RegisterRef {
  register: number;
}

export interface Diagnostic {
  severity: "error" | "warning";
  line: number;
  columnStart: number;
  columnEnd: number;
  code: string;
  message: string;
}

export interface ExecuteResult {
  writes: Array<
    | { kind: "register"; register: number; value: Word }
    | { kind: "memory"; address: number; value: Word; width: 1 | 2 }
  >;
  flags?: { Z: boolean; N: boolean; C: boolean };
  branch?: {
    taken: boolean;
    targetAddress: number;
  };
  readsFlagsForBranch?: { flag: FlagName; value: boolean } | null;
  halt?: boolean;
}

export interface InstructionDefinition {
  mnemonic: Mnemonic;
  operandPattern: Array<"r" | "i">;
  readsRegisters: (i: ParsedInstruction) => RegisterRef[];
  writesRegister: (i: ParsedInstruction) => RegisterRef | null;
  readsFlags: (i: ParsedInstruction) => FlagName[];
  writesFlags: FlagName[];
  usesAlu: boolean;
  isBranch: boolean;
  isMemoryRead: boolean;
  isMemoryWrite: boolean;
  unary: boolean;
  branchFlag: FlagName | null;
  compute: (
    operands: Word[],
    carryIn: boolean
  ) => { result: number; flags: { Z: boolean; N: boolean; C: boolean } } | undefined;
}
