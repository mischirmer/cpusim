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

function memoryWords(entries: Array<[number, number]>): Map<number, number> {
  const memory = new Map<number, number>();
  for (const [address, value] of entries) {
    memory.set(address & 0xffff, (value >> 8) & 0xff);
    memory.set((address + 1) & 0xffff, value & 0xff);
  }
  return memory;
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
  {
    id: "multiply-2x3",
    title: "Multiplikation 2 × 3",
    description:
      "Multipliziert die Big-Endian-Worte an 0x2000 und 0x2002 und speichert das Ergebnis an 0x2004.",
    initialState: {
      memory: memoryWords([
        [0x2000, 0x0002],
        [0x2002, 0x0003],
      ]),
    },
    source: `ldi %r0 $0x200
shl %r0 %r0
shl %r0 %r0
shl %r0 %r0
shl %r0 %r0 ; %r0 = 0x2000
ldi %r1 $1 ; %r1 = 1
ldi %r2 $2 ; %r2 = 2
ldw %r3 %r0 ; %r3 = [0x2000] (=a)
add %r0 %r0 %r2
ldw %r4 %r0 ; %r4 = [0x2002] (=b)
ldi %r5 $0 ; %r5 (c) = 0
and %r6 %r4 %r1 ; test lowest bit
bz $3 ; skip addition and test
add %r5 %r5 %r3 ; c = c + a
bc $6 ; catch overflow
shr %r4 %r4 ; b = b >> 1
bz $6 ; b is zero, done
shl %r3 %r3 ; a = a << 1
bc $2 ; catch overflow
b $-8 ; jump back to loop
ldi %r5 $0
not %r5 %r5 ; c = 0xffff on overflow
add %r0 %r0 %r2
stw %r0 %r5 ; [0x2004] = c
hlt
`,
  },
];
