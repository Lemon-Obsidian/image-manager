import { App, TFile } from 'obsidian';
import { getImageDataFromFile } from './ImageConverter';

// 64비트 해시를 두 개의 32비트 숫자로 표현 (BigInt ES2018 미지원 우회)
export interface PHash {
  lo: number; // bit 0~31
  hi: number; // bit 32~63
}

export interface DuplicateGroup {
  files: TFile[];
  hashes: PHash[];
}

function popcount(n: number): number {
  n = n >>> 0;
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  n = (n + (n >> 4)) & 0x0f0f0f0f;
  return ((n * 0x01010101) >>> 24) >>> 0;
}

class UnionFind {
  private parent: Map<number, number> = new Map();

  find(x: number): number {
    if (!this.parent.has(x)) return x;
    const root = this.find(this.parent.get(x)!);
    this.parent.set(x, root);
    return root;
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) this.parent.set(rx, ry);
  }
}

export class DuplicateDetector {
  constructor(private app: App) {}

  async detectDuplicates(
    files: TFile[],
    threshold: number,
    onProgress: (current: number, total: number) => void
  ): Promise<DuplicateGroup[]> {
    const hashes: PHash[] = [];

    for (let i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length);
      hashes.push(await this.computeHash(files[i]));
    }

    const uf = new UnionFind();
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        if (DuplicateDetector.hammingDistance(hashes[i], hashes[j]) <= threshold) {
          uf.union(i, j);
        }
      }
    }

    const groups = new Map<number, number[]>();
    for (let i = 0; i < files.length; i++) {
      const root = uf.find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(i);
    }

    return Array.from(groups.values())
      .filter((indices) => indices.length >= 2)
      .map((indices) => ({
        files: indices.map((i) => files[i]),
        hashes: indices.map((i) => hashes[i]),
      }));
  }

  async computeHash(file: TFile): Promise<PHash> {
    const arrayBuffer = await this.app.vault.readBinary(file);
    const imageData = await getImageDataFromFile(arrayBuffer, file.extension);
    return this.computePHashFromImageData(imageData);
  }

  private computePHashFromImageData(imageData: ImageData): PHash {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = imageData.width;
    srcCanvas.height = imageData.height;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.putImageData(imageData, 0, 0);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = 8;
    dstCanvas.height = 8;
    const dstCtx = dstCanvas.getContext('2d')!;
    dstCtx.drawImage(srcCanvas, 0, 0, 8, 8);

    const smallData = dstCtx.getImageData(0, 0, 8, 8);

    const grays: number[] = [];
    for (let i = 0; i < 64; i++) {
      const r = smallData.data[i * 4];
      const g = smallData.data[i * 4 + 1];
      const b = smallData.data[i * 4 + 2];
      grays.push(0.299 * r + 0.587 * g + 0.114 * b);
    }

    const avg = grays.reduce((a, b) => a + b, 0) / 64;

    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 64; i++) {
      if (grays[i] >= avg) {
        if (i < 32) {
          lo = (lo | (1 << i)) >>> 0;
        } else {
          hi = (hi | (1 << (i - 32))) >>> 0;
        }
      }
    }

    return { lo, hi };
  }

  static hammingDistance(a: PHash, b: PHash): number {
    return popcount(a.lo ^ b.lo) + popcount(a.hi ^ b.hi);
  }
}
