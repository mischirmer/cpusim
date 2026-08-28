export const WORD_MASK = 0xffff;
export const WORD_BITS = 16;

export function toU16(n: number): number {
  return n & WORD_MASK;
}

export function toI16(n: number): number {
  const u = toU16(n);
  return u >= 0x8000 ? u - 0x10000 : u;
}

export function formatHex(n: number): string {
  return "0x" + toU16(n).toString(16).toUpperCase().padStart(4, "0");
}
