import type { SimulationResult, RowView } from "../core/index";

interface Props {
  result: SimulationResult | null;
  cycle: number;
  maxCycle: number;
}

const STAGE_LABEL: Record<string, string> = {
  IF: "Herausholen (IF)",
  ID: "Dekodieren (ID)",
  OF: "Operanden lesen (OF)",
  EX: "Ausführen (EX)",
  WB: "Rückschreiben (WB)",
};

// Bei sehr langen Ausführungen (z. B. Schutzlimit) nur einen Ausschnitt um den
// gewählten Takt rendern, damit die Tabelle nutzbar bleibt.
const VISIBLE_CYCLES = 120;

export function PipelineView({ result, cycle, maxCycle }: Props) {
  if (!result) {
    return <div className="pipeline empty">Keine Simulation. Behebe die Assembler-Fehler im Editor.</div>;
  }

  const rows = result.dynamicInstructions.map((d) => ({
    dyn: d,
    cells: result.snapshots.map((s) => {
      const row = s.rows.find((r) => r.uid === d.uid);
      return row && row.status ? row.status : "waiting";
    }),
  }));

  const total = maxCycle + 1;
  let start = 0;
  let end = total;
  const truncated = total > VISIBLE_CYCLES;
  if (truncated) {
    const half = Math.floor(VISIBLE_CYCLES / 2);
    start = Math.min(Math.max(cycle - half, 0), total - VISIBLE_CYCLES);
    end = start + VISIBLE_CYCLES;
  }
  const cols = Array.from({ length: end - start }, (_, i) => start + i);

  return (
    <div className="pipeline" data-testid="pipeline">
      {result.dynamicInstructions.length === 0 && (
        <p className="pipeline-empty-msg">
          Leeres Programm – gib im Editor oben eine Instruktion ein (z. B. <code>ldi %r1, $1</code>).
        </p>
      )}
      <div className="scroll-x">
        <table>
          <caption className="sr-only">
            Pipeline-Ablauf: Zeilen sind Instruktionen, Spalten sind Takte.
          </caption>
          <thead>
            <tr>
              <th className="corner" scope="col">
                Instruktion
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className={c === cycle ? "col-cycle active" : "col-cycle"}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ dyn, cells }) => (
              <tr key={dyn.uid} data-testid="pipeline-row">
                <th className="instr" scope="row">
                  {dyn.mnemonic} <span className="addr">@{dyn.address}</span>{" "}
                  <span className="line">Z{dyn.sourceLine}</span>
                </th>
                {cells.slice(start, end).map((status, i) => {
                  const c = start + i;
                  return (
                    <td
                      key={c}
                      className={[
                        "cell",
                        status === "stall" ? "stall" : "",
                        status === "flush" ? "flush" : "",
                        status === "waiting" ? "waiting" : "",
                        c === cycle ? "col-cycle" : "",
                      ].join(" ")}
                      title={cellTooltip(dyn.mnemonic, status, c)}
                      aria-label={cellLabel(status, c)}
                    >
                      {renderCell(status)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="pipeline-note">
          Lange Ausführung: nur Takte {start}–{end - 1} von {total - 1} angezeigt. Zum Navigieren den
          Schieberegler nutzen.
        </p>
      )}
      <p className="pipeline-legend">
        Leer = wartend · <span className="badge stall">–</span> = Stall (Rot) ·{" "}
        <span className="badge flush">✕</span> = verworfen (Violett)
      </p>
    </div>
  );
}

function renderCell(status: RowView["status"] | "waiting"): string {
  if (status === "stall") return "–";
  if (status === "flush") return "✕";
  if (status === "waiting" || !status) return "";
  return status;
}

function cellLabel(status: RowView["status"] | "waiting", c: number): string {
  if (status === "stall") return `Takt ${c}: Stall`;
  if (status === "flush") return `Takt ${c}: verworfen`;
  if (status === "waiting" || !status) return `Takt ${c}: wartend`;
  return `Takt ${c}: ${STAGE_LABEL[status]}`;
}

function cellTooltip(mnemonic: string, status: RowView["status"] | "waiting", c: number): string {
  if (status === "stall") return `Takt ${c}: Stall – die Instruktion wartet auf einen noch nicht verfügbaren Operanden.`;
  if (status === "flush") return `Takt ${c}: ${mnemonic} wird verworfen (falscher Pfad).`;
  if (status === "waiting") return `Takt ${c}: wartet auf seine Einschleusung in die Pipeline.`;
  if (!status) return `Takt ${c}: ${mnemonic}.`;
  return `Takt ${c}: ${mnemonic} – ${STAGE_LABEL[status]}`;
}
