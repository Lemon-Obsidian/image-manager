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
  altTextPrompt: string;
  altTextContextLines: number;  // 이미지 위아래 문맥 줄 수 (0: 비활성)
  altTextOverwrite: boolean;    // true: 이미 alt text가 있어도 덮어쓰기
  altTextMaxCompletionTokens: number;
  // Feature 6: 파일명 정규화
  renameEnabled: boolean;
  renameMode: 'reference' | 'alttext';
  // Alt Text 실사용 누적 통계
  altTextTotalRequests: number;
  altTextTotalPromptTokens: number;
  altTextTotalCompletionTokens: number;
  altTextTotalCostWon: number;    // 호출 시점 모델 단가로 계산한 누적 비용(원)
  altTextStatsUpdatedAt: string;  // ISO 날짜 문자열
  // Alt Text 자동 파일명 변경 (생성된 alt text로 rename)
  altTextAutoRename: boolean;
  // Alt Text 히스토리
  altTextHistory: AltTextHistoryRecord[];
}

export interface AltTextHistoryRecord {
  fileName: string;
  filePath: string;     // rename 후 최종 경로 (이미지 렌더링용)
  altText: string;
  model: string;
  timestamp: string;    // ISO 날짜 문자열
  promptTokens: number;
  completionTokens: number;
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
  altTextAutoRename: true,
  altTextPrompt: '이 이미지에 대한 간결한 alt text를 {language}로 작성해주세요. 이미지를 설명하는 짧은 문장 하나로만 답변하세요.',
  altTextContextLines: 0,
  altTextOverwrite: false,
  altTextMaxCompletionTokens: 1000,
  altTextHistory: [],
};

// 포맷 변환 대상 (gif/svg/webp/avif 제외)
export const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'heic', 'heif'];

// alt text 생성 / 파일명 정규화 / 중복 탐지 대상 (변환 결과물 webp/avif 포함)
export const ALL_IMAGE_EXTENSIONS = [...SUPPORTED_EXTENSIONS, 'webp', 'avif'];
