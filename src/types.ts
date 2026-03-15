export interface ImageManagerSettings {
  quality: number;
  autoConvert: boolean;
  outputFormat: 'webp' | 'avif';
  excludeFolders: string[];
  // Feature 1: 이미지 리사이즈
  autoResize: boolean;
  resizeMaxDimension: 1920 | 2560 | 4096;
  // Feature 2: 중복 탐지
  duplicateThreshold: number;
  // Feature 4: 외부 이미지 로컬화
  localizeSavePath: string;
  // Feature 5: Alt Text 자동 생성
  altTextEnabled: boolean;
  openaiApiKey: string;
  altTextModel: string;
  altTextMaxDimension: 256 | 512;
  altTextLanguage: string;
  // Feature 6: 파일명 정규화
  renameEnabled: boolean;
  renameMode: 'reference' | 'alttext';
  // Alt Text 실사용 누적 통계
  altTextTotalRequests: number;
  altTextTotalPromptTokens: number;
  altTextTotalCompletionTokens: number;
  altTextTotalCostWon: number;    // 호출 시점 모델 단가로 계산한 누적 비용(원)
  altTextStatsUpdatedAt: string;  // ISO 날짜 문자열
}

export const DEFAULT_SETTINGS: ImageManagerSettings = {
  quality: 80,
  autoConvert: true,
  outputFormat: 'webp',
  excludeFolders: [],
  autoResize: false,
  resizeMaxDimension: 1920,
  duplicateThreshold: 5,
  localizeSavePath: 'Attachments',
  altTextEnabled: false,
  openaiApiKey: '',
  altTextModel: 'gpt-5-nano',
  altTextMaxDimension: 512,
  altTextLanguage: '한국어',
  renameEnabled: false,
  renameMode: 'reference',
  altTextTotalRequests: 0,
  altTextTotalPromptTokens: 0,
  altTextTotalCompletionTokens: 0,
  altTextTotalCostWon: 0,
  altTextStatsUpdatedAt: '',
};

// 포맷 변환 대상 (gif/svg/webp/avif 제외)
export const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'heic', 'heif'];

// alt text 생성 / 파일명 정규화 / 중복 탐지 대상 (변환 결과물 webp/avif 포함)
export const ALL_IMAGE_EXTENSIONS = [...SUPPORTED_EXTENSIONS, 'webp', 'avif'];
