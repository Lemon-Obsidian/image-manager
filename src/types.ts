export interface ImageManagerSettings {
  quality: number;
  autoConvert: boolean;
  outputFormat: 'webp' | 'avif';
  excludeFolders: string[];
}

export const DEFAULT_SETTINGS: ImageManagerSettings = {
  quality: 80,
  autoConvert: true,
  outputFormat: 'webp',
  excludeFolders: [],
};

// gif: animated 제외, svg: vector 제외
// webp/avif: 이미 변환된 포맷이지만 다른 포맷으로 재변환 허용
export const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'heic', 'heif'];
