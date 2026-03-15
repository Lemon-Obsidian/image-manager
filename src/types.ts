export interface ImageManagerSettings {
  quality: number;
  autoConvert: boolean;
}

export const DEFAULT_SETTINGS: ImageManagerSettings = {
  quality: 80,
  autoConvert: true,
};

// gif: animated 제외, svg: vector 제외, webp: 이미 변환됨
export const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif'];
