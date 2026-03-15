export function convertToWebP(
  arrayBuffer: ArrayBuffer,
  quality: number
): Promise<ArrayBuffer> {
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
