export interface ModelConfig {
  displayName: string;
  inputPricePerM: number;   // $/1M input tokens
  cachedPricePerM: number;  // $/1M cached input tokens
  outputPricePerM: number;  // $/1M output tokens
  isReasoning?: boolean;    // 내부 reasoning 토큰 소비 모델 여부
  tokenMethod: 'patch' | 'tile';
  // patch-based (gpt-5-nano, gpt-5-mini, gpt-4.1-nano, gpt-4.1-mini)
  patchBudget?: number;
  patchMultiplier?: number;
  // tile-based (gpt-4o-mini)
  baseTiles?: number;   // low detail 고정 비용
  tileCost?: number;    // high detail 타일당 추가 비용
}

export const KNOWN_MODELS = [
  'gpt-5-nano',
  'gpt-5-mini',
  'gpt-4.1-nano',
  'gpt-4.1-mini',
  'gpt-4o-mini',
] as const;
export type KnownModelId = (typeof KNOWN_MODELS)[number];

export const MODEL_CONFIGS: Record<KnownModelId, ModelConfig> = {
  'gpt-5-nano': {
    displayName: 'GPT-5 nano',
    inputPricePerM: 0.05,
    cachedPricePerM: 0.01,
    outputPricePerM: 0.40,
    isReasoning: true,
    tokenMethod: 'patch',
    patchBudget: 1536,
    patchMultiplier: 2.46,
  },
  'gpt-5-mini': {
    displayName: 'GPT-5 mini',
    inputPricePerM: 0.25,
    cachedPricePerM: 0.03,
    outputPricePerM: 2.00,
    isReasoning: true,
    tokenMethod: 'patch',
    patchBudget: 1536,
    patchMultiplier: 1.62,
  },
  'gpt-4.1-nano': {
    displayName: 'GPT-4.1 nano',
    inputPricePerM: 0.10,
    cachedPricePerM: 0.03,
    outputPricePerM: 0.40,
    tokenMethod: 'patch',
    patchBudget: 1536,
    patchMultiplier: 2.46,
  },
  'gpt-4.1-mini': {
    displayName: 'GPT-4.1 mini',
    inputPricePerM: 0.40,
    cachedPricePerM: 0.10,
    outputPricePerM: 1.60,
    tokenMethod: 'patch',
    patchBudget: 1536,
    patchMultiplier: 1.62,
  },
  'gpt-4o-mini': {
    displayName: 'GPT-4o mini',
    inputPricePerM: 0.15,
    cachedPricePerM: 0.08,
    outputPricePerM: 0.60,
    tokenMethod: 'tile',
    baseTiles: 2833,
    tileCost: 5667,
  },
};

export const EXCHANGE_RATE_KRW = 1500;          // 환율 1,500원/$
export const AVG_OUTPUT_TOKENS = 20;            // 일반 모델 평균 출력 토큰 (한 문장 alt text)
export const AVG_OUTPUT_TOKENS_REASONING = 400; // 추론 모델 평균 완료 토큰 (reasoning 포함)

/**
 * 이미지 크기(maxDimension px 정사각형 기준)와 모델로 예상 입력 토큰 수 계산.
 *
 * 패치 방식 (gpt-5-nano 계열):
 *   - 32px × 32px 패치로 커버, 예산 초과 시 비율 유지 축소
 *   - resized_patch_count × model_multiplier
 *
 * 타일 방식 (gpt-4o-mini):
 *   - 소형 이미지(≤512px)는 low detail → base tokens 고정
 *   - 대형 이미지는 high detail 타일 계산
 */
export function estimateImageTokens(maxDimension: number, modelId: string): number {
  const config = MODEL_CONFIGS[modelId as KnownModelId] ?? MODEL_CONFIGS['gpt-4o-mini'];
  const w = maxDimension;
  const h = maxDimension;

  if (config.tokenMethod === 'patch') {
    const budget = config.patchBudget!;
    const mult = config.patchMultiplier!;
    const originalPatches = Math.ceil(w / 32) * Math.ceil(h / 32);

    if (originalPatches <= budget) {
      return Math.round(originalPatches * mult);
    }

    // 예산 초과 → 축소
    const shrink = Math.sqrt((32 * 32 * budget) / (w * h));
    const wShrink = w * shrink;
    const hShrink = h * shrink;
    const adjusted = shrink * Math.min(
      Math.floor(wShrink / 32) / (wShrink / 32),
      Math.floor(hShrink / 32) / (hShrink / 32)
    );
    const rw = Math.round(w * adjusted);
    const rh = Math.round(h * adjusted);
    const patches = Math.min(Math.ceil(rw / 32) * Math.ceil(rh / 32), budget);
    return Math.round(patches * mult);
  }

  // 타일 방식 (gpt-4o-mini)
  if (maxDimension <= 512) {
    // 소형 이미지 → auto가 low detail 선택
    return config.baseTiles!;
  }
  // 대형 이미지 → high detail
  let tw = w;
  let th = h;
  // 2048px 박스에 맞추기
  const s1 = Math.min(1, 2048 / tw, 2048 / th);
  tw = Math.round(tw * s1);
  th = Math.round(th * s1);
  // shortest side ≥ 768px
  const shortest = Math.min(tw, th);
  if (shortest < 768) {
    const s2 = 768 / shortest;
    tw = Math.round(tw * s2);
    th = Math.round(th * s2);
  }
  const tiles = Math.ceil(tw / 512) * Math.ceil(th / 512);
  return config.baseTiles! + tiles * config.tileCost!;
}

/**
 * 실제 사용된 토큰으로 비용(원) 계산.
 * 알 수 없는 모델은 gpt-4o-mini 단가로 폴백.
 */
export function calculateCostWon(
  promptTokens: number,
  completionTokens: number,
  modelId: string
): number {
  const config = MODEL_CONFIGS[modelId as KnownModelId] ?? MODEL_CONFIGS['gpt-4o-mini'];
  const input = (promptTokens * config.inputPricePerM * EXCHANGE_RATE_KRW) / 1_000_000;
  const output = (completionTokens * config.outputPricePerM * EXCHANGE_RATE_KRW) / 1_000_000;
  return input + output;
}

/** 이미지 1장당 예상 비용(원). 추론 모델은 AVG_OUTPUT_TOKENS_REASONING 적용. */
export function estimateCostPerImageWon(maxDimension: number, modelId: string): number {
  const config = MODEL_CONFIGS[modelId as KnownModelId] ?? MODEL_CONFIGS['gpt-4o-mini'];
  const inputTokens = estimateImageTokens(maxDimension, modelId);
  const avgOut = config.isReasoning ? AVG_OUTPUT_TOKENS_REASONING : AVG_OUTPUT_TOKENS;
  return calculateCostWon(inputTokens, avgOut, modelId);
}
