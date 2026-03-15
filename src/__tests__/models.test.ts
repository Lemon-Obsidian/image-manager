import {
  estimateImageTokens,
  calculateCostWon,
  estimateCostPerImageWon,
  EXCHANGE_RATE_KRW,
  MODEL_CONFIGS,
  KNOWN_MODELS,
  AVG_OUTPUT_TOKENS,
} from '../models';

// ─── estimateImageTokens ─────────────────────────────────────────────────────

describe('estimateImageTokens — 패치 방식 (gpt-5-nano, multiplier=2.46, budget=1536)', () => {
  it('256px 정사각형: 8×8=64 패치 → 64×2.46=157', () => {
    expect(estimateImageTokens(256, 'gpt-5-nano')).toBe(Math.round(64 * 2.46));
  });

  it('512px 정사각형: 16×16=256 패치 → 256×2.46=630', () => {
    expect(estimateImageTokens(512, 'gpt-5-nano')).toBe(Math.round(256 * 2.46));
  });

  it('32px 정사각형: 1×1=1 패치 → 1×2.46=2', () => {
    expect(estimateImageTokens(32, 'gpt-5-nano')).toBe(Math.round(1 * 2.46));
  });

  it('예산(1536) 초과하지 않으면 그대로 사용', () => {
    // 1024px: 32×32=1024 패치 < 1536 → 1024×2.46
    expect(estimateImageTokens(1024, 'gpt-5-nano')).toBe(Math.round(1024 * 2.46));
  });
});

describe('estimateImageTokens — 패치 방식 (gpt-5-mini, multiplier=1.62)', () => {
  it('256px: 64 패치 → 64×1.62=104', () => {
    expect(estimateImageTokens(256, 'gpt-5-mini')).toBe(Math.round(64 * 1.62));
  });

  it('512px: 256 패치 → 256×1.62=414', () => {
    expect(estimateImageTokens(512, 'gpt-5-mini')).toBe(Math.round(256 * 1.62));
  });
});

describe('estimateImageTokens — 타일 방식 (gpt-4o-mini, baseTiles=2833)', () => {
  it('256px 이하 소형 이미지 → low detail = 2833', () => {
    expect(estimateImageTokens(256, 'gpt-4o-mini')).toBe(2833);
  });

  it('512px 이하 소형 이미지 → low detail = 2833', () => {
    expect(estimateImageTokens(512, 'gpt-4o-mini')).toBe(2833);
  });
});

describe('estimateImageTokens — 알 수 없는 모델은 gpt-4o-mini 폴백', () => {
  it('unknown-model → gpt-4o-mini 결과와 동일', () => {
    expect(estimateImageTokens(256, 'unknown-model')).toBe(
      estimateImageTokens(256, 'gpt-4o-mini')
    );
  });
});

// ─── calculateCostWon ────────────────────────────────────────────────────────

describe('calculateCostWon', () => {
  it('gpt-5-nano: 입력 1M 토큰 = 0.05$ × 1500원 = 75원', () => {
    expect(calculateCostWon(1_000_000, 0, 'gpt-5-nano')).toBeCloseTo(
      (1_000_000 * 0.05 * EXCHANGE_RATE_KRW) / 1_000_000,
      5
    );
  });

  it('gpt-5-nano: 출력 1M 토큰 = 0.40$ × 1500원 = 600원', () => {
    expect(calculateCostWon(0, 1_000_000, 'gpt-5-nano')).toBeCloseTo(
      (1_000_000 * 0.4 * EXCHANGE_RATE_KRW) / 1_000_000,
      5
    );
  });

  it('gpt-4o-mini: 입력 단가 $0.15/1M', () => {
    expect(calculateCostWon(1_000_000, 0, 'gpt-4o-mini')).toBeCloseTo(
      (1_000_000 * 0.15 * EXCHANGE_RATE_KRW) / 1_000_000,
      5
    );
  });

  it('입력 0, 출력 0 → 비용 0', () => {
    expect(calculateCostWon(0, 0, 'gpt-5-nano')).toBe(0);
  });
});

// ─── estimateCostPerImageWon ─────────────────────────────────────────────────

describe('estimateCostPerImageWon', () => {
  it('gpt-5-nano < gpt-4o-mini (256px 기준 패치 방식이 훨씬 저렴)', () => {
    const nano = estimateCostPerImageWon(256, 'gpt-5-nano');
    const mini = estimateCostPerImageWon(256, 'gpt-4o-mini');
    expect(nano).toBeLessThan(mini);
  });

  it('동일 모델에서 512px > 256px (패치 수 증가)', () => {
    const small = estimateCostPerImageWon(256, 'gpt-5-nano');
    const large = estimateCostPerImageWon(512, 'gpt-5-nano');
    expect(large).toBeGreaterThan(small);
  });

  it('gpt-4o-mini는 512px도 동일 (low detail 고정)', () => {
    expect(estimateCostPerImageWon(256, 'gpt-4o-mini')).toBe(
      estimateCostPerImageWon(512, 'gpt-4o-mini')
    );
  });
});

// ─── MODEL_CONFIGS 단가 검증 ─────────────────────────────────────────────────

describe('MODEL_CONFIGS 단가 (사용자 제공 스펙과 일치)', () => {
  const cases: Array<[string, number, number, number]> = [
    ['gpt-5-nano',   0.05, 0.01, 0.40],
    ['gpt-5-mini',   0.25, 0.03, 2.00],
    ['gpt-4.1-nano', 0.10, 0.03, 0.40],
    ['gpt-4.1-mini', 0.40, 0.10, 1.60],
    ['gpt-4o-mini',  0.15, 0.08, 0.60],
  ];

  it.each(cases)('%s 단가 검증', (id, input, cached, output) => {
    const cfg = MODEL_CONFIGS[id as keyof typeof MODEL_CONFIGS];
    expect(cfg.inputPricePerM).toBe(input);
    expect(cfg.cachedPricePerM).toBe(cached);
    expect(cfg.outputPricePerM).toBe(output);
  });

  it('5개 모델 모두 KNOWN_MODELS에 존재', () => {
    expect(KNOWN_MODELS).toHaveLength(5);
    for (const id of KNOWN_MODELS) {
      expect(MODEL_CONFIGS[id]).toBeDefined();
    }
  });
});
