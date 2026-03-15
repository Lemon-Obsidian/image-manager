import { formatBytes, formatReduction } from '../utils';

describe('formatBytes', () => {
  it('1023B 이하는 B 단위', () => {
    expect(formatBytes(0)).toBe('0B');
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1023)).toBe('1023B');
  });

  it('1KB ~ 1MB 미만은 KB 단위 (소수점 1자리)', () => {
    expect(formatBytes(1024)).toBe('1.0KB');
    expect(formatBytes(1536)).toBe('1.5KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0KB');
  });

  it('1MB 이상은 MB 단위 (소수점 1자리)', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0MB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5MB');
  });
});

describe('formatReduction', () => {
  it('50% 절감', () => {
    expect(formatReduction(1000, 500)).toBe('1000B → 500B (-50%)');
  });

  it('25% 절감', () => {
    expect(formatReduction(2048, 1536)).toBe('2.0KB → 1.5KB (-25%)');
  });

  it('0% 절감 (동일 크기)', () => {
    expect(formatReduction(1000, 1000)).toBe('1000B → 1000B (-0%)');
  });

  it('반올림 처리', () => {
    // 1 - 666/1000 = 0.334 → 33%
    expect(formatReduction(1000, 666)).toBe('1000B → 666B (-33%)');
  });
});
