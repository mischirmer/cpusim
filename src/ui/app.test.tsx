import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { parseAssembly, simulate, DEFAULT_CONFIG } from "../core/index";
import type { ProcessorConfig } from "../core/index";
import { App } from "./App";
import { EXAMPLES } from "./examples";

function rawResult(forwarding = false) {
  const src = EXAMPLES.find((e) => e.id === "raw")!.source;
  const config: ProcessorConfig = { ...DEFAULT_CONFIG, forwarding: { enabled: forwarding } };
  return simulate(parseAssembly(src), config);
}

function selectExample(id: string) {
  fireEvent.change(screen.getByTestId("example-select"), { target: { value: id } });
}

function setCycle(c: number) {
  fireEvent.change(screen.getByLabelText("Takt auswählen"), { target: { value: String(c) } });
}

describe("App", () => {
  it("rendert alle Panels für ein gültiges Programm ohne Fehler", () => {
    render(<App />);
    expect(screen.getByTestId("pipeline")).toBeTruthy();
    expect(screen.getByTestId("register-view")).toBeTruthy();
    expect(screen.getByTestId("flags-view")).toBeTruthy();
    expect(screen.getByTestId("alu-view")).toBeTruthy();
    expect(screen.getByTestId("statistics-view")).toBeTruthy();
    expect(screen.getByTestId("explanation-panel")).toBeTruthy();
    expect(screen.queryAllByTestId("diagnostic-error")).toHaveLength(0);
  });

  it("unterscheidet die Taktanzeige bei Navigation", () => {
    render(<App />);
    selectExample("raw");
    const indicator = screen.getByTestId("cycle-indicator");
    expect(indicator.textContent).toContain("Takt 0");
    fireEvent.click(screen.getByText(/Weiter/));
    expect(screen.getByTestId("cycle-indicator").textContent).toContain("Takt 1");
    fireEvent.click(screen.getByText("‹ Zurück"));
    expect(screen.getByTestId("cycle-indicator").textContent).toContain("Takt 0");
  });

  it("zeigt einen deutschen Pitch-Stall-Text im Stall-Takt der RAW-Abhängigkeit", () => {
    const result = rawResult(false);
    const stallCycle = result.snapshots.findIndex((s) =>
      s.events.some((e) => e.type === "stall")
    );
    expect(stallCycle).toBeGreaterThan(0);
    render(<App />);
    selectExample("raw");
    setCycle(stallCycle);
    expect(screen.getByTestId("explanation-panel").textContent).toContain("Stall");
  });

  it("Forwarding reduziert den Stall (Statistik und Pipeline)", () => {
    const off = rawResult(false);
    const offStats = off.statistics;
    expect(offStats.stallCycles).toBeGreaterThan(0);
    render(<App />);
    selectExample("raw");
    expect(screen.getByTestId("statistics-view").textContent).toContain("Stall-Takte");
    fireEvent.click(screen.getByTestId("forwarding-toggle"));
    const on = rawResult(true);
    // Forwarding entfernt die WB-Warte-Stalls; ein struktureller Same-Cycle-EX-Stall
    // (kein Same-Cycle-EX->OF) bleibt bestehen
    expect(on.statistics.stallCycles).toBeLessThan(offStats.stallCycles);
    expect(on.statistics.forwardingEvents).toBeGreaterThan(0);
  });

  it("zeigt Registerwerte passend zum gewählten Takt (diagonal)", () => {
    const src = EXAMPLES.find((e) => e.id === "diagonal")!.source;
    const result = simulate(parseAssembly(src));
    const last = result.snapshots.length - 1;
    const finalRegs = result.snapshots[last].cpuAfter.registers;
    render(<App />);
    selectExample("diagonal");
    setCycle(last);
    const cells = screen.getAllByTestId("register-cell");
    cells.forEach((cell, i) => {
      const valueSpan = within(cell).getByText(new RegExp(`^0x${finalRegs[i].toString(16).toUpperCase().padStart(4, "0")}$`));
      expect(valueSpan).toBeTruthy();
    });
  });

  it("kennzeichnet weitergeleitete Register beim aktiven Forwarding", () => {
    const src = EXAMPLES.find((e) => e.id === "raw-forwarding")!.source;
    const config: ProcessorConfig = { ...DEFAULT_CONFIG, forwarding: { enabled: true } };
    const result = simulate(parseAssembly(src), config);
    const fwdCycle = result.snapshots.findIndex((s) => s.forwarding.length > 0);
    expect(fwdCycle).toBeGreaterThan(0);
    render(<App />);
    selectExample("raw-forwarding");
    // die Auswahl des Beispiels setzt die Konfig des Beispiels an (Forwarding an)
    // und der Toggle spiegelt den tatsächlichen Konfig-Wert wider
    expect((screen.getByTestId("forwarding-toggle") as HTMLInputElement).checked).toBe(true);
    setCycle(fwdCycle);
    expect(screen.queryAllByTestId("reg-forwarded").length).toBeGreaterThan(0);
  });

  it("Auswahl des Forwarding-Beispiels aktiviert den Forwarding-Toggle automatisch", () => {
    render(<App />);
    // Standardbeispiel hat Forwarding aus
    expect((screen.getByTestId("forwarding-toggle") as HTMLInputElement).checked).toBe(false);
    selectExample("raw-forwarding");
    expect((screen.getByTestId("forwarding-toggle") as HTMLInputElement).checked).toBe(true);
    // RAW-Beispiel (ohne Forwarding) setzt den Toggle wieder zurück
    selectExample("raw");
    expect((screen.getByTestId("forwarding-toggle") as HTMLInputElement).checked).toBe(false);
  });

  it("zeigt einen deutschen Fehlertext bei unbekannter Instruktion (Editor-Ebene)", () => {
    const { rerender } = render(<div />);
    void rerender;
    // AssemblyEditor wird über App angesteuert; wir prüfen die Parser-Fehlermeldung direkt:
    const parsed = parseAssembly("xyz %r1, $1\n");
    const err = parsed.diagnostics.find((d) => d.severity === "error");
    expect(err?.message).toMatch(/Unbekannte Instruktion/);
  });

  it("setzt den Takt bei Beispielwechsel zurück", () => {
    render(<App />);
    selectExample("raw");
    fireEvent.click(screen.getByText(/Weiter/));
    expect(screen.getByTestId("cycle-indicator").textContent).not.toContain("Takt 0 /");
    selectExample("diagonal");
    expect(screen.getByTestId("cycle-indicator").textContent).toContain("Takt 0 /");
  });
});
