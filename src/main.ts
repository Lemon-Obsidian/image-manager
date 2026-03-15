import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { convertImage } from './ImageConverter';
import {
  DEFAULT_SETTINGS,
  ImageManagerSettings,
  SUPPORTED_EXTENSIONS,
} from './types';

interface ConversionResult {
  originalSize: number;
  newSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatReduction(originalSize: number, newSize: number): string {
  const pct = Math.round((1 - newSize / originalSize) * 100);
  return `${formatBytes(originalSize)} → ${formatBytes(newSize)} (-${pct}%)`;
}

export default class ImageManagerPlugin extends Plugin {
  settings: ImageManagerSettings;
  private processing = new Set<string>();

  async onload() {
    await this.loadSettings();

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (!(file instanceof TFile)) return;
        if (!this.settings.autoConvert) return;
        this.processImage(file, true);
      })
    );

    this.addCommand({
      id: 'convert-all-images',
      name: '볼트 내 이미지 일괄 변환',
      callback: () => this.convertAllImages(),
    });

    this.addSettingTab(new ImageManagerSettingTab(this.app, this));
  }

  private isExcluded(filePath: string): boolean {
    return this.settings.excludeFolders.some((folder) => {
      if (!folder) return false;
      const normalized = folder.endsWith('/') ? folder : `${folder}/`;
      return filePath.startsWith(normalized);
    });
  }

  async processImage(file: TFile, showNotice: boolean): Promise<ConversionResult | null> {
    if (!SUPPORTED_EXTENSIONS.includes(file.extension.toLowerCase())) return null;
    if (this.isExcluded(file.path)) return null;
    if (this.processing.has(file.path)) return null;

    this.processing.add(file.path);
    const originalPath = file.path;
    const originalName = file.name;
    const { outputFormat, quality } = this.settings;

    try {
      const arrayBuffer = await this.app.vault.readBinary(file);
      const originalSize = arrayBuffer.byteLength;

      const converted = await convertImage(arrayBuffer, file.extension, outputFormat, quality);
      const newSize = converted.byteLength;

      const newPath = originalPath.replace(/\.[^.]+$/, `.${outputFormat}`);

      const existing = this.app.vault.getAbstractFileByPath(newPath);
      if (existing instanceof TFile) {
        await this.app.vault.delete(existing);
      }

      await this.app.fileManager.renameFile(file, newPath);

      const newFile = this.app.vault.getAbstractFileByPath(newPath);
      if (!(newFile instanceof TFile)) {
        throw new Error('변환 후 파일을 찾을 수 없습니다.');
      }
      await this.app.vault.modifyBinary(newFile, converted);

      if (showNotice) {
        new Notice(`✓ ${originalName} → ${newFile.name}\n${formatReduction(originalSize, newSize)}`);
      }
      return { originalSize, newSize };
    } catch (e) {
      console.error(`ImageManager: 변환 실패 (${originalName})`, e);
      if (showNotice) {
        new Notice(`✗ 변환 실패: ${originalName}`);
      }
      return null;
    } finally {
      this.processing.delete(originalPath);
    }
  }

  async convertAllImages(): Promise<void> {
    const files = this.app.vault
      .getFiles()
      .filter(
        (f) =>
          SUPPORTED_EXTENSIONS.includes(f.extension.toLowerCase()) &&
          !this.isExcluded(f.path)
      );

    if (files.length === 0) {
      new Notice('변환할 이미지가 없습니다.');
      return;
    }

    const notice = new Notice(`이미지 변환 중... (0/${files.length})`, 0);
    let totalOriginal = 0;
    let totalNew = 0;
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      notice.setMessage(`이미지 변환 중... (${i + 1}/${files.length})`);
      const result = await this.processImage(files[i], false);
      if (result) {
        totalOriginal += result.originalSize;
        totalNew += result.newSize;
        successCount++;
      }
    }

    notice.hide();

    if (successCount === 0) {
      new Notice('변환된 이미지가 없습니다.');
    } else {
      new Notice(`✓ 변환 완료: ${successCount}개 파일\n${formatReduction(totalOriginal, totalNew)}`);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ImageManagerSettingTab extends PluginSettingTab {
  plugin: ImageManagerPlugin;

  constructor(app: App, plugin: ImageManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Image Manager' });

    new Setting(containerEl)
      .setName('자동 변환')
      .setDesc('볼트에 이미지가 추가될 때 자동으로 변환합니다.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoConvert)
          .onChange(async (value) => {
            this.plugin.settings.autoConvert = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('출력 포맷')
      .setDesc('변환 후 저장할 이미지 포맷')
      .addDropdown((drop) =>
        drop
          .addOption('webp', 'WebP (빠른 변환, 의존성 없음)')
          .addOption('avif', 'AVIF (높은 압축률, 초기 로딩 필요)')
          .setValue(this.plugin.settings.outputFormat)
          .onChange(async (value) => {
            this.plugin.settings.outputFormat = value as 'webp' | 'avif';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('변환 품질')
      .setDesc('숫자가 높을수록 고화질, 파일 크기 증가 (기본값: 80)')
      .addSlider((slider) =>
        slider
          .setLimits(1, 100, 1)
          .setValue(this.plugin.settings.quality)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.quality = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('제외 폴더')
      .setDesc('변환하지 않을 폴더 경로를 한 줄에 하나씩 입력하세요.')
      .addTextArea((text) => {
        text
          .setPlaceholder('예시:\nAttachments/raw\nTemplates')
          .setValue(this.plugin.settings.excludeFolders.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 5;
        text.inputEl.style.width = '100%';
      });
  }
}
