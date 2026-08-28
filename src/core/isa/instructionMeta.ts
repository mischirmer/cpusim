import { alu, AluOperation } from "../simulator/alu";
import type {
  FlagName,
  InstructionDefinition,
  Mnemonic,
  ParsedInstruction,
  RegisterRef,
} from "../isa/types";

const MNEMONICS: Mnemonic[] = [
  "nop", "hlt", "add", "addc", "sub", "subc", "and", "or", "xor",
  "not", "shl", "shr", "rol", "ror", "rolc", "rorc", "ldi", "mov",
  "ldb", "ldw", "stb", "stw", "b", "bz", "bnz", "bn", "bnn", "bc", "bnc",
];

const BRANCH_MNEMONICS: Mnemonic[] = ["b", "bz", "bnz", "bn", "bnn", "bc", "bnc"];
const BRANCH_FLAG: Record<string, "Z" | "N" | "C"> = {
  bz: "Z", bnz: "Z", bn: "N", bnn: "N", bc: "C", bnc: "C",
};

const ALU_OPS_3: Record<string, AluOperation> = {
  add: "ADD", addc: "ADDC", sub: "SUB", subc: "SUBC",
  and: "AND", or: "OR", xor: "XOR",
};

const ALU_OPS_2: Record<string, AluOperation> = {
  not: "NOT", shl: "SHL", shr: "SHR",
  rol: "ROL", ror: "ROR", rolc: "ROLC", rorc: "RORC",
};

function make(name: Mnemonic): InstructionDefinition {
  const isBranch = BRANCH_MNEMONICS.includes(name);
  const aluOp = ALU_OPS_3[name] ?? ALU_OPS_2[name] ?? null;
  const isLoad = name === "ldb" || name === "ldw";
  const isStore = name === "stb" || name === "stw";
  const isMemory = isLoad || isStore;

  let operandPattern: Array<"r" | "i">;
  if (name === "ldi") operandPattern = ["r", "i"];
  else if (isBranch) operandPattern = ["i"];
  else if (name === "hlt" || name === "nop") operandPattern = [];
  else if (isMemory) operandPattern = ["r", "r"];
  else if (ALU_OPS_2[name]) operandPattern = ["r", "r"];
  else operandPattern = ["r", "r", "r"];

  let readsRegisters: (i: ParsedInstruction) => RegisterRef[] = () => [];
  let writesRegister: (i: ParsedInstruction) => RegisterRef | null = () => null;

  if (name === "ldi") {
    operandPattern = ["r", "i"];
    writesRegister = (i) => regRef(i, 0);
  } else if (name === "mov") {
    operandPattern = ["r", "r"];
    readsRegisters = (i) => [regRef(i, 1)];
    writesRegister = (i) => regRef(i, 0);
  } else if (isLoad) {
    readsRegisters = (i) => [regRef(i, 1)];
    writesRegister = (i) => regRef(i, 0);
  } else if (isStore) {
    readsRegisters = (i) => [regRef(i, 0), regRef(i, 1)]; // addr, data
    writesRegister = () => null;
  } else if (name === "hlt" || name === "nop") {
    // no operands
  } else if (aluOp) {
    writesRegister = (i) => regRef(i, 0);
    readsRegisters = (i) => {
      const n = ALU_OPS_2[name] ? 2 : 3; // operand count
      const out: RegisterRef[] = [];
      for (let k = 1; k < n; k++) out.push(regRef(i, k));
      return out;
    };
  }

  const writesFlags: FlagName[] =
    aluOp !== null ? (["Z", "N", "C"] as FlagName[]) : ([] as FlagName[]);

  return {
    mnemonic: name,
    operandPattern,
    readsRegisters,
    writesRegister,
    readsFlags: () => (isBranch ? (BRANCH_FLAG[name] ? [BRANCH_FLAG[name]] : []) : []),
    writesFlags,
    usesAlu: aluOp !== null,
    isBranch,
    isMemoryRead: isLoad,
    isMemoryWrite: isStore,
    // Returns the ALU-style compute result for the stage; branch/memory decided by simulator.
    compute: (operands, carryIn) => {
      if (aluOp === null) return undefined;
      const a = operands[0] ?? 0;
      const b = operands[1] ?? 0;
      return alu(aluOp, a, b, carryIn);
    },
    branchFlag: isBranch ? BRANCH_FLAG[name] ?? null : null,
    unary: Boolean(ALU_OPS_2[name]),
  };
}

function regRef(i: ParsedInstruction, n: number): RegisterRef {
  const o = i.operands[n];
  return { register: o && o.type === "register" ? o.register : 0 };
}

export const INSTRUCTION_DEFS: Record<Mnemonic, InstructionDefinition> =
  Object.fromEntries(MNEMONICS.map((m) => [m, make(m)])) as Record<Mnemonic, InstructionDefinition>;

export function isMnemonic(s: string): s is Mnemonic {
  return (MNEMONICS as string[]).includes(s);
}

export function evaluateBranch(
  mnemonic: Mnemonic,
  flags: { Z: boolean; N: boolean; C: boolean }
): boolean {
  if (mnemonic === "b") return true;
  switch (mnemonic) {
    case "bz": return flags.Z;
    case "bnz": return !flags.Z;
    case "bn": return flags.N;
    case "bnn": return !flags.N;
    case "bc": return flags.C;
    case "bnc": return !flags.C;
    default: return false;
  }
}
