import { parseAssembly } from "./parser/parser";
import { DEFAULT_CONFIG } from "./config";
import { simulate } from "./simulator/simulate";
import type { CellStatus } from "./simulator/snapshots";
import type { ProcessorConfig } from "./config";

export type CellMatrix = (CellStatus | null)[][];

export function statusMatrix(
  source: string,
  cfg: Partial<ProcessorConfig> = {},
): { program: import("./isa/types").ParsedProgram; result: import("./simulator/simulate").SimulationResult; matrix: CellMatrix } {
  const merged = {
    ...DEFAULT_CONFIG,
    ...cfg,
    forwarding: { enabled: false, ...(cfg.forwarding ?? {}) },
  } as ProcessorConfig;
  const program = parseAssembly(source);
  const result = simulate(program, merged);
  const cycles = result.snapshots.length;
  const matrix = result.dynamicInstructions.map((d) =>
    Array.from({ length: cycles }, (_, c) => {
      const row = result.snapshots[c].rows.find((r) => r.uid === d.uid);
      return row ? row.status : "waiting";
    }),
  );
  return { program, result, matrix };
}

export function finalRegisters(result: import("./simulator/simulate").SimulationResult): number[] {
  return result.finalState.registers;
}

export function finalFlags(result: import("./simulator/simulate").SimulationResult): { Z: boolean; N: boolean; C: boolean } {
  return result.finalState.flags;
}

export { simulate };
