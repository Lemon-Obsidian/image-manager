import avifEncFactory from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions as avifDefaultOptions } from '@jsquash/avif/meta.js';
import avifEncWasm from '@jsquash/avif/codec/enc/avif_enc.wasm';
import heic2any from 'heic2any';

type AvifModule = {
  encode(data: BufferSource, width: number, height: number, options: object): Uint8Array | null;
};

let avifModule: AvifModule | null = null;

async function ensureAvifEncoder(): Promise<void> {
  if (avifModule) return;

  // WASM 바이너리를 비동기로 컴파일한 뒤 instantiateWasm으로 주입 (fetch 우회)
  const compiled = await WebAssembly.compile(avifEncWasm);
  avifModule = await (avifEncFactory as unknown as (opts: object) => Promise<AvifModule>)({
    noInitialRun: true,
    instantiateWasm: (
      imports: WebAssembly.Imports,
      callback: (instance: WebAssembly.Instance) => void
    ) => {
      WebAssembly.instantiate(compiled, imports).then((instance) => callback(instance));
      return {};
    },
  });
}

async function decodeHeic(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const blob = new Blob([arrayBuffer], { type: 'image/heic' });
  const result = await heic2any({ blob, toType: 'image/png' });
  const png = Array.isArray(result) ? result[0] : result;
  return png.arrayBuffer();
}

function getImageData(arrayBuffer: ArrayBuffer): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context를 가져올 수 없습니다.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 로드에 실패했습니다.'));
    };

    img.src = url;
  });
}

function encodeWebP(arrayBuffer: ArrayBuffer, quality: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context를 가져올 수 없습니다.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (result) => {
          if (!result) {
            reject(new Error('WebP 변환에 실패했습니다.'));
            return;
          }
          result.arrayBuffer().then(resolve).catch(reject);
        },
        'image/webp',
        quality / 100
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 로드에 실패했습니다.'));
    };

    img.src = url;
  });
}

async function encodeAvif(arrayBuffer: ArrayBuffer, quality: number): Promise<ArrayBuffer> {
  await ensureAvifEncoder();
  const imageData = await getImageData(arrayBuffer);
  const options = { ...avifDefaultOptions, quality };
  const result = avifModule!.encode(
    imageData.data,
    imageData.width,
    imageData.height,
    options
  );
  if (!result) throw new Error('AVIF 변환에 실패했습니다.');
  return result.buffer;
}

export async function convertImage(
  arrayBuffer: ArrayBuffer,
  extension: string,
  format: 'webp' | 'avif',
  quality: number
): Promise<ArrayBuffer> {
  const ext = extension.toLowerCase();

  // HEIC/HEIF는 먼저 PNG로 디코딩
  let buffer = arrayBuffer;
  if (ext === 'heic' || ext === 'heif') {
    buffer = await decodeHeic(arrayBuffer);
  }

  return format === 'avif'
    ? encodeAvif(buffer, quality)
    : encodeWebP(buffer, quality);
}
