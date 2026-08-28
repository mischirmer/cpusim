import React, { useMemo, useState } from "react";
import { parseAssembly, simulate, DEFAULT_CONFIG } from "../core/index";
import type { ProcessorConfig } from "../core/index";
import { AssemblyEditor } from "./AssemblyEditor";
import { PipelineView } from "./PipelineView";
import { CycleControls } from "./CycleControls";
import {
  RegisterView,
  FlagsView,
  AluView,
  StatisticsView,
  ExplanationPanel,
  ForwardingToggle,
  InitialStateEditor,
  ExamplePicker,
  MemoryEditor,
  MemoryView,
} from "./Panels";
import { EXAMPLES } from "./examples";
import "./App.css";

export function App() {
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id);
  const [source, setSource] = useState(EXAMPLES[0].source);
  const [forwarding, setForwarding] = useState(false);
  const [initRegs, setInitRegs] = useState<number[]>(Array(16).fill(0));
  const [initFlags, setInitFlags] = useState<{ Z: boolean; N: boolean; C: boolean }>({ Z: false, N: false, C: false });
  const [initMemory, setInitMemory] = useState<Map<number, number>>(new Map());
  const [selectedCycle, setSelectedCycle] = useState(0);
  const [playing, setPlaying] = useState(false);

  const parsed = useMemo(() => parseAssembly(source), [source]);
  const hasErrors = parsed.diagnostics.some((d) => d.severity === "error");

  const config: ProcessorConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, forwarding: { enabled: forwarding } }),
    [forwarding]
  );

  const result = useMemo(() => {
    if (hasErrors) return null;
    return simulate(parsed, config, { registers: initRegs, flags: initFlags, memory: initMemory });
  }, [parsed, hasErrors, config, initRegs, initFlags, initMemory]);

  const maxCycle = result ? result.snapshots.length - 1 : 0;
  const cycle = Math.min(selectedCycle, maxCycle);

  // Jede Änderung an Quelle/Forwarding/Startzustand erzwingt eine Neu-Simulation
  // und setzt die Auswahl auf Takt 0 zurück.
  const invalidate = React.useCallback(() => {
    setSelectedCycle(0);
    setPlaying(false);
  }, []);

  React.useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setSelectedCycle((c) => {
        if (c >= maxCycle) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [playing, maxCycle]);

  const selectExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setExampleId(id);
    setSource(ex.source);
    setForwarding(ex.forwarding ?? false);
    if (ex.initialState) {
      setInitRegs(Array.from({ length: 16 }, (_, i) => ex.initialState!.registers?.[i] ?? 0));
      setInitFlags({
        Z: ex.initialState.flags?.Z ?? false,
        N: ex.initialState.flags?.N ?? false,
        C: ex.initialState.flags?.C ?? false,
      });
      setInitMemory(ex.initialState.memory ?? new Map());
    }
    invalidate();
  };

  return (    <div className="app">
      <header className="app-header">
        <div>
          <h1>Pipeline-Simulator GdE1</h1>
          <p className="example-desc">{EXAMPLES.find((e) => e.id === exampleId)?.description}</p>
        </div>
        <ExamplePicker value={exampleId} onChange={selectExample} />
      </header>

      <section className="editor-pane">
        <AssemblyEditor
          source={source}
          onChange={(v) => {
            setSource(v);
            invalidate();
          }}
          diagnostics={parsed.diagnostics}
        />
        <div className="controls-row">
          <ForwardingToggle
            checked={forwarding}
            onChange={(v) => {
              setForwarding(v);
              invalidate();
            }}
          />
          <InitialStateEditor
            regs={initRegs}
            onRegs={(r) => {
              setInitRegs(r);
              invalidate();
            }}
            flags={initFlags}
            onFlags={(f) => {
              setInitFlags(f);
              invalidate();
            }}
          />
          <MemoryEditor
            memory={initMemory}
            onChange={(m) => {
              setInitMemory(m);
              invalidate();
            }}
          />
        </div>
      </section>

      <section className="main-pane">
        <CycleControls
          cycle={cycle}
          maxCycle={maxCycle}
          playing={playing}
          onCycle={setSelectedCycle}
          onPlayToggle={() => setPlaying((p) => !p)}
          onReset={() => {
            setSelectedCycle(0);
            setPlaying(false);
          }}
        />
        <PipelineView result={result} cycle={cycle} maxCycle={maxCycle} />
        <div className="detail-grid">
          <RegisterView result={result} cycle={cycle} />
          <FlagsView result={result} cycle={cycle} />
          <AluView result={result} cycle={cycle} />
          <MemoryView result={result} cycle={cycle} />
          <StatisticsView result={result} />
          <div className="explanation-wrap">
            <ExplanationPanel result={result} cycle={cycle} />
          </div>
        </div>
      </section>
    </div>
  );
}
