import { App, TFile } from 'obsidian';
import { ImageManagerSettings } from './types';
import { CancellationToken, isLayoutModifier } from './utils';

export class FileNameNormalizer {
  constructor(
    private app: App,
    private settings: ImageManagerSettings
  ) {}

  async normalizeAll(
    files: TFile[],
    onProgress: (current: number, total: number) => void,
    token?: CancellationToken
  ): Promise<{ renamed: number; skipped: number; failed: number; cancelled: boolean; errors: string[] }> {
    const results = { renamed: 0, skipped: 0, failed: 0, cancelled: false, errors: [] as string[] };

    for (let i = 0; i < files.length; i++) {
      if (token?.cancelled) { results.cancelled = true; break; }
      onProgress(i + 1, files.length);
      try {
        const renamed = await this.normalizeFile(files[i]);
        if (renamed) {
          results.renamed++;
        } else {
          results.skipped++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`FileNameNormalizer: 실패 (${files[i].name})`, e);
        results.errors.push(`${files[i].name}: ${msg}`);
        results.failed++;
      }
    }

    return results;
  }

  async normalizeFile(file: TFile): Promise<boolean> {
    const targetBaseName = await this.resolveTargetBaseName(file);
    if (!targetBaseName) return false;

    const normalized = FileNameNormalizer.normalizeString(targetBaseName);
    if (!normalized) return false;

    // 이미 같은 이름이면 스킵
    if (file.basename === normalized) return false;

    const dir = file.parent?.path ?? '';
    const ext = file.extension;

    // 충돌 방지: -1, -2 suffix
    let finalPath = dir ? `${dir}/${normalized}.${ext}` : `${normalized}.${ext}`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(finalPath) && counter < 100) {
      const suffixed = `${normalized}-${counter}`;
      finalPath = dir ? `${dir}/${suffixed}.${ext}` : `${suffixed}.${ext}`;
      counter++;
    }

    // fileManager.renameFile은 링크도 자동 업데이트
    await this.app.fileManager.renameFile(file, finalPath);
    return true;
  }

  private async resolveTargetBaseName(file: TFile): Promise<string | null> {
    if (this.settings.renameMode === 'alttext') {
      return this.findAltTextBaseName(file);
    }
    return this.findReferenceBaseName(file);
  }

  private findReferenceBaseName(file: TFile): string | null {
    const { resolvedLinks } = this.app.metadataCache;
    for (const [notePath, links] of Object.entries(resolvedLinks)) {
      if (file.path in links) {
        const noteFile = this.app.vault.getAbstractFileByPath(notePath);
        if (noteFile instanceof TFile) {
          return noteFile.basename;
        }
      }
    }
    return null;
  }

  private async findAltTextBaseName(file: TFile): Promise<string | null> {
    const { resolvedLinks } = this.app.metadataCache;
    for (const [notePath, links] of Object.entries(resolvedLinks)) {
      if (!(file.path in links)) continue;
      const noteFile = this.app.vault.getAbstractFileByPath(notePath);
      if (!(noteFile instanceof TFile)) continue;

      const content = await this.app.vault.read(noteFile);
      const alt = this.extractAltText(content, file.path, file.name);
      if (alt) return alt;
    }
    return null;
  }

  private extractAltText(content: string, filePath: string, fileName: string): string | null {
    // ![[path|alt]] 또는 ![[name|alt]]
    const wikilinkWithAlt = /!\[\[([^\]|]+)\|([^\]]+)\]\]/g;
    let match;
    while ((match = wikilinkWithAlt.exec(content)) !== null) {
      const ref = match[1].trim();
      const pipeVal = match[2].trim();
      // |center, |left, |200 등 레이아웃 수정자는 파일명 기준으로 사용하지 않음
      if (isLayoutModifier(pipeVal)) continue;
      if (ref === filePath || ref === fileName || fileName.startsWith(ref)) {
        return pipeVal;
      }
    }

    // ![alt](path)
    const standardLink = /!\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = standardLink.exec(content)) !== null) {
      const ref = match[2].trim();
      if (ref === filePath || ref === fileName) {
        return match[1].trim();
      }
    }

    return null;
  }

  static normalizeString(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-가-힣\u4e00-\u9fff\u3040-\u30ff]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
