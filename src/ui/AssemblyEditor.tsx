import CodeMirror from "@uiw/react-codemirror";
import { basicSetup } from "codemirror";
import type { Diagnostic } from "../core/index";
import { asmLanguageSupport } from "./asmLanguage";

interface Props {
  source: string;
  onChange: (v: string) => void;
  diagnostics: Diagnostic[];
}

export function AssemblyEditor({ source, onChange, diagnostics }: Props) {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  return (
    <div className="assembly-editor">
      <h2>Assembler-Quelltext</h2>
      <CodeMirror
        value={source}
        height="220px"
        onChange={onChange}
        extensions={[basicSetup, asmLanguageSupport()]}
      />
      {errors.length > 0 && (
        <ul className="diag errors" aria-live="polite">
          {errors.map((d, i) => (
            <li key={`${i}-${d.line}`} data-testid="diagnostic-error">
              Zeile {d.line}: {d.message}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="diag warnings" aria-live="polite">
          {warnings.map((d, i) => (
            <li key={`w-${i}-${d.line}`} data-testid="diagnostic-warning">
              Zeile {d.line}: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
