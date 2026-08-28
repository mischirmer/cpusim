import type { InitialCpuState } from "../core/index";

export interface Example {
  id: string;
  title: string;
  description: string;
  source: string;
  /** Intended processor configuration applied when the example is selected. */
  forwarding?: boolean;
  /** Intended initial CPU state (registers/flags/memory) when applicable. */
  initialState?: InitialCpuState;
}

export const EXAMPLES: Example[] = [
  {
    id: "diagonal",
    title: "Einfache Pipeline ohne Konflikte",
    description: "Unabhängige Instruktionen fließen ohne Stalls durch die Pipeline.",
    source: `ldi %r1, $1
ldi %r2, $2
ldi %r3, $3
hlt
`,
  },
  {
    id: "raw",
    title: "RAW-Abhängigkeit",
    description: "add benötigt den Wert von %r1, den ldi erst in der WB-Phase bereitstellt. Ohne Forwarding entsteht ein Stall.",
    forwarding: false,
    source: `ldi %r1, $5
add %r2, %r1, %r3
hlt
`,
  },
  {
    id: "raw-forwarding",
    title: "Forwarding löst RAW-Abhängigkeiten auf",
    description:
      "Aktiviere Forwarding: %r1 und %r2 werden direkt aus den bereits berechneten ALU-Ergebnissen weitergeleitet, statt auf WB zu warten.",
    forwarding: true,
    source: `ldi %r1, $5
add %r2, %r1, %r1
add %r3, %r2, %r1
hlt
`,
  },
  {
    id: "branch-flush",
    title: "Bedingter Sprung mit Flush",
    description: "Ein genommener Sprung verwirft die Instruktionen auf dem falschen Pfad.",
    source: `ldi %r1, $5
add %r2, %r1, %r4
b $2
xor %r3, %r3, %r3
nop
ldi %r5, $7
hlt
`,
  },
  {
    id: "loop",
    title: "Schleife",
    description: "bnz springt zurück, solange %r1 nicht 0 ist. Die Schleife erzeugt mehrere dynamische Instanzen.",
    source: `ldi %r1, $3
ldi %r2, $1
sub %r1, %r1, %r2
bnz $-2
hlt
`,
  },
  {
    id: "memory",
    title: "Speicherzugriff",
    description:
      "stw schreibt ein Wort (Big-Endian, MSB zuerst) an 0x0000–0x0001; ldw liest es zurück.",
    source: `ldi %r1, $0
ldi %r2, $0x1234
stw %r1, %r2
ldw %r3, %r1
hlt
`,
  },
];
