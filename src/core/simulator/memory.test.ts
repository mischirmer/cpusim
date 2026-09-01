import { describe, it, expect } from "vitest";
import { MemoryState } from "./memory";

describe("MemoryState — byte access", () => {
  it("reads zero for uninitialized addresses", () => {
    const m = new MemoryState();
    expect(m.readByte(0x0000)).toBe(0);
    expect(m.readByte(0xffff)).toBe(0);
  });

  it("stores and masks bytes to uint8", () => {
    const m = new MemoryState();
    m.writeByte(0x1000, 0xff);
    m.writeByte(0x1001, 0x1ff);
    expect(m.readByte(0x1000)).toBe(0xff);
    expect(m.readByte(0x1001)).toBe(0xff);
  });

  it("initial memory is copied and masked", () => {
    const init = new Map([[0x0005, 0x345]]);
    const m = new MemoryState(init);
    expect(m.readByte(0x0005)).toBe(0x45);
  });

  it("wraps addresses to 16 bits", () => {
    const m = new MemoryState();
    m.writeByte(0x10000, 0xab);
    expect(m.readByte(0x0000)).toBe(0xab);
  });
});

describe("MemoryState — big-endian words (MSB first)", () => {
  it("stores a word high byte first", () => {
    const m = new MemoryState();
    m.writeWord(0x1000, 0x1234);
    expect(m.readByte(0x1000)).toBe(0x12);
    expect(m.readByte(0x1001)).toBe(0x34);
    expect(m.readWord(0x1000)).toBe(0x1234);
  });

  it("reads a word MSB-first from raw bytes", () => {
    const m = new MemoryState(new Map([[0x2000, 0xab], [0x2001, 0xcd]]));
    expect(m.readWord(0x2000)).toBe(0xabcd);
  });

  it("reads 0x1234 from bytes 0x12 0x34 at 0x1000", () => {
    const m = new MemoryState(new Map([[0x1000, 0x12], [0x1001, 0x34]]));
    expect(m.readWord(0x1000)).toBe(0x1234);
  });

  it("wraps word value to uint16", () => {
    const m = new MemoryState();
    m.writeWord(0x0000, 0x1abcd);
    expect(m.readWord(0x0000)).toBe(0xabcd);
  });

  it("stores 0xabcd at 0x1000 as 0xab then 0xcd", () => {
    const m = new MemoryState();
    m.writeWord(0x1000, 0xabcd);
    expect(m.readByte(0x1000)).toBe(0xab);
    expect(m.readByte(0x1001)).toBe(0xcd);
  });

  it("exposes entries", () => {
    const m = new MemoryState();
    m.writeByte(0x0005, 0x10);
    m.writeByte(0x0006, 0x20);
    const e = new Map(m.entries());
    expect(e.get(0x0005)).toBe(0x10);
    expect(e.get(0x0006)).toBe(0x20);
  });
});
