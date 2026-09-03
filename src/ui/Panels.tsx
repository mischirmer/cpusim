import { useEffect, useMemo, useRef, useState } from "react";
import type { SimulationResult } from "../core/index";
import {
  registersAt,
  flagsAt,
  aluAt,
  explanationsAt,
  statisticsView,
  registerLabel,
  instrName,
  memoryAt,
  memoryExplanation,
} from "./selectors";
import { EXAMPLES } from "./examples";

function hex(v: number): string {
  return `0x${(v & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
}

export function RegisterView({ result, cycle }: { result: SimulationResult | null; cycle: number }) {
  if (!result) return <section className="panel"><h2>Registerdatei</h2><p>–</p></section>;
  const regs = registersAt(result, cycle);
  return (
    <section className="panel" data-testid="register-view">
      <h2>Registerdatei</h2>
      <div className="reg-grid">
        {regs.map((r) => (
          <div
            key={r.index}
            className={[
              "reg",
              r.written ? "written" : "",
              r.read ? "read" : "",
            ].join(" ")}
            title={`${registerLabel(r.index)}${r.written ? " (geschrieben in diesem Takt)" : ""}${r.read ? " (gelesen in diesem Takt)" : ""}`}
            data-testid="register-cell"
          >
            <span className="reg-name">{registerLabel(r.index)}</span>
            <span className="reg-value">{hex(r.value)}</span>
            {r.forwarded && (
              <span className="reg-fwd" data-testid="reg-forwarded">
                fwd ← Instruktion {r.forwardedFrom}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function FlagsView({ result, cycle }: { result: SimulationResult | null; cycle: number }) {
  if (!result) return <section className="panel"><h2>Statusflags</h2><p>–</p></section>;
  const f = flagsAt(result, cycle);
  const snap = result.snapshots[cycle];
  const producerBy = (flag: string): string | null => {
    const w = snap.flagWrites.find((x) => x.flag === flag && x.value);
    return w ? instrName(result, w.uid) : null;
  };
  return (
    <section className="panel" data-testid="flags-view">
      <h2>Statusflags</h2>
      <div className="flag-row">
        {(["Z", "N", "C"] as const).map((flag) => {
          const producer = producerBy(flag);
          return (
            <div
              key={flag}
              className={["flag", f.changed.includes(flag) ? "changed" : ""].join(" ")}
              data-testid="flag-cell"
            >
              <span className="flag-name">{flag}</span>
              <span className="flag-value">{f[flag] ? "1" : "0"}</span>
              {producer && <span className="flag-producer">von {producer}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AluView({ result, cycle }: { result: SimulationResult | null; cycle: number }) {
  const alu = result ? aluAt(result, cycle) : null;
  return (
    <section className="panel" data-testid="alu-view">
      <h2>ALU (EX-Stufe)</h2>
      {alu ? (
        <div>
          <p className="alu-title">
            {alu.mnemonic} · {alu.operation}
          </p>
          <ul className="alu-operands">
            {alu.operands.map((op, i) => (
              <li key={i}>
                {op.name}: {hex(op.value)}
                <span className={op.source === "forwarded" ? "src fwd" : "src"}>
                  {op.source === "forwarded"
                    ? ` via Forwarding (${op.forwardStage})`
                    : " aus Registerdatei"}
                </span>
              </li>
            ))}
          </ul>
          {alu.result !== undefined && (
            <p>
              Ergebnis: <strong>{hex(alu.result)}</strong>
            </p>
          )}
          {alu.flags && (
            <p>
              Flags: Z={alu.flags.Z ? "1" : "0"} N={alu.flags.N ? "1" : "0"} C={alu.flags.C ? "1" : "0"}
            </p>
          )}
        </div>
      ) : (
        <p>Keine ALU-Ausführung in diesem Takt.</p>
      )}
    </section>
  );
}

export function StatisticsView({ result }: { result: SimulationResult | null }) {
  const stats = result ? statisticsView(result) : null;
  const lines = stats
    ? [
        stats.fetched,
        stats.completed,
        stats.flushed,
        stats.cpi,
        stats.totalCycles,
        stats.stallCycles,
        stats.flushCount,
        stats.forwardingEvents,
      ]
    : [];
  const termination = result
    ? result.termination.type === "max-cycles"
      ? "Ausführung abgebrochen (maximale Takte überschritten)."
      : result.termination.type === "runtime-error"
        ? `Laufzeitfehler: ${result.termination.message}`
        : "Ausführung beendet."
    : null;
  return (
    <section className="panel" data-testid="statistics-view">
      <h2>Statistik</h2>
      {stats ? (
        <>
          <ul className="stats">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {termination && <p className="termination">{termination}</p>}
        </>
      ) : (
        <p>–</p>
      )}
    </section>
  );
}

export function ExplanationPanel({ result, cycle }: { result: SimulationResult | null; cycle: number }) {
  const items = result ? explanationsAt(result, cycle) : [];
  return (
    <section className="panel explanation" data-testid="explanation-panel">
      <h2>Was passiert gerade?</h2>
      <p className="cycle-ctx">Takt {cycle}</p>
      {items.length > 0 ? (
        <ul className="explain">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{cycle === 0 ? "Startzustand – noch keine Instruktion geholt." : "Kein Ereignis in diesem Takt."}</p>
      )}
    </section>
  );
}

export function ForwardingToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="forwarding-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid="forwarding-toggle"
      />
      <span>
        <strong>Forwarding</strong>
        <small>Werte werden direkt aus der EX-/WB-Stufe weitergeleitet statt auf WB zu warten.</small>
      </span>
    </label>
  );
}

export function InitialStateEditor({
  regs,
  onRegs,
  flags,
  onFlags,
}: {
  regs: number[];
  onRegs: (r: number[]) => void;
  flags: { Z: boolean; N: boolean; C: boolean };
  onFlags: (f: { Z: boolean; N: boolean; C: boolean }) => void;
}) {
  const setReg = (i: number, v: string) => {
    const parsed = parseInt(v, 16);
    if (!Number.isFinite(parsed)) return;
    const next = [...regs];
    next[i] = parsed & 0xffff;
    onRegs(next);
  };
  return (
    <div className="init-editor">
      <h3>Startzustand</h3>
      <div className="init-regs">
        {regs.map((r, i) => (
          <label key={i} className="init-reg">
            <span>{`%r${i}`}</span>
            <input
              type="text"
              value={hex(r)}
              onChange={(e) => setReg(i, e.target.value)}
              aria-label={`Startwert %r${i}`}
            />
          </label>
        ))}
      </div>
      <div className="init-flags">
        {(["Z", "N", "C"] as const).map((flag) => (
          <label key={flag}>
            <span>{flag}</span>
            <input
              type="checkbox"
              checked={flags[flag]}
              onChange={(e) => onFlags({ ...flags, [flag]: e.target.checked })}
              aria-label={`Startflag ${flag}`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function ExamplePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <label className="example-picker">
      <span>Beispiel:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid="example-select">
        {EXAMPLES.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.title}
          </option>
        ))}
      </select>
    </label>
  );
}

const INSTRUCTION_HELP = [
  { op: "nop", syntax: "nop", flags: "-", text: "Keine Operation; durchläuft die Pipeline ohne Register, Flags oder Speicher zu ändern." },
  { op: "hlt", syntax: "hlt", flags: "-", text: "Beendet das Programm, sobald die Instruktion wirksam wird; jüngere spekulative Instruktionen werden verworfen." },
  { op: "ldi", syntax: "ldi %rd $imm", flags: "-", text: "Lädt den 16-Bit-Immediate-Wert in das Zielregister." },
  { op: "mov", syntax: "mov %rd %rs", flags: "-", text: "Kopiert den Wert aus einem Register in ein anderes Register." },
  { op: "add", syntax: "add %rd %ra %rb", flags: "Z N C", text: "Addiert zwei Register. C ist der unsigned Carry aus Bit 15." },
  { op: "addc", syntax: "addc %rd %ra %rb", flags: "Z N C", text: "Addiert zwei Register plus aktuelles Carry-Flag." },
  { op: "sub", syntax: "sub %rd %ra %rb", flags: "Z N C", text: "Subtrahiert %rb von %ra. C=1 bedeutet Borrow." },
  { op: "subc", syntax: "subc %rd %ra %rb", flags: "Z N C", text: "Subtrahiert %rb und das aktuelle Carry-Flag von %ra." },
  { op: "and", syntax: "and %rd %ra %rb", flags: "Z N C", text: "Bitweises UND. C wird auf 0 gesetzt." },
  { op: "or", syntax: "or %rd %ra %rb", flags: "Z N C", text: "Bitweises ODER. C wird auf 0 gesetzt." },
  { op: "xor", syntax: "xor %rd %ra %rb", flags: "Z N C", text: "Bitweises exklusives ODER. C wird auf 0 gesetzt." },
  { op: "not", syntax: "not %rd %rs", flags: "Z N C", text: "Invertiert alle Bits des Quellregisters. C wird auf 0 gesetzt." },
  { op: "shl", syntax: "shl %rd %rs", flags: "Z N C", text: "Schiebt links um ein Bit. C ist das alte Bit 15." },
  { op: "shr", syntax: "shr %rd %rs", flags: "Z N C", text: "Schiebt logisch rechts um ein Bit. C ist das alte Bit 0." },
  { op: "rol", syntax: "rol %rd %rs", flags: "Z N C", text: "Rotiert links; das alte Bit 15 wird Bit 0 und C." },
  { op: "ror", syntax: "ror %rd %rs", flags: "Z N C", text: "Rotiert rechts; das alte Bit 0 wird Bit 15 und C." },
  { op: "rolc", syntax: "rolc %rd %rs", flags: "Z N C", text: "Rotiert links über Carry: altes C wird Bit 0, altes Bit 15 wird neues C." },
  { op: "rorc", syntax: "rorc %rd %rs", flags: "Z N C", text: "Rotiert rechts über Carry: altes C wird Bit 15, altes Bit 0 wird neues C." },
  { op: "ldb", syntax: "ldb %rd %ra", flags: "-", text: "Lädt ein Byte von der Adresse in %ra und schreibt es als 16-Bit-Wert in %rd." },
  { op: "ldw", syntax: "ldw %rd %ra", flags: "-", text: "Lädt ein Big-Endian-Wort: mem[addr] ist das High-Byte, mem[addr+1] das Low-Byte." },
  { op: "stb", syntax: "stb %ra %rs", flags: "-", text: "Speichert das Low-Byte von %rs an die Adresse in %ra." },
  { op: "stw", syntax: "stw %ra %rs", flags: "-", text: "Speichert ein Big-Endian-Wort: High-Byte an addr, Low-Byte an addr+1." },
  { op: "b", syntax: "b $off", flags: "-", text: "Springt immer relativ zur Adresse der Branch-Instruktion: Ziel = PC_der_Instruktion + 2*off." },
  { op: "bz", syntax: "bz $off", flags: "liest Z", text: "Springt, wenn Z=1." },
  { op: "bnz", syntax: "bnz $off", flags: "liest Z", text: "Springt, wenn Z=0." },
  { op: "bn", syntax: "bn $off", flags: "liest N", text: "Springt, wenn N=1." },
  { op: "bnn", syntax: "bnn $off", flags: "liest N", text: "Springt, wenn N=0." },
  { op: "bc", syntax: "bc $off", flags: "liest C", text: "Springt, wenn C=1." },
  { op: "bnc", syntax: "bnc $off", flags: "liest C", text: "Springt, wenn C=0." },
];

export function InstructionHelp() {
  return (
    <section className="help-panel" data-testid="instruction-help">
      <div className="help-intro">
        <h2>Instruktionshilfe</h2>
        <p>
          Register sind 16 Bit breit. Speicher ist byte-adressiert und Big-Endian. Immediates können dezimal oder mit
          0x-Präfix hexadezimal geschrieben werden.
        </p>
      </div>
      <table className="help-table">
        <thead>
          <tr>
            <th>Instruktion</th>
            <th>Syntax</th>
            <th>Flags</th>
            <th>Wirkung</th>
          </tr>
        </thead>
        <tbody>
          {INSTRUCTION_HELP.map((item) => (
            <tr key={item.op}>
              <td className="help-op">{item.op}</td>
              <td className="help-syntax">{item.syntax}</td>
              <td>{item.flags}</td>
              <td>{item.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function parseNumberInput(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === "") return null;
  const isHex = t.startsWith("0x");
  if (isHex && !/^0x[0-9a-f]+$/.test(t)) return null;
  if (!isHex && !/^\d+$/.test(t)) return null;
  const n = Number.parseInt(isHex ? t.slice(2) : t, isHex ? 16 : 10);
  return Number.isNaN(n) ? null : n;
}

interface MemoryRow {
  id: number;
  addr: string;
  val: string;
}

function seedRows(memory: Map<number, number>): MemoryRow[] {
  const rows: MemoryRow[] = [];
  const consumed = new Set<number>();
  const addresses = [...memory.keys()].sort((a, b) => a - b);
  for (const a of addresses) {
    const addr = a & 0xffff;
    if (consumed.has(addr)) continue;
    const nextAddr = (addr + 1) & 0xffff;
    const high = memory.get(addr) ?? 0;
    const low = memory.get(nextAddr) ?? 0;
    rows.push({
      id: rows.length,
      addr: `0x${addr.toString(16).toUpperCase().padStart(4, "0")}`,
      val: `0x${(((high & 0xff) << 8) | (low & 0xff)).toString(16).toUpperCase().padStart(4, "0")}`,
    });
    consumed.add(addr);
    if (memory.has(nextAddr)) consumed.add(nextAddr);
  }
  return rows;
}

export function MemoryEditor({
  memory,
  onChange,
}: {
  memory: Map<number, number>;
  onChange: (m: Map<number, number>) => void;
}) {
  const [rows, setRows] = useState<MemoryRow[]>(() => seedRows(memory));
  const nextId = useRef(rows.length);
  const lastPushed = useRef<Map<number, number>>(new Map(memory));
  const syncingFromProps = useRef(false);

  useEffect(() => {
    if (mapsEqual(memory, lastPushed.current)) return;
    const seeded = seedRows(memory);
    syncingFromProps.current = true;
    setRows(seeded);
    nextId.current = seeded.length;
    lastPushed.current = new Map(memory);
  }, [memory]);

  const rowErrors = useMemo(() => {
    const seen = new Map<number, number>();
    const errs: Record<number, { addr?: string; val?: string }> = {};
    for (const r of rows) {
      if (r.addr.trim() === "" && r.val.trim() === "") continue;
      const a = parseNumberInput(r.addr);
      const v = parseNumberInput(r.val);
      if (a === null) errs[r.id] = { ...errs[r.id], addr: "Ungültige Adresse." };
      else if (a > 0xffff) errs[r.id] = { ...errs[r.id], addr: "Adresse außerhalb des 16-Bit-Bereichs (0x0000–0xFFFF)." };
      if (v === null) errs[r.id] = { ...errs[r.id], val: "Ungültiger Wert." };
      else if (v > 0xffff) errs[r.id] = { ...errs[r.id], val: "Der Wert muss ein Wort sein (0x0000–0xFFFF)." };
      if (a !== null && a <= 0xffff && v !== null && v <= 0xffff) {
        for (const byteAddr of [a, (a + 1) & 0xffff]) {
          if (seen.has(byteAddr)) {
            errs[r.id] = { ...errs[r.id], addr: `Überlappender Speicherbereich bei ${memHex(byteAddr)}.` };
            break;
          }
          seen.set(byteAddr, r.id);
        }
      }
    }
    return errs;
  }, [rows]);

  useEffect(() => {
    if (syncingFromProps.current) {
      syncingFromProps.current = false;
      return;
    }
    const m = new Map<number, number>();
    for (const r of rows) {
      const a = parseNumberInput(r.addr);
      const v = parseNumberInput(r.val);
      if (a !== null && a <= 0xffff && v !== null && v <= 0xffff) {
        m.set(a, (v >> 8) & 0xff);
        m.set((a + 1) & 0xffff, v & 0xff);
      }
    }
    if (mapsEqual(m, lastPushed.current)) return;
    lastPushed.current = m;
    onChange(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const update = (id: number, patch: Partial<MemoryRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="memory-editor" data-testid="memory-editor">
      <h3>Initialer Speicher</h3>
      <div className="mem-table">
        <div className="mem-head">
          <span>Adresse</span>
          <span>Wert</span>
          <span />
        </div>
        {rows.length === 0 && <p className="mem-empty">Kein Speicher initialisiert (Standard: 0).</p>}
        {rows.map((r) => {
          const err = rowErrors[r.id];
          return (
            <div className="mem-row" key={r.id} data-testid="memory-row">
              <div className="mem-field">
                <input
                  type="text"
                  value={r.addr}
                  onChange={(e) => update(r.id, { addr: e.target.value })}
                  aria-label="Adresse"
                  className={err?.addr ? "invalid" : ""}
                />
                {err?.addr && <span className="mem-error">{err.addr}</span>}
              </div>
              <div className="mem-field">
                <input
                  type="text"
                  value={r.val}
                  onChange={(e) => update(r.id, { val: e.target.value })}
                  aria-label="Wert"
                  className={err?.val ? "invalid" : ""}
                />
                {err?.val && <span className="mem-error">{err.val}</span>}
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                aria-label="Entfernen"
              >
                Entfernen
              </button>
            </div>
          );
        })}
      </div>
      <div className="mem-actions">
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [...rs, { id: nextId.current++, addr: "", val: "" }]);
          }}
        >
          Eintrag hinzufügen
        </button>
        <button
          type="button"
          onClick={() => setRows([])}
          disabled={rows.length === 0}
        >
          Alle löschen
        </button>
      </div>
      <p className="mem-hint">Byte-adressiert, Big-Endian (MSB zuerst). Ein Wort 0xABCD wird als 0xAB, 0xCD abgelegt.</p>
    </div>
  );
}

function mapsEqual(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function memHex(v: number): string {
  return `0x${(v & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
}
function memByte(v: number): string {
  return `0x${(v & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;
}

export function MemoryView({ result, cycle }: { result: SimulationResult | null; cycle: number }) {
  if (!result) return <section className="panel"><h2>Speicher</h2><p>–</p></section>;
  const cells = memoryAt(result, cycle);
  const expl = memoryExplanation(result, cycle);
  return (
    <section className="panel" data-testid="memory-view">
      <h2>Speicher</h2>
      {expl && <p className="memory-explain" data-testid="memory-explain">{expl}</p>}
      {cells.length === 0 ? (
        <p>Keine Speicherzellen relevant (alles 0).</p>
      ) : (
        <table className="mem-table">
          <thead>
            <tr>
              <th>Adresse</th>
              <th>Byte</th>
              <th>Aktivität</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr
                key={c.address}
                className={[
                  c.read ? "mem-read" : "",
                  c.written ? "mem-written" : "",
                ].join(" ")}
              >
                <td className="mem-addr">{memHex(c.address)}</td>
                <td className="mem-val">{memByte(c.value)}</td>
                <td className="mem-act">
                  {c.written && <span className="mem-tag w">geschrieben</span>}
                  {c.read && <span className="mem-tag r">gelesen</span>}
                  {c.initialized && !c.written && <span className="mem-tag i">initial</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
