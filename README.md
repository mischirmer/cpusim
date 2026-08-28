# GdE1 Pipeline-Simulator

Ein interaktiver, taktgenauer 5-Stufen-Pipeline-Simulator für die GdE1-Lehrveranstaltung. Studierende geben GdE1-Assembly ein, simulieren Instruktion für Instruktion und sehen exakt, **wann** und **warum** ein Stall oder Flush entsteht.

![CI](https://img.shields.io/github/actions/workflow/status/mischirmer/cpusim/ci.yml?branch=main&label=CI)
![Coverage](https://img.shields.io/codecov/c/github/mischirmer/cpusim)
![TypeScript](https://img.shields.io/github/languages/top/mischirmer/cpusim)
![Letzter Commit](https://img.shields.io/github/last-commit/mischirmer/cpusim)
![Repo-Größe](https://img.shields.io/github/repo-size/mischirmer/cpusim)

![React](https://img.shields.io/badge/React-18-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![Vite](https://img.shields.io/badge/Vite-5-646cff)
![Vitest](https://img.shields.io/badge/Vitest-2-6e9f18)
![Playwright](https://img.shields.io/badge/Playwright-1-2e5f4c)
![Pipeline](https://img.shields.io/badge/5--Stufen-IF%20%7C%20ID%20%7C%20OF%20%7C%20EX%20%7C%20WB-blue)

## Funktionen

- **5-Stufen-Pipeline** (`IF` → `ID` → `OF` → `EX` → `WB`) mit taktgenauer Einzelschritt-Simulation
- **Hazards & Forwarding**: RAW-Abhängigkeiten erzeugen Stalls mit deutscher Erklärung (`SimulateDelegate`-Ebene); Forwarding löst sie per Bus auf
- **Korrigierte Timing-Semantik**:
  - Register aus `WB` sind erst **nach** dem WB-Takt lesbar (kein Same-Cycle-`WB→OF`)
  - Ein `EX`-Ergebnis ist per Forwarding erst ab dem **Folgetakt** verfügbar (kein Same-Cycle-`EX→OF`)
- **Verzweigungen**: bedingte Sprünge (`b`, `bnz`, …) mit Flush falscher Pfade und Backpressure
- **Speicher**: Big-Endian-Wortzugriff, `stw`/`ldw` mit Wort-Lese-Erklärung
- **Beispielprogramme** mit vorkonfigurierter Prozessor-Konfiguration (z. B. aktiviert das Forwarding-Beispiel den Forwarding-Schalter automatisch)
- Einbaureditor (CodeMirror), Register/Flags/ALU-Sicht, Statistik (CPI, Stalls, Forwarding-Ereignisse)

## Schnellstart

```bash
npm install
npm run dev          # http://localhost:5173
```

## Skripte

| Skript | Beschreibung |
| --- | --- |
| `npm run dev` | Vite-Entwicklungsserver |
| `npm run build` | TypeScript + Produktions-Build |
| `npm run preview` | Build lokal ansehen |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (Unit & UI-Tests) |
| `npm run test:watch` | Vitest im Watch-Modus |
| `npm run test:coverage` | Vitest mit Coverage-Report |
| `npm run test:e2e` | Playwright (End-to-End) |

## Test-Suite

- **112 Unit-/UI-Tests** (Vitest + jsdom) in `src/**/*.test.{ts,tsx}`
- **2 End-to-End-Tests** (Playwright, Chromium) in `tests/e2e.spec.ts`
- Cycle-Accurate-Regressionstests in `src/core/simulator/raw-of-timing.test.ts` sichern die Timing-Semantik
  (end-of-WB-Sichtbarkeit, Forwarding erst im Folgetakt) gegen Abweichungen ab.

### Test-Coverage

Die **live** Coverage-Anzeige oben kommt von [Codecov](https://codecov.io/gh/mischirmer/cpusim) und wird von GitHub Actions bei jedem Push/PR automatisch aktualisiert.

`npm run test:coverage` erzeugt lokal einen Report (alle Quelldateien in `src/`). Die folgende Tabelle ist eine **Momentaufnahme** von einem lokalen Lauf — maßgeblich ist stets das Live-Badge von Codecov:

| Metrik | Coverage (Snapshots) |
| --- | --- |
| **Statements** | 90.74 % |
| **Branches** | 84.82 % |
| **Functions** | 86.86 % |
| **Lines** | 90.74 % |

## Continuous Integration

GitHub Actions (`.github/workflows/ci.yml`) läuft bei jedem Push auf `main` und für Pull Requests:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test` (Vitest)
4. `npm run test:coverage` → Upload nach Codecov
5. `npm run build`
6. Playwright (Chromium) E2E

Bei E2E-Fehlern wird der Playwright-Report als Artefakt hochgeladen.

## Lizenz

Noch keine Lizenz festgelegt — für den Lehrbetrieb der GdE1-Übung freigegeben.
