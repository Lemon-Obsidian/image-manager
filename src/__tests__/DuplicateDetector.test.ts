// AVIF WASM / DOM canvas 의존성 차단
jest.mock('../ImageConverter', () => ({
  getImageDataFromFile: jest.fn(),
}));

import { DuplicateDetector, PHash } from '../DuplicateDetector';

describe('DuplicateDetector.hammingDistance', () => {
  const d = DuplicateDetector.hammingDistance;

  it('동일 해시 → 0', () => {
    const h: PHash = { lo: 0xabcdef12, hi: 0x12345678 };
    expect(d(h, h)).toBe(0);
  });

  it('lo에서 1비트 차이 → 1', () => {
    const a: PHash = { lo: 0b0001, hi: 0 };
    const b: PHash = { lo: 0b0000, hi: 0 };
    expect(d(a, b)).toBe(1);
  });

  it('hi에서 1비트 차이 → 1', () => {
    const a: PHash = { lo: 0, hi: 0b0001 };
    const b: PHash = { lo: 0, hi: 0b0000 };
    expect(d(a, b)).toBe(1);
  });

  it('lo 전체 비트 반전 → 32', () => {
    const a: PHash = { lo: 0xffffffff, hi: 0 };
    const b: PHash = { lo: 0x00000000, hi: 0 };
    expect(d(a, b)).toBe(32);
  });

  it('hi 전체 비트 반전 → 32', () => {
    const a: PHash = { lo: 0, hi: 0xffffffff };
    const b: PHash = { lo: 0, hi: 0x00000000 };
    expect(d(a, b)).toBe(32);
  });

  it('lo + hi 전체 비트 반전 → 64', () => {
    const a: PHash = { lo: 0xffffffff, hi: 0xffffffff };
    const b: PHash = { lo: 0x00000000, hi: 0x00000000 };
    expect(d(a, b)).toBe(64);
  });

  it('대칭성: d(a,b) === d(b,a)', () => {
    const a: PHash = { lo: 0xdeadbeef, hi: 0xcafebabe };
    const b: PHash = { lo: 0x12345678, hi: 0x87654321 };
    expect(d(a, b)).toBe(d(b, a));
  });

  it('삼각 부등식: d(a,c) <= d(a,b) + d(b,c)', () => {
    const a: PHash = { lo: 0b1111, hi: 0 };
    const b: PHash = { lo: 0b1100, hi: 0 };
    const c: PHash = { lo: 0b0000, hi: 0 };
    expect(d(a, c)).toBeLessThanOrEqual(d(a, b) + d(b, c));
  });

  it('threshold=5 이내는 중복으로 판단할 수 있어야 함', () => {
    const base: PHash = { lo: 0xffffffff, hi: 0xffffffff };
    // lo에서 5비트만 0으로 바꿈
    const similar: PHash = { lo: base.lo ^ 0b11111, hi: base.hi };
    expect(d(base, similar)).toBe(5);
    expect(d(base, similar)).toBeLessThanOrEqual(5);
  });
});
