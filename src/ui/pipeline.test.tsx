import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { parseAssembly, simulate } from "../core/index";
import type { InitialCpuState } from "../core/index";
import { PipelineView } from "./PipelineView";

function runawayResult() {
  const state: InitialCpuState = { flags: { Z: false, N: false, C: false }, registers: Array(16).fill(0) };
  return simulate(parseAssembly("bnz $0\n"), undefined, state);
}

describe("PipelineView", () => {
  it("zeigt eine deutsche Leer-Phase bei leerem Programm", () => {
    const r = simulate(parseAssembly(""));
    render(<PipelineView result={r} cycle={0} maxCycle={r.snapshots.length - 1} />);
    expect(screen.getByText(/Leeres Programm/)).toBeTruthy();
  });

  it("beschränkt die Spalten bei langen Ausführungen auf ein Fenster um den gewählten Takt", () => {
    const r = runawayResult();
    const maxCycle = r.snapshots.length - 1;
    const cycle = 2500;
    render(<PipelineView result={r} cycle={cycle} maxCycle={maxCycle} />);
    expect(screen.getByText(/Lange Ausführung/)).toBeTruthy();
    const headRows = screen.getAllByRole("rowgroup").find((g) => g.tagName === "THEAD");
    const cols = within(headRows as HTMLElement).getAllByRole("columnheader").filter((c) => c.className.includes("col-cycle"));
    expect(cols.length).toBeLessThanOrEqual(120);
    expect(cols.length).toBeGreaterThan(0);
    const active = cols.find((c) => c.className.includes("active"));
    expect(active?.textContent).toBe(String(cycle));
    const first = cols[0]?.textContent;
    const last = cols[cols.length - 1]?.textContent;
    expect(Number(first)).toBeGreaterThanOrEqual(0);
    expect(Number(last)).toBeLessThanOrEqual(maxCycle);
  });
});
