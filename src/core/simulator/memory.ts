export class MemoryState {
  private bytes = new Map<number, number>();

  constructor(initial?: Map<number, number>) {
    if (initial) for (const [k, v] of initial) this.bytes.set(k, v & 0xff);
  }

  clone(): MemoryState {
    return new MemoryState(new Map(this.bytes));
  }

  readByte(addr: number): number {
    return this.bytes.get(addr & 0xffff) ?? 0;
  }

  writeByte(addr: number, value: number): void {
    this.bytes.set(addr & 0xffff, value & 0xff);
  }

  // big-endian
  readWord(addr: number): number {
    const hi = this.readByte(addr);
    const lo = this.readByte(addr + 1);
    return ((hi << 8) | lo) & 0xffff;
  }

  writeWord(addr: number, value: number): void {
    this.writeByte(addr, (value >> 8) & 0xff);
    this.writeByte(addr + 1, value & 0xff);
  }

  entries(): Array<[number, number]> {
    return [...this.bytes.entries()];
  }
}
