interface Props {
  cycle: number;
  maxCycle: number;
  playing: boolean;
  onCycle: (c: number) => void;
  onPlayToggle: () => void;
  onReset: () => void;
}

export function CycleControls({ cycle, maxCycle, playing, onCycle, onPlayToggle, onReset }: Props) {
  return (
    <div className="cycle-controls">
      <button onClick={onReset} disabled={cycle === 0}>
        Zurücksetzen
      </button>
      <button onClick={() => onCycle(Math.max(0, cycle - 1))} disabled={cycle <= 0}>
        ‹ Zurück
      </button>
      <button onClick={onPlayToggle} disabled={maxCycle < 1}>
        {playing ? "Pause" : "Abspielen"}
      </button>
      <button onClick={() => onCycle(Math.min(maxCycle, cycle + 1))} disabled={cycle >= maxCycle}>
        Weiter ›
      </button>
      <input
        type="range"
        min={0}
        max={maxCycle}
        value={cycle}
        aria-label="Takt auswählen"
        onChange={(e) => onCycle(Number(e.target.value))}
      />
      <span className="cycle-indicator" data-testid="cycle-indicator" aria-live="polite" aria-atomic="true">
        Takt {cycle} / {maxCycle}
      </span>
    </div>
  );
}
