import { WORD_MASK } from "../isa/registers";

export function parseNumber(text: string): { value: number; ok: boolean } {
  const t = text.trim().toLowerCase();
  if (t.startsWith("0x")) {
    const n = Number.parseInt(t.slice(2), 16);
    return Number.isNaN(n) ? { value: 0, ok: false } : { value: n, ok: true };
  }
  if (t.startsWith("0b")) {
    if (!/^[01]+$/.test(t.slice(2))) return { value: 0, ok: false };
    const n = Number.parseInt(t.slice(2), 2);
    return { value: n, ok: true };
  }
  if (/^-?\d+$/.test(t)) {
    return { value: Number(t), ok: true };
  }
  return { value: 0, ok: false };
}

export function formatImmediate(n: number): string {
  const u = n & WORD_MASK;
  return u >= 0x8000 ? String(u - 0x10000) : String(u);
}
