import { WORD_MASK, toU16 } from "../isa/registers";
import type { FlagName } from "../isa/types";

export type AluOperation =
  | "ADD"
  | "ADDC"
  | "SUB"
  | "SUBC"
  | "AND"
  | "OR"
  | "XOR"
  | "NOT"
  | "SHL"
  | "SHR"
  | "ROL"
  | "ROR"
  | "ROLC"
  | "RORC";

export interface AluFlags {
  Z: boolean;
  N: boolean;
  C: boolean;
}

export interface AluResult {
  result: number;
  flags: AluFlags;
}

function mkFlags(result: number, carry: boolean): AluFlags {
  return { Z: result === 0, N: (result & 0x8000) !== 0, C: carry };
}

// Subtraction carry convention fixed by spec section 48.C: borrow => C=1
export function alu(
  op: AluOperation,
  a: number,
  b: number,
  carryIn: boolean
): AluResult {
  const A = toU16(a);
  const B = toU16(b);
  const cIn = carryIn ? 1 : 0;
  let result = 0;
  let flags: AluFlags;

  switch (op) {
    case "ADD": {
      result = toU16(A + B);
      flags = mkFlags(result, A + B > WORD_MASK);
      break;
    }
    case "ADDC": {
      result = toU16(A + B + cIn);
      flags = mkFlags(result, A + B + cIn > WORD_MASK);
      break;
    }
    case "SUB": {
      result = toU16(A - B);
      flags = mkFlags(result, A < B);
      break;
    }
    case "SUBC": {
      result = toU16(A - B - cIn);
      flags = mkFlags(result, A < B + cIn);
      break;
    }
    case "AND":
      result = toU16(A & B);
      flags = mkFlags(result, false);
      break;
    case "OR":
      result = toU16(A | B);
      flags = mkFlags(result, false);
      break;
    case "XOR":
      result = toU16(A ^ B);
      flags = mkFlags(result, false);
      break;
    case "NOT":
      result = toU16(~A);
      flags = mkFlags(result, false);
      break;
    case "SHL": {
      result = toU16((A << 1) & WORD_MASK);
      flags = mkFlags(result, (A & 0x8000) !== 0);
      break;
    }
    case "SHR": {
      result = toU16(A >> 1);
      flags = mkFlags(result, (A & 0x0001) !== 0);
      break;
    }
    case "ROL": {
      const top = A & 0x8000;
      result = toU16(((A << 1) & WORD_MASK) | (top ? 1 : 0));
      flags = mkFlags(result, top !== 0);
      break;
    }
    case "ROR": {
      const bottom = A & 0x0001;
      result = toU16((A >> 1) | (bottom ? 0x8000 : 0));
      flags = mkFlags(result, bottom !== 0);
      break;
    }
    case "ROLC": {
      const top = A & 0x8000;
      result = toU16(((A << 1) & WORD_MASK) | (carryIn ? 1 : 0));
      flags = mkFlags(result, top !== 0);
      break;
    }
    case "RORC": {
      const bottom = A & 0x0001;
      result = toU16((A >> 1) | (carryIn ? 0x8000 : 0));
      flags = mkFlags(result, bottom !== 0);
      break;
    }
  }
  return { result, flags };
}

export function branchTaken(
  mnemonic: "b" | "bz" | "bnz" | "bn" | "bnn" | "bc" | "bnc",
  flags: AluFlags
): boolean {
  switch (mnemonic) {
    case "b":
      return true;
    case "bz":
      return flags.Z;
    case "bnz":
      return !flags.Z;
    case "bn":
      return flags.N;
    case "bnn":
      return !flags.N;
    case "bc":
      return flags.C;
    case "bnc":
      return !flags.C;
  }
}

export const CARRY_FLAGS: FlagName[] = ["Z", "N", "C"];
