import { App, TFile } from 'obsidian';
import { ALL_IMAGE_EXTENSIONS } from './types';

export interface BrokenLink {
  mdFile: TFile;
  original: string;   // 원본 링크 전체 문자열
  ref: string;        // 참조 경로/이름
  alt: string;        // alt text
  isWikilink: boolean;
}

function hasImageExtension(ref: string): boolean {
  const clean = ref.split('?')[0].split('#')[0];
  const ext = clean.split('.').pop()?.toLowerCase() ?? '';
  return ALL_IMAGE_EXTENSIONS.includes(ext);
}

export class BrokenLinkFinder {
  constructor(private app: App) {}

  async findAll(): Promise<BrokenLink[]> {
    const mdFiles = this.app.vault.getFiles().filter((f) => f.extension === 'md');
    const results: BrokenLink[] = [];

    for (const mdFile of mdFiles) {
      const content = await this.app.vault.read(mdFile);
      results.push(...this.extractBroken(content, mdFile));
    }
    return results;
  }

  private extractBroken(content: string, mdFile: TFile): BrokenLink[] {
    const links: BrokenLink[] = [];
    const seen = new Set<string>();

    // ![[ref]] 또는 ![[ref|alt]]
    const wikilinkRe = /!\[\[([^\]|]+?)(\|[^\]]*)?]]/g;
    let m: RegExpExecArray | null;
    while ((m = wikilinkRe.exec(content)) !== null) {
      const ref = m[1].trim();
      const alt = m[2] ? m[2].slice(1).trim() : '';
      if (!hasImageExtension(ref)) continue;
      const key = `${mdFile.path}::${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = this.app.metadataCache.getFirstLinkpathDest(ref, mdFile.path);
      if (!resolved) {
        links.push({ mdFile, original: m[0], ref, alt, isWikilink: true });
      }
    }

    // ![alt](ref)
    const standardRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((m = standardRe.exec(content)) !== null) {
      const ref = m[2].trim();
      if (ref.startsWith('http')) continue;
      if (!hasImageExtension(ref)) continue;
      const key = `${mdFile.path}::${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = this.app.metadataCache.getFirstLinkpathDest(ref, mdFile.path);
      if (!resolved) {
        links.push({ mdFile, original: m[0], ref, alt: m[1], isWikilink: false });
      }
    }

    return links;
  }

  /** 파일명 유사도로 후보 정렬 (0~3점) */
  static rankCandidates(ref: string, candidates: TFile[]): TFile[] {
    const baseName = ref.split('/').pop()?.replace(/\.[^.]+$/, '').toLowerCase() ?? '';
    return [...candidates]
      .map((f) => {
        const fb = f.basename.toLowerCase();
        let score = 0;
        if (fb === baseName) score = 3;
        else if (fb.startsWith(baseName) || baseName.startsWith(fb)) score = 2;
        else if (fb.includes(baseName) || baseName.includes(fb)) score = 1;
        return { file: f, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.file);
  }
}
