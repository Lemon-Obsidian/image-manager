import { App, TFile } from 'obsidian';
import { getImageDataFromFile, resizeImageData } from './ImageConverter';
import { ImageManagerSettings } from './types';

export class AltTextGenerator {
  constructor(
    private app: App,
    private settings: ImageManagerSettings
  ) {}

  async generateForFile(file: TFile): Promise<string | null> {
    if (!this.settings.altTextEnabled || !this.settings.openaiApiKey) return null;

    const arrayBuffer = await this.app.vault.readBinary(file);
    const altText = await this.callOpenAI(arrayBuffer, file.extension);

    const mdFiles = this.findReferencingMarkdownFiles(file);
    for (const mdFile of mdFiles) {
      const content = await this.app.vault.read(mdFile);
      const updated = this.updateAltTextInContent(content, file.path, file.name, altText);
      if (updated !== content) {
        await this.app.vault.modify(mdFile, updated);
      }
    }

    return altText;
  }

  async generateForAll(
    files: TFile[],
    onProgress: (current: number, total: number) => void
  ): Promise<{ success: number; failed: number; skipped: number }> {
    const results = { success: 0, failed: 0, skipped: 0 };

    for (let i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length);
      try {
        const result = await this.generateForFile(files[i]);
        if (result === null) {
          results.skipped++;
        } else {
          results.success++;
        }
      } catch (e) {
        console.error(`AltTextGenerator: 실패 (${files[i].name})`, e);
        results.failed++;
      }
    }

    return results;
  }

  private async callOpenAI(arrayBuffer: ArrayBuffer, ext: string): Promise<string> {
    const imageData = await getImageDataFromFile(arrayBuffer, ext);
    const resized = resizeImageData(imageData, this.settings.altTextMaxDimension);

    const canvas = document.createElement('canvas');
    canvas.width = resized.width;
    canvas.height = resized.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(resized, 0, 0);
    const dataURL = canvas.toDataURL('image/png');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
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

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API 오류 ${response.status}: ${err}`);
    }

    const data = await response.json();
    return (data.choices[0].message.content as string).trim();
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

    // ![[path]] → ![[path|alt]], ![[path|old]] → ![[path|alt]]
    content = content.replace(
      new RegExp(`!\\[\\[${escapedPath}(\\|[^\\]]*)?\\]\\]`, 'g'),
      `![[${imagePath}|${altText}]]`
    );
    // ![[name]] → ![[name|alt]], ![[name|old]] → ![[name|alt]]
    content = content.replace(
      new RegExp(`!\\[\\[${escapedName}(\\|[^\\]]*)?\\]\\]`, 'g'),
      `![[${imageName}|${altText}]]`
    );

    // ![old](path) → ![alt](path)
    content = content.replace(
      new RegExp(`!\\[[^\\]]*\\]\\(${escapedPath}\\)`, 'g'),
      `![${altText}](${imagePath})`
    );

    return content;
  }
}
