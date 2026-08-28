import { WORD_MASK } from "../isa/registers";
import { INSTRUCTION_DEFS, isMnemonic } from "../isa/instructionMeta";
import type {
  Diagnostic,
  Operand,
  ParsedInstruction,
  ParsedProgram,
} from "../isa/types";
import { parseNumber } from "./numbers";

export function parseAssembly(source: string): ParsedProgram {
  const lines = source.split(/\r?\n/);
  const instructions: ParsedInstruction[] = [];
  const diagnostics: Diagnostic[] = [];
  let address = 0;

  lines.forEach((rawLine, lineIdx) => {
    const line = lineIdx + 1;
    const stripped = stripComment(rawLine);
    const cleaned = stripped.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length === 0) return;

    const tokens = cleaned.split(" ");
    const first = tokens[0];
    if (!first) return;

    // Optional label
    let mnemonicText = first;
    if (first.endsWith(":")) {
      // simple label (accepted but not yet resolved for branch targets)
      mnemonicText = tokens[1];
    }

    const rest = mnemonicText === first ? tokens.slice(1) : tokens.slice(2);

    if (!isMnemonic(mnemonicText)) {
      diagnostics.push({
        severity: "error",
        line,
        columnStart: rawLine.indexOf(first) + 1,
        columnEnd: rawLine.indexOf(first) + first.length + 1,
        code: "UNKNOWN_MNEMONIC",
        message: `Unbekannte Instruktion "${first}".`,
      });
      return;
    }

    const def = INSTRUCTION_DEFS[mnemonicText];
    const operands: Operand[] = [];
    let operandErrs = 0;
    const pattern = def.operandPattern;

    for (let i = 0; i < pattern.length; i++) {
      const tok = rest[i];
      if (tok === undefined) {
        diagnostics.push({
          severity: "error",
          line,
          columnStart: 1,
          columnEnd: rawLine.length + 1,
          code: "MISSING_OPERAND",
          message: missingMessage(mnemonicText, pattern.length),
        });
        operandErrs++;
        continue;
      }
      if (pattern[i] === "r") {
        const reg = parseRegister(tok, line, rawLine, diagnostics);
        if (reg === null) {
          operandErrs++;
          continue;
        }
        operands.push({ type: "register", register: reg });
      } else {
        const imm = parseImmediateToken(tok, line, rawLine, diagnostics);
        if (imm === null) {
          operandErrs++;
          continue;
        }
        operands.push({ type: "immediate", value: imm });
      }
    }

    // too many operands
    if (rest.length > pattern.length) {
      for (const extra of rest.slice(pattern.length)) {
        diagnostics.push({
          severity: "error",
          line,
          columnStart: rawLine.indexOf(extra) + 1,
          columnEnd: rawLine.indexOf(extra) + extra.length + 1,
          code: "EXTRA_OPERAND",
          message: `Zu viele Operanden für "${mnemonicText}".`,
        });
      }
    }

    if (operandErrs > 0) return;

    const index = instructions.length;
    instructions.push({
      id: `s-${index}`,
      index,
      sourceLine: line,
      address,
      rawText: rawLine.trim(),
      mnemonic: mnemonicText,
      operands,
      definition: def,
    });
    address += 2;
  });

  return { instructions, diagnostics };
}

function stripComment(line: string): string {
  const idx = line.indexOf(";");
  return idx === -1 ? line : line.slice(0, idx);
}

function parseRegister(
  tok: string,
  line: number,
  rawLine: string,
  diagnostics: Diagnostic[]
): number | null {
  const m = /^%r(\d+)$/.exec(tok);
  if (!m) {
    diagnostics.push({
      severity: "error",
      line,
      columnStart: rawLine.indexOf(tok) + 1,
      columnEnd: rawLine.indexOf(tok) + tok.length + 1,
      code: "INVALID_REGISTER",
      message: `Erwartet Registeroperand (%r0–%r15), gefunden "${tok}".`,
    });
    return null;
  }
  const n = Number(m[1]);
  if (n > 15) {
    diagnostics.push({
      severity: "error",
      line,
      columnStart: rawLine.indexOf(tok) + 1,
      columnEnd: rawLine.indexOf(tok) + tok.length + 1,
      code: "INVALID_REGISTER",
      message: `Register %r${n} ist im GdE1-Standardmodus nicht verfügbar (maximal %r15).`,
    });
    return null;
  }
  return n;
}

function parseImmediateToken(
  tok: string,
  line: number,
  rawLine: string,
  diagnostics: Diagnostic[]
): number | null {
  if (!tok.startsWith("$")) {
    diagnostics.push({
      severity: "error",
      line,
      columnStart: rawLine.indexOf(tok) + 1,
      columnEnd: rawLine.indexOf(tok) + tok.length + 1,
      code: "INVALID_IMMEDIATE",
      message: `Erwartet Sofortwert ($…), gefunden "${tok}".`,
    });
    return null;
  }
  const { value, ok } = parseNumber(tok.slice(1));
  if (!ok) {
    diagnostics.push({
      severity: "error",
      line,
      columnStart: rawLine.indexOf(tok) + 1,
      columnEnd: rawLine.indexOf(tok) + tok.length + 1,
      code: "INVALID_IMMEDIATE",
      message: `Ungültiger Sofortwert "${tok.slice(1)}".`,
    });
    return null;
  }
  if (value < -0x8000 || value > 0xffff) {
    diagnostics.push({
      severity: "error",
      line,
      columnStart: rawLine.indexOf(tok) + 1,
      columnEnd: rawLine.indexOf(tok) + tok.length + 1,
      code: "IMMEDIATE_RANGE",
      message: `Sprungoffset/SoFORTwert ${value} liegt außerhalb des unterstützten Bereichs.`,
    });
    return null;
  }
  return value & WORD_MASK;
}

function missingMessage(mnemonic: string, count: number): string {
  const noun = count === 1 ? "Operanden" : "Operanden";
  return `Erwartet ${count} ${noun} für "${mnemonic}".`;
}
