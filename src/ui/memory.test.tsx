import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { parseAssembly, simulate, DEFAULT_CONFIG } from "../core/index";
import { App } from "./App";
import { EXAMPLES } from "./examples";
import { memoryAt, memoryExplanation } from "./selectors";
import { MemoryEditor } from "./Panels";

function run(source: string, memory: Map<number, number>) {
  return simulate(parseAssembly(source), DEFAULT_CONFIG, { memory });
}

function addRow(addr: string, val: string) {
  fireEvent.click(screen.getByText("Eintrag hinzufügen"));
  const rows = screen.getAllByTestId("memory-row");
  const last = rows[rows.length - 1];
  fireEvent.change(within(last).getByLabelText("Adresse"), { target: { value: addr } });
  fireEvent.change(within(last).getByLabelText("Wert"), { target: { value: val } });
}

describe("Speicher-Integration", () => {
  it("Wort-Lesen (ldw) nutzt MSB-zuerst (Big-Endian)", () => {
    const r = run("ldi %r1, $0x1000\nldw %r2, %r1\nhlt\n", new Map([[0x1000, 0x12], [0x1001, 0x34]]));
    const last = r.snapshots[r.snapshots.length - 1];
    expect(last.cpuAfter.registers[2]).toBe(0x1234);
  });

  it("Byte-Lesen (ldb) aus initialisiertem Speicher", () => {
    const r = run("ldi %r1, $0x1000\nldb %r2, %r1\nhlt\n", new Map([[0x1000, 0x7f]]));
    const last = r.snapshots[r.snapshots.length - 1];
    expect(last.cpuAfter.registers[2]).toBe(0x7f);
  });

  it("Speichern (stw) aktualisiert den sichtbaren Speicherzustand", () => {
    const r = run("ldi %r1, $0\nldi %r2, $0x1234\nstw %r1, %r2\nhlt\n", new Map());
    const last = r.snapshots[r.snapshots.length - 1];
    const mem = new Map(last.memory);
    expect(mem.get(0)).toBe(0x12);
    expect(mem.get(1)).toBe(0x34);
  });

  it("initialisierte Speicherwerte erreichen den Simulator", () => {
    const r = run("ldi %r1, $0x1000\nldb %r2, %r1\nhlt\n", new Map([[0x1000, 0xab]]));
    expect(new Map(r.snapshots[0].memory).get(0x1000)).toBe(0xab);
  });

  it("integriertes Speicher-Beispiel läuft und liest das Wort zurück", () => {
    const src = EXAMPLES.find((e) => e.id === "memory")!.source;
    const r = simulate(parseAssembly(src));
    expect(r.termination.type).toBe("hlt");
    const last = r.snapshots[r.snapshots.length - 1];
    expect(last.cpuAfter.registers[3]).toBe(0x1234);
  });

  it("hebt Lese-/Schreibzellen im gewählten Takt hervor und erklärt das Wort", () => {
    const src = EXAMPLES.find((e) => e.id === "memory")!.source;
    const r = simulate(parseAssembly(src));
    // Zyklus, in dem ldw die Speicheradresse 0 liest
    const readCycle = r.snapshots.findIndex((s) =>
      memoryExplanation(r, s.cycle) !== null
    );
    expect(readCycle).toBeGreaterThan(0);
    const cells = memoryAt(r, readCycle);
    const c0 = cells.find((c) => c.address === 0);
    expect(c0?.read).toBe(true);
    expect(memoryExplanation(r, readCycle)).toMatch(/0x12/);
    expect(memoryExplanation(r, readCycle)).toMatch(/0x34/);
  });
});

describe("MemoryEditor (UI)", () => {
  it("zeigt deutsche Beschriftungen", () => {
    render(<App />);
    expect(screen.getByTestId("memory-editor").textContent).toContain("Initialer Speicher");
    expect(screen.getByText("Eintrag hinzufügen")).toBeTruthy();
    expect(screen.getByText("Alle löschen")).toBeTruthy();
    addRow("0x1000", "0xAA");
    expect(screen.getByText("Entfernen")).toBeTruthy();
  });

  it("löst bei Änderung eine Neu-Simulation aus und setzt den Takt zurück", () => {
    render(<App />);
    // Speicher-Beispiel laden, das mehr als 1 Takt hat
    fireEvent.change(screen.getByTestId("example-select"), { target: { value: "memory" } });
    fireEvent.click(screen.getByText("Weiter ›"));
    expect(screen.getByTestId("cycle-indicator").textContent).toContain("Takt 1");
    addRow("0x2000", "0xAB");
    expect(screen.getByTestId("cycle-indicator").textContent).toContain("Takt 0");
    // der Wert wird im Speicher-Panel sichtbar
    expect(screen.getByTestId("memory-view").textContent).toContain("0xAB");
  });

  it.each([
    ["0x0002", 0x00, 0x02, 0x0002],
    ["0x1234", 0x12, 0x34, 0x1234],
    ["0xABCD", 0xab, 0xcd, 0xabcd],
  ])("schreibt Wort %s im Initialspeicher Big-Endian", (word, high, low, loaded) => {
    const onChange = vi.fn();
    render(<MemoryEditor memory={new Map()} onChange={onChange} />);
    addRow("0x2000", word);
    const memory = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as Map<number, number>;

    expect(memory.get(0x2000)).toBe(high);
    expect(memory.get(0x2001)).toBe(low);

    const r = run("ldi %r0, $0x2000\nldw %r1, %r0\nhlt\n", memory);
    const last = r.snapshots[r.snapshots.length - 1];
    expect(last.cpuAfter.registers[1]).toBe(loaded);
  });

  it("meldet eine ungültige Adresse (außerhalb 16 Bit) auf Deutsch", () => {
    render(<App />);
    addRow("0x10000", "0xAB");
    expect(screen.getByText("Adresse außerhalb des 16-Bit-Bereichs (0x0000–0xFFFF).")).toBeTruthy();
  });

  it("meldet einen ungültigen Wort-Wert auf Deutsch", () => {
    render(<App />);
    addRow("0x1000", "0x10000");
    expect(screen.getByText("Der Wert muss ein Wort sein (0x0000–0xFFFF).")).toBeTruthy();
  });

  it("meldet überlappende Wort-Adressen auf Deutsch", () => {
    render(<App />);
    addRow("0x1000", "0xAA");
    addRow("0x1001", "0xBB");
    expect(screen.getByText(/Überlappender Speicherbereich bei 0x1001\./)).toBeTruthy();
  });

  it("Entfernen löscht eine Zeile, Alle löschen leert die Liste", () => {
    render(<App />);
    addRow("0x1000", "0xAA");
    addRow("0x1001", "0xBB");
    expect(screen.getAllByTestId("memory-row")).toHaveLength(2);
    fireEvent.click(screen.getByText("Alle löschen"));
    expect(screen.queryAllByTestId("memory-row")).toHaveLength(0);
  });
});
