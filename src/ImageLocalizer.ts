import { App, TFile, requestUrl } from 'obsidian';
import { convertImage } from './ImageConverter';
import { ImageManagerSettings } from './types';
import { CancellationToken } from './utils';

interface ExternalLink {
  original: string;
  alt: string;
  url: string;
  isWikilink: boolean;
}

export class ImageLocalizer {
  constructor(
    private app: App,
    private settings: ImageManagerSettings
  ) {}

  async localizeAll(
    onProgress: (current: number, total: number) => void,
    token?: CancellationToken
  ): Promise<{ localized: number; failed: number; cancelled: boolean; errors: string[] }> {
    const mdFiles = this.app.vault.getFiles().filter((f) => f.extension === 'md');

    let localized = 0;
    let failed = 0;
    let cancelled = false;
    const errors: string[] = [];

    for (let i = 0; i < mdFiles.length; i++) {
      if (token?.cancelled) { cancelled = true; break; }
      onProgress(i + 1, mdFiles.length);
      try {
        const count = await this.processMarkdownFile(mdFiles[i]);
        localized += count;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`ImageLocalizer: 처리 실패 (${mdFiles[i].path})`, e);
        errors.push(`${mdFiles[i].name}: ${msg}`);
        failed++;
      }
    }

    return { localized, failed, cancelled, errors };
  }

  private async processMarkdownFile(mdFile: TFile): Promise<number> {
    const content = await this.app.vault.read(mdFile);
    const links = this.extractExternalImageLinks(content);

    if (links.length === 0) return 0;

    let updatedContent = content;
    let count = 0;

    for (const link of links) {
      try {
        const arrayBuffer = await this.downloadImage(link.url);
        const ext = this.guessExtension(link.url);
        const converted = await convertImage(
          arrayBuffer,
          ext,
          this.settings.outputFormat,
          this.settings.quality
        );

        const savePath = await this.resolveSavePath(link.url, this.settings.localizeSavePath);
        await this.ensureFolder(this.settings.localizeSavePath);
        await this.app.vault.createBinary(savePath, converted);

        updatedContent = this.replaceLink(updatedContent, link, savePath);
        count++;
      } catch (e) {
        console.error(`ImageLocalizer: URL 처리 실패 (${link.url})`, e);
      }
    }

    if (updatedContent !== content) {
      await this.app.vault.modify(mdFile, updatedContent);
    }

    return count;
  }

  private extractExternalImageLinks(content: string): ExternalLink[] {
    const links: ExternalLink[] = [];
    const seen = new Set<string>();

    // Standard markdown: ![alt](https://...)
    const standardRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = standardRegex.exec(content)) !== null) {
      if (!seen.has(match[2])) {
        seen.add(match[2]);
        links.push({ original: match[0], alt: match[1], url: match[2], isWikilink: false });
      }
    }

    // Wikilink: ![[https://...]]
    const wikilinkRegex = /!\[\[(https?:\/\/[^\]|]+)(?:\|[^\]]*)?\]\]/g;
    while ((match = wikilinkRegex.exec(content)) !== null) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        links.push({ original: match[0], alt: '', url: match[1], isWikilink: true });
      }
    }

    return links;
  }

  // requestUrl을 사용해 CORS 제한 없이 이미지 다운로드
  private async downloadImage(url: string): Promise<ArrayBuffer> {
    const response = await requestUrl({ url });
    return response.arrayBuffer;
  }

  private guessExtension(url: string): string {
    const clean = url.split('?')[0].split('#')[0];
    const lastSegment = clean.split('/').pop() ?? '';
    const dotIdx = lastSegment.lastIndexOf('.');
    if (dotIdx !== -1) {
      return lastSegment.slice(dotIdx + 1).toLowerCase();
    }
    return 'jpg';
  }

  private async resolveSavePath(url: string, folder: string): Promise<string> {
    const clean = url.split('?')[0].split('#')[0];
    let fileName = clean.split('/').pop() ?? 'image';

    // 확장자를 출력 포맷으로 교체
    const dotIdx = fileName.lastIndexOf('.');
    const baseName = dotIdx !== -1 ? fileName.slice(0, dotIdx) : fileName;
    fileName = `${baseName}.${this.settings.outputFormat}`;

    // 중복 방지
    let finalPath = `${folder}/${fileName}`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(finalPath)) {
      finalPath = `${folder}/${baseName}-${counter}.${this.settings.outputFormat}`;
      counter++;
    }

    return finalPath;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }
  }

  private replaceLink(content: string, link: ExternalLink, localPath: string): string {
    const newLink = `![[${localPath}]]`;
    return content.split(link.original).join(newLink);
  }
}
