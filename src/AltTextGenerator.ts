import { App, TFile, requestUrl } from 'obsidian';
import { getImageDataFromFile, resizeImageData } from './ImageConverter';
import { ImageManagerSettings } from './types';
import { isLayoutModifier, sleep } from './utils';

// 요청 사이 기본 딜레이 (ms)
const REQUEST_DELAY_MS = 1000;
// 429 레이트 리밋 시 지수 백오프 기준 (ms) — attempt 1: 4s, 2: 8s, 3: 16s
const BACKOFF_BASE_MS = 2000;
const MAX_RETRIES = 3;

export interface AltTextResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export class AltTextGenerator {
  constructor(
    private app: App,
    private settings: ImageManagerSettings
  ) {}

  async generateForFile(file: TFile): Promise<AltTextResult | null> {
    if (!this.settings.altTextEnabled || !this.settings.openaiApiKey) return null;

    const arrayBuffer = await this.app.vault.readBinary(file);
    const result = await this.callOpenAIWithRetry(arrayBuffer, file.extension);
    const { text: altText } = result;

    const mdFiles = this.findReferencingMarkdownFiles(file);
    for (const mdFile of mdFiles) {
      const content = await this.app.vault.read(mdFile);
      const updated = this.updateAltTextInContent(content, file.path, file.name, altText);
      if (updated !== content) {
        await this.app.vault.modify(mdFile, updated);
      }
    }

    return result;
  }

  async generateForAll(
    files: TFile[],
    onProgress: (current: number, total: number) => void
  ): Promise<{
    success: number;
    failed: number;
    skipped: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    errors: string[];
  }> {
    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length);

      // 첫 번째 요청 이후 딜레이 적용 (레이트 리밋 예방)
      if (i > 0) await sleep(REQUEST_DELAY_MS);

      try {
        const result = await this.generateForFile(files[i]);
        if (result === null) {
          results.skipped++;
        } else {
          results.success++;
          results.totalPromptTokens += result.promptTokens;
          results.totalCompletionTokens += result.completionTokens;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`AltTextGenerator: 실패 (${files[i].name})`, e);
        results.errors.push(`${files[i].name}: ${msg}`);
        results.failed++;
      }
    }

    return results;
  }

  private async callOpenAIWithRetry(
    arrayBuffer: ArrayBuffer,
    ext: string
  ): Promise<AltTextResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const waitMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        console.log(`AltTextGenerator: 재시도 ${attempt}/${MAX_RETRIES} (${waitMs}ms 대기)`);
        await sleep(waitMs);
      }

      try {
        return await this.callOpenAI(arrayBuffer, ext);
      } catch (e: any) {
        lastError = e;
        // 429 레이트 리밋이면 재시도, 그 외 에러는 즉시 throw
        const status = e?.status ?? e?.response?.status;
        if (status === 429) continue;
        throw e;
      }
    }

    throw lastError ?? new Error('최대 재시도 횟수 초과');
  }

  private async callOpenAI(arrayBuffer: ArrayBuffer, ext: string): Promise<AltTextResult> {
    const imageData = await getImageDataFromFile(arrayBuffer, ext);
    const resized = resizeImageData(imageData, this.settings.altTextMaxDimension);

    const canvas = document.createElement('canvas');
    canvas.width = resized.width;
    canvas.height = resized.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(resized, 0, 0);
    const dataURL = canvas.toDataURL('image/png');

    const response = await requestUrl({
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      throw: false,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.altTextModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataURL } },
              {
                type: 'text',
                text: `이 이미지에 대한 간결한 alt text를 ${this.settings.altTextLanguage}로 작성해주세요. 이미지를 설명하는 짧은 문장 하나로만 답변하세요.`,
              },
            ],
          },
        ],
        max_tokens: 100,
      }),
    });

    if (response.status >= 400) {
      const errMsg = response.json?.error?.message ?? JSON.stringify(response.json);
      const err = new Error(`OpenAI API 오류 (${response.status}): ${errMsg}`) as any;
      err.status = response.status;
      throw err;
    }

    const json = response.json;
    return {
      text: (json.choices[0].message.content as string).trim(),
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  }

  findReferencingMarkdownFiles(imageFile: TFile): TFile[] {
    const { resolvedLinks } = this.app.metadataCache;
    const result: TFile[] = [];
    for (const [notePath, links] of Object.entries(resolvedLinks)) {
      if (imageFile.path in links) {
        const noteFile = this.app.vault.getAbstractFileByPath(notePath);
        if (noteFile instanceof TFile) {
          result.push(noteFile);
        }
      }
    }
    return result;
  }

  private updateAltTextInContent(
    content: string,
    imagePath: string,
    imageName: string,
    altText: string
  ): string {
    const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedName = imageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const replaceWikilink = (ref: string, escaped: string) =>
      content.replace(
        new RegExp(`!\\[\\[${escaped}(\\|[^\\]]*)?\\]\\]`, 'g'),
        (match, pipeGroup) => {
          // |center, |left, |right, |200, |200x300 같은 레이아웃 수정자는 건드리지 않음
          if (pipeGroup && isLayoutModifier(pipeGroup.slice(1))) return match;
          return `![[${ref}|${altText}]]`;
        }
      );

    content = replaceWikilink(imagePath, escapedPath);
    content = replaceWikilink(imageName, escapedName);

    // ![old](path) → ![alt](path)
    content = content.replace(
      new RegExp(`!\\[[^\\]]*\\]\\(${escapedPath}\\)`, 'g'),
      `![${altText}](${imagePath})`
    );

    return content;
  }
}
