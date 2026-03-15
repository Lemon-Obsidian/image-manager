import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { convertToWebP } from './ImageConverter';
import {
  DEFAULT_SETTINGS,
  ImageManagerSettings,
  SUPPORTED_EXTENSIONS,
} from './types';

export default class ImageManagerPlugin extends Plugin {
  settings: ImageManagerSettings;
  private processing = new Set<string>();

  async onload() {
    await this.loadSettings();

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (!(file instanceof TFile)) return;
        if (!this.settings.autoConvert) return;
        this.processImage(file);
      })
    );

    this.addSettingTab(new ImageManagerSettingTab(this.app, this));
  }

  async processImage(file: TFile): Promise<void> {
    if (!SUPPORTED_EXTENSIONS.includes(file.extension.toLowerCase())) return;
    if (this.processing.has(file.path)) return;

    this.processing.add(file.path);
    const originalPath = file.path;
    const originalName = file.name;

    try {
      const arrayBuffer = await this.app.vault.readBinary(file);
      const webpBuffer = await convertToWebP(arrayBuffer, this.settings.quality);

      const newPath = originalPath.replace(/\.[^.]+$/, '.webp');

      // 동일 경로에 webp 파일이 이미 존재하면 삭제
      const existing = this.app.vault.getAbstractFileByPath(newPath);
      if (existing instanceof TFile) {
        await this.app.vault.delete(existing);
      }

      // 파일명 변경 (마크다운 링크 자동 업데이트 포함)
      await this.app.fileManager.renameFile(file, newPath);

      // 변환된 WebP 내용으로 덮어쓰기
      const newFile = this.app.vault.getAbstractFileByPath(newPath);
      if (!(newFile instanceof TFile)) {
        throw new Error('변환 후 파일을 찾을 수 없습니다.');
      }
      await this.app.vault.modifyBinary(newFile, webpBuffer);

      new Notice(`✓ ${originalName} → ${newFile.name}`);
    } catch (e) {
      console.error(`ImageManager: 변환 실패 (${originalName})`, e);
      new Notice(`✗ 변환 실패: ${originalName}`);
    } finally {
      this.processing.delete(originalPath);
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
      .setDesc('볼트에 이미지가 추가될 때 자동으로 WebP로 변환합니다.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoConvert)
          .onChange(async (value) => {
            this.plugin.settings.autoConvert = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('WebP 품질')
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
  }
}
