import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { convertImage, getImageDataFromFile, imageDataToArrayBuffer, resizeImageData } from './ImageConverter';
import {
  ALL_IMAGE_EXTENSIONS,
  DEFAULT_SETTINGS,
  ImageManagerSettings,
  SUPPORTED_EXTENSIONS,
} from './types';
import { CancellationToken, formatReduction, ProgressNotice } from './utils';
import {
  AVG_OUTPUT_TOKENS,
  EXCHANGE_RATE_KRW,
  KNOWN_MODELS,
  MODEL_CONFIGS,
  calculateCostWon,
  estimateCostPerImageWon,
  estimateImageTokens,
} from './models';
import { DuplicateDetector } from './DuplicateDetector';
import { DuplicateModal } from './DuplicateModal';
import { ConversionRecord, ReportModal } from './ReportModal';
import { ImageLocalizer } from './ImageLocalizer';
import { AltTextGenerator } from './AltTextGenerator';
import { AltTextHistoryModal } from './AltTextHistoryModal';
import { FileNameNormalizer } from './FileNameNormalizer';
import { OrphanedImageModal } from './OrphanedImageModal';

interface ConversionResult {
  originalSize: number;
  newSize: number;
}

export default class ImageManagerPlugin extends Plugin {
  settings: ImageManagerSettings;
  private processing = new Set<string>();
  private normalizer: FileNameNormalizer;

  async onload() {
    await this.loadSettings();
    this.normalizer = new FileNameNormalizer(this.app, this.settings);

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (!(file instanceof TFile)) return;
        if (this.settings.autoConvert) {
          this.processImage(file, true);
        }
        if (this.settings.renameEnabled) {
          // metadataCache가 인덱싱할 시간 확보
          setTimeout(() => this.normalizer.normalizeFile(file), 500);
        }
      })
    );

    this.addCommand({
      id: 'convert-all-images',
      name: '볼트 내 이미지 일괄 변환',
      callback: () => this.convertAllImages(),
    });

    this.addCommand({
      id: 'convert-with-report',
      name: '압축 리포트 보기',
      callback: () => this.convertAllImagesWithReport(),
    });

    this.addCommand({
      id: 'detect-duplicates',
      name: '이미지 중복 탐지',
      callback: () => this.detectDuplicates(),
    });

    this.addCommand({
      id: 'localize-images',
      name: '외부 이미지 로컬화',
      callback: () => this.localizeImages(),
    });

    this.addCommand({
      id: 'generate-alt-text-active',
      name: '선택 이미지 alt text 생성',
      callback: () => this.generateAltTextForActive(),
    });

    this.addCommand({
      id: 'generate-alt-text-current-note',
      name: '현재 노트 이미지 alt text 생성',
      callback: () => this.generateAltTextForCurrentNote(),
    });

    this.addCommand({
      id: 'generate-alt-text-all',
      name: '볼트 전체 alt text 생성',
      callback: () => this.generateAltTextForAll(),
    });

    this.addCommand({
      id: 'normalize-filenames',
      name: '이미지 파일명 정규화',
      callback: () => this.normalizeFileNames(),
    });

    this.addCommand({
      id: 'normalize-filenames-current-note',
      name: '현재 노트 이미지 파일명 정규화',
      callback: () => this.normalizeFileNamesForCurrentNote(),
    });

    this.addCommand({
      id: 'alt-text-history',
      name: 'Alt text 생성 히스토리',
      callback: () => this.openAltTextHistory(),
    });

    this.addCommand({
      id: 'find-orphaned-images',
      name: '고아 이미지 탐지 및 삭제',
      callback: () => this.findOrphanedImages(),
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
    const { outputFormat, quality, autoResize, resizeMaxDimension } = this.settings;

    try {
      let arrayBuffer = await this.app.vault.readBinary(file);
      const originalSize = arrayBuffer.byteLength;

      let effectiveExtension = file.extension;

      if (autoResize) {
        const imageData = await getImageDataFromFile(arrayBuffer, effectiveExtension);
        const resized = resizeImageData(imageData, resizeMaxDimension);
        if (resized !== imageData) {
          arrayBuffer = await imageDataToArrayBuffer(resized);
          effectiveExtension = 'png';
        }
      }

      const converted = await convertImage(arrayBuffer, effectiveExtension, outputFormat, quality);
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
    const files = this.getImageFiles();

    if (files.length === 0) {
      new Notice('변환할 이미지가 없습니다.');
      return;
    }

    const token = new CancellationToken();
    const progress = new ProgressNotice('이미지 변환 중', token);
    let totalOriginal = 0;
    let totalNew = 0;
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      if (token.cancelled) break;
      progress.update(i + 1, files.length);
      const result = await this.processImage(files[i], false);
      if (result) {
        totalOriginal += result.originalSize;
        totalNew += result.newSize;
        successCount++;
      }
    }

    if (token.cancelled) {
      progress.finish(`↩ 취소됨 (${successCount}개 완료)`);
    } else if (successCount === 0) {
      progress.finish('변환된 이미지가 없습니다.');
    } else {
      progress.finish(`✓ 변환 완료: ${successCount}개 파일\n${formatReduction(totalOriginal, totalNew)}`);
    }
  }

  async convertAllImagesWithReport(): Promise<void> {
    const files = this.getImageFiles();

    if (files.length === 0) {
      new Notice('변환할 이미지가 없습니다.');
      return;
    }

    const token = new CancellationToken();
    const progress = new ProgressNotice('이미지 변환 중', token);
    const records: ConversionRecord[] = [];

    for (let i = 0; i < files.length; i++) {
      if (token.cancelled) break;
      progress.update(i + 1, files.length);
      const originalName = files[i].name;
      const originalSize = files[i].stat.size;

      const result = await this.processImage(files[i], false);
      if (result) {
        records.push({ originalName, originalSize: result.originalSize, newSize: result.newSize, skipped: false });
      } else {
        records.push({ originalName, originalSize, newSize: originalSize, skipped: true });
      }
    }

    progress.finish(token.cancelled ? `↩ 취소됨 — 부분 리포트` : '✓ 변환 완료 — 리포트를 확인하세요.');
    if (records.length > 0) new ReportModal(this.app, records).open();
  }

  private async detectDuplicates(): Promise<void> {
    const files = this.getImageFiles(ALL_IMAGE_EXTENSIONS);

    if (files.length === 0) {
      new Notice('이미지 파일이 없습니다.');
      return;
    }

    const token = new CancellationToken();
    const progress = new ProgressNotice('이미지 해시 계산 중', token);
    const detector = new DuplicateDetector(this.app);

    const { groups, elapsedMs, cancelled } = await detector.detectDuplicates(
      files,
      this.settings.duplicateThreshold,
      (current, total) => progress.update(current, total),
      token
    );

    if (cancelled) {
      progress.finish('↩ 취소됨');
      return;
    }
    const elapsed = (elapsedMs / 1000).toFixed(1);
    progress.finish(
      groups.length > 0
        ? `✓ 중복 탐지 완료 — ${groups.length}개 그룹 발견 (${elapsed}s)`
        : `✓ 중복 이미지 없음 (${elapsed}s)`
    );
    new DuplicateModal(this.app, groups, elapsedMs).open();
  }

  private async localizeImages(): Promise<void> {
    const token = new CancellationToken();
    const progress = new ProgressNotice('외부 이미지 로컬화 중', token);
    const localizer = new ImageLocalizer(this.app, this.settings);

    const { localized, failed, cancelled, errors } = await localizer.localizeAll(
      (current, total) => progress.update(current, total),
      token
    );

    progress.finish(
      cancelled
        ? `↩ 취소됨 (${localized}개 완료)`
        : failed > 0
          ? `✓ 로컬화: ${localized}개 / ✗ 실패: ${failed}개`
          : `✓ ${localized}개 이미지를 로컬화했습니다.`
    );
    this.showErrors(errors);
  }

  private async generateAltTextForActive(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || !SUPPORTED_EXTENSIONS.includes(activeFile.extension.toLowerCase())) {
      new Notice('이미지 파일을 선택해주세요.');
      return;
    }

    if (!this.settings.altTextEnabled || !this.settings.openaiApiKey) {
      new Notice('Alt Text 생성을 활성화하고 API 키를 입력해주세요.');
      return;
    }

    const progress = new ProgressNotice(`Alt text 생성 중: ${activeFile.name}`);
    const generator = new AltTextGenerator(this.app, this.settings);

    try {
      const result = await generator.generateForFile(activeFile);
      if (result) {
        this.accumulateUsage(result.promptTokens, result.completionTokens);
        await this.saveSettings();
        progress.finish(`✓ Alt text 생성 완료: "${result.text}"`);
      } else {
        progress.finish('Alt text 생성을 건너뛰었습니다.');
      }
    } catch (e) {
      progress.error(`Alt text 생성 실패: ${(e as Error).message}`);
    }
  }

  private async generateAltTextForAll(): Promise<void> {
    if (!this.settings.altTextEnabled || !this.settings.openaiApiKey) {
      new Notice('Alt Text 생성을 활성화하고 API 키를 입력해주세요.');
      return;
    }

    const files = this.getImageFiles(ALL_IMAGE_EXTENSIONS);
    if (files.length === 0) {
      new Notice('이미지 파일이 없습니다.');
      return;
    }

    const token = new CancellationToken();
    const progress = new ProgressNotice('Alt text 생성 중', token);
    const generator = new AltTextGenerator(this.app, this.settings);

    const { success, failed, skipped, cancelled, errors } =
      await generator.generateForAll(
        files,
        (current, total) => progress.update(current, total),
        token,
        async (pt, ct) => { this.accumulateUsage(pt, ct); await this.saveSettings(); }
      );

    progress.finish(cancelled
      ? `↩ 취소됨 (${success}개 완료)`
      : `✓ ${success}개 성공 / ${failed}개 실패 / ${skipped}개 건너뜀`);
    this.showErrors(errors);
  }

  private async normalizeFileNames(): Promise<void> {
    const files = this.getImageFiles(ALL_IMAGE_EXTENSIONS);
    if (files.length === 0) {
      new Notice('이미지 파일이 없습니다.');
      return;
    }

    const token = new CancellationToken();
    const progress = new ProgressNotice('파일명 정규화 중', token);

    const { renamed, skipped, failed, cancelled, errors } = await this.normalizer.normalizeAll(
      files,
      (current, total) => progress.update(current, total),
      token
    );

    progress.finish(cancelled
      ? `↩ 취소됨 (${renamed}개 완료)`
      : `✓ 이름 변경: ${renamed}개 / 건너뜀: ${skipped}개 / 실패: ${failed}개`);
    this.showErrors(errors);
  }

  private async generateAltTextForCurrentNote(): Promise<void> {
    const files = this.getImagesInCurrentNote();
    if (files === null) {
      new Notice('마크다운 노트를 열어주세요.');
      return;
    }
    if (files.length === 0) {
      new Notice('현재 노트에 처리할 이미지가 없습니다.');
      return;
    }
    if (!this.settings.altTextEnabled || !this.settings.openaiApiKey) {
      new Notice('Alt Text 생성을 활성화하고 API 키를 입력해주세요.');
      return;
    }

    const token = new CancellationToken();
    const progress = new ProgressNotice('Alt text 생성 중 (현재 노트)', token);
    const generator = new AltTextGenerator(this.app, this.settings);

    const { success, failed, skipped, cancelled, errors } =
      await generator.generateForAll(
        files,
        (current, total) => progress.update(current, total),
        token,
        async (pt, ct) => { this.accumulateUsage(pt, ct); await this.saveSettings(); }
      );

    progress.finish(cancelled
      ? `↩ 취소됨 (${success}개 완료)`
      : `✓ ${success}개 성공 / ${failed}개 실패 / ${skipped}개 건너뜀`);
    this.showErrors(errors);
  }

  private async normalizeFileNamesForCurrentNote(): Promise<void> {
    const files = this.getImagesInCurrentNote();
    if (files === null) {
      new Notice('마크다운 노트를 열어주세요.');
      return;
    }
    if (files.length === 0) {
      new Notice('현재 노트에 처리할 이미지가 없습니다.');
      return;
    }

    const token = new CancellationToken();
    const progress = new ProgressNotice('파일명 정규화 중 (현재 노트)', token);

    const { renamed, skipped, failed, cancelled, errors } = await this.normalizer.normalizeAll(
      files,
      (current, total) => progress.update(current, total),
      token
    );

    progress.finish(cancelled
      ? `↩ 취소됨 (${renamed}개 완료)`
      : `✓ 이름 변경: ${renamed}개 / 건너뜀: ${skipped}개 / 실패: ${failed}개`);
    this.showErrors(errors);
  }

  private showErrors(errors: string[]): void {
    if (errors.length === 0) return;
    const MAX_SHOWN = 5;
    const shown = errors.slice(0, MAX_SHOWN);
    const extra = errors.length > MAX_SHOWN ? `\n…외 ${errors.length - MAX_SHOWN}개` : '';
    new Notice(`⚠️ 실패 항목:\n${shown.join('\n')}${extra}`, 8000);
  }

  private getImageFiles(extensions = SUPPORTED_EXTENSIONS): TFile[] {
    return this.app.vault
      .getFiles()
      .filter(
        (f) =>
          extensions.includes(f.extension.toLowerCase()) && !this.isExcluded(f.path)
      );
  }

  /** 현재 열린 마크다운 노트에서 참조된 이미지 파일 목록 (webp/avif 포함) */
  private getImagesInCurrentNote(): TFile[] | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') return null;

    const links = this.app.metadataCache.resolvedLinks[activeFile.path] ?? {};
    return Object.keys(links)
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter(
        (f): f is TFile =>
          f instanceof TFile &&
          ALL_IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()) &&
          !this.isExcluded(f.path)
      );
  }

  accumulateUsage(promptTokens: number, completionTokens: number): void {
    this.settings.altTextTotalRequests += 1;
    this.settings.altTextTotalPromptTokens += promptTokens;
    this.settings.altTextTotalCompletionTokens += completionTokens;
    // 호출 시점의 모델 단가로 비용 계산 (모델 변경 시 이전 내역은 그대로 보존)
    this.settings.altTextTotalCostWon += calculateCostWon(
      promptTokens,
      completionTokens,
      this.settings.altTextModel
    );
    this.settings.altTextStatsUpdatedAt = new Date().toISOString();
  }

  private findOrphanedImages(): void {
    const linkedPaths = new Set<string>();
    for (const links of Object.values(this.app.metadataCache.resolvedLinks)) {
      for (const path of Object.keys(links)) {
        linkedPaths.add(path);
      }
    }

    const orphaned = this.getImageFiles(ALL_IMAGE_EXTENSIONS).filter(
      (f) => !linkedPaths.has(f.path)
    );

    new OrphanedImageModal(this.app, orphaned).open();
  }

  private openAltTextHistory(): void {
    new AltTextHistoryModal(this.app, this.settings.altTextHistory ?? [], async () => {
      this.settings.altTextHistory = [];
      await this.saveSettings();
    }).open();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.altTextHistory)) {
      this.settings.altTextHistory = [];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // normalizer가 항상 최신 settings를 참조하도록 재생성
    this.normalizer = new FileNameNormalizer(this.app, this.settings);
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

    // ─── 기본 변환 설정 ───────────────────────────────────────────────
    containerEl.createEl('h3', { text: '기본 변환 설정' });

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

    // ─── 이미지 리사이즈 ─────────────────────────────────────────────
    containerEl.createEl('h3', { text: '이미지 리사이즈' });

    new Setting(containerEl)
      .setName('자동 리사이즈')
      .setDesc('변환 전 이미지를 지정한 크기 이하로 축소합니다.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoResize)
          .onChange(async (value) => {
            this.plugin.settings.autoResize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('최대 크기')
      .setDesc('이미지의 가로/세로 최대 픽셀 수')
      .addDropdown((drop) =>
        drop
          .addOption('1920', '1920px (FHD)')
          .addOption('2560', '2560px (QHD)')
          .addOption('4096', '4096px (4K)')
          .setValue(String(this.plugin.settings.resizeMaxDimension))
          .onChange(async (value) => {
            this.plugin.settings.resizeMaxDimension = Number(value) as 1920 | 2560 | 4096;
            await this.plugin.saveSettings();
          })
      );

    // ─── 이미지 중복 탐지 ────────────────────────────────────────────
    containerEl.createEl('h3', { text: '이미지 중복 탐지' });

    new Setting(containerEl)
      .setName('유사도 임계값')
      .setDesc(
        '해밍 거리 기준 (0: 완전 일치, 20: 매우 유사). 기본값: 5'
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.duplicateThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.duplicateThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    // ─── 외부 이미지 로컬화 ──────────────────────────────────────────
    containerEl.createEl('h3', { text: '외부 이미지 로컬화' });

    new Setting(containerEl)
      .setName('저장 경로')
      .setDesc('다운로드한 이미지를 저장할 볼트 내 폴더 경로')
      .addText((text) =>
        text
          .setPlaceholder('Attachments')
          .setValue(this.plugin.settings.localizeSavePath)
          .onChange(async (value) => {
            this.plugin.settings.localizeSavePath = value.trim() || 'Attachments';
            await this.plugin.saveSettings();
          })
      );

    // ─── Alt Text 자동 생성 ──────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Alt Text 자동 생성' });

    new Setting(containerEl)
      .setName('활성화')
      .setDesc('이미지를 리사이즈 후 OpenAI 비전 API에 전송해 alt text를 자동 생성합니다.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.altTextEnabled)
          .onChange(async (value) => {
            this.plugin.settings.altTextEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('OpenAI API 키')
      .setDesc('OpenAI API 인증 키 (sk-...)')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('모델')
      .setDesc('사용할 OpenAI 비전 모델 (단가는 하단 비교표 참고)')
      .addDropdown((drop) => {
        for (const id of KNOWN_MODELS) {
          drop.addOption(id, MODEL_CONFIGS[id].displayName);
        }
        drop
          .setValue(
            KNOWN_MODELS.includes(this.plugin.settings.altTextModel as any)
              ? this.plugin.settings.altTextModel
              : KNOWN_MODELS[0]
          )
          .onChange(async (value) => {
            this.plugin.settings.altTextModel = value;
            await this.plugin.saveSettings();
            this.display(); // 비용 비교표 갱신
          });
      });

    new Setting(containerEl)
      .setName('이미지 전송 크기')
      .setDesc('API 전송 전 이미지를 축소합니다.')
      .addDropdown((drop) =>
        drop
          .addOption('256', '256px — 약 85 토큰/이미지 · 1,000장 ≈ 45원 (환율 1,500원 기준)')
          .addOption('512', '512px — 약 170 토큰/이미지 · 1,000장 ≈ 75원')
          .setValue(String(this.plugin.settings.altTextMaxDimension))
          .onChange(async (value) => {
            this.plugin.settings.altTextMaxDimension = Number(value) as 256 | 512;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('기존 alt text 덮어쓰기')
      .setDesc('꺼두면 이미 alt text가 있는 이미지는 건너뜁니다. (기본값: 꺼짐)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.altTextOverwrite)
          .onChange(async (value) => {
            this.plugin.settings.altTextOverwrite = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('생성 후 파일명 자동 변경')
      .setDesc('Alt text를 기반으로 파일명을 자동 정규화합니다. (![[image|alt text]]로 링크도 함께 갱신)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.altTextAutoRename)
          .onChange(async (value) => {
            this.plugin.settings.altTextAutoRename = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('언어')
      .setDesc('프롬프트의 {language} 자리에 치환됩니다.')
      .addText((text) =>
        text
          .setPlaceholder('한국어')
          .setValue(this.plugin.settings.altTextLanguage)
          .onChange(async (value) => {
            this.plugin.settings.altTextLanguage = value.trim() || '한국어';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('프롬프트')
      .setDesc('{language}는 위 언어 설정으로 치환됩니다.')
      .addTextArea((text) => {
        text
          .setPlaceholder('이 이미지에 대한 간결한 alt text를 {language}로 작성해주세요...')
          .setValue(this.plugin.settings.altTextPrompt)
          .onChange(async (value) => {
            this.plugin.settings.altTextPrompt = value.trim() || DEFAULT_SETTINGS.altTextPrompt;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
        text.inputEl.style.width = '100%';
      });

    new Setting(containerEl)
      .setName('최대 완료 토큰 수')
      .setDesc('추론 모델(gpt-5-*)은 reasoning 토큰 포함. 부족하면 응답이 잘릴 수 있습니다.')
      .addSlider((slider) =>
        slider
          .setLimits(500, 8000, 500)
          .setValue(this.plugin.settings.altTextMaxCompletionTokens)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.altTextMaxCompletionTokens = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('노트 문맥 줄 수')
      .setDesc('이미지 위아래 N줄을 함께 전송합니다. 0이면 비활성.')
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.altTextContextLines)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.altTextContextLines = value;
            await this.plugin.saveSettings();
          })
      );

    this.renderAltTextCostEstimate(containerEl);

    // ─── 이미지 파일명 정규화 ────────────────────────────────────────
    containerEl.createEl('h3', { text: '이미지 파일명 정규화' });

    new Setting(containerEl)
      .setName('자동 정규화')
      .setDesc('이미지가 추가될 때 자동으로 파일명을 정규화합니다.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.renameEnabled)
          .onChange(async (value) => {
            this.plugin.settings.renameEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    const renameModeDesc =
      this.plugin.settings.renameMode === 'alttext' && !this.plugin.settings.altTextEnabled
        ? '⚠️ Alt Text 생성이 비활성화되어 있습니다. Alt Text 생성을 먼저 활성화하세요.'
        : '파일명의 기준으로 사용할 정보';

    new Setting(containerEl)
      .setName('정규화 모드')
      .setDesc(renameModeDesc)
      .addDropdown((drop) =>
        drop
          .addOption('reference', '참조 노트 제목 사용')
          .addOption('alttext', 'Alt Text 사용 (Alt Text 생성 활성화 필요)')
          .setValue(this.plugin.settings.renameMode)
          .onChange(async (value) => {
            this.plugin.settings.renameMode = value as 'reference' | 'alttext';
            await this.plugin.saveSettings();
            // 경고 표시를 위해 탭 새로고침
            this.display();
          })
      );
  }

  private renderAltTextCostEstimate(containerEl: HTMLElement): void {
    const s = this.plugin.settings;

    // ── 모델별 예상 비용 비교표 ────────────────────────────────────
    const imageCount = this.plugin.app.vault
      .getFiles()
      .filter((f) => ALL_IMAGE_EXTENSIONS.includes(f.extension.toLowerCase())).length;

    const estBox = this.createInfoBox(containerEl);
    estBox.createEl('div', {
      text: `📊 모델별 예상 비용 (${s.altTextMaxDimension}px 기준 · 볼트 이미지 ${imageCount.toLocaleString()}개)`,
      attr: { style: 'font-weight: 600; margin-bottom: 8px;' },
    });

    const table = estBox.createEl('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 0.9em;';

    // 헤더
    const thead = table.createEl('thead');
    const hRow = thead.createEl('tr');
    for (const [text, align] of [
      ['모델', 'left'],
      ['이미지당 토큰', 'right'],
      ['이미지당 비용', 'right'],
      ['전체 예상', 'right'],
    ] as [string, string][]) {
      const th = hRow.createEl('th', { text });
      th.style.cssText = `text-align: ${align}; padding: 4px 8px; border-bottom: 1px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 500;`;
    }

    // 행
    const tbody = table.createEl('tbody');
    for (const modelId of KNOWN_MODELS) {
      const config = MODEL_CONFIGS[modelId];
      const tokens = estimateImageTokens(s.altTextMaxDimension, modelId);
      const perImage = estimateCostPerImageWon(s.altTextMaxDimension, modelId);
      const total = perImage * imageCount;
      const isCurrent = s.altTextModel === modelId;

      const row = tbody.createEl('tr');
      if (isCurrent) {
        row.style.cssText =
          'background: var(--background-modifier-active-hover); font-weight: 600;';
      }

      // 모델명 셀
      const nameCell = row.createEl('td', {
        text: (isCurrent ? '▶ ' : '　') + config.displayName,
      });
      nameCell.style.cssText = 'padding: 5px 8px;';

      // 수치 셀
      for (const [text, isRight] of [
        [`${tokens.toLocaleString()} 토큰`, true],
        [`${perImage < 0.001 ? perImage.toFixed(6) : perImage.toFixed(4)}원`, true],
        [`${total < 1 ? total.toFixed(4) : total.toFixed(2)}원`, true],
      ] as [string, boolean][]) {
        const td = row.createEl('td', { text });
        td.style.cssText = `padding: 5px 8px; text-align: right;`;
      }
    }

    estBox.createEl('div', {
      text: `* 출력 약 ${AVG_OUTPUT_TOKENS}토큰 가정 · 환율 ${EXCHANGE_RATE_KRW}원/$ · 정사각형 이미지 기준`,
      attr: { style: 'margin-top: 6px; color: var(--text-faint); font-size: 0.85em;' },
    });

    // ── 실사용 누적 비용 ────────────────────────────────────────────
    const usageBox = this.createInfoBox(containerEl);

    const headerRow = usageBox.createDiv({
      attr: {
        style:
          'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;',
      },
    });
    headerRow.createEl('div', { text: '💳 실사용 누적 비용', attr: { style: 'font-weight: 600;' } });

    const resetBtn = headerRow.createEl('button', { text: '초기화' });
    resetBtn.style.cssText = 'font-size: 0.8em; padding: 2px 8px; cursor: pointer;';
    resetBtn.addEventListener('click', async () => {
      this.plugin.settings.altTextTotalRequests = 0;
      this.plugin.settings.altTextTotalPromptTokens = 0;
      this.plugin.settings.altTextTotalCompletionTokens = 0;
      this.plugin.settings.altTextTotalCostWon = 0;
      this.plugin.settings.altTextStatsUpdatedAt = '';
      await this.plugin.saveSettings();
      this.display();
    });

    if (s.altTextTotalRequests === 0) {
      usageBox.createEl('div', {
        text: '아직 사용 내역이 없습니다.',
        attr: { style: 'color: var(--text-muted);' },
      });
    } else {
      const updatedAt = s.altTextStatsUpdatedAt
        ? new Date(s.altTextStatsUpdatedAt).toLocaleString('ko-KR')
        : '–';

      this.renderRows(usageBox, [
        ['누적 요청 수', `${s.altTextTotalRequests.toLocaleString()}건`],
        ['입력 토큰', `${s.altTextTotalPromptTokens.toLocaleString()}`],
        ['출력 토큰', `${s.altTextTotalCompletionTokens.toLocaleString()}`],
        ['누적 총 비용', `약 ${s.altTextTotalCostWon.toFixed(6)}원`],
        ['마지막 업데이트', updatedAt],
      ]);
      usageBox.createEl('div', {
        text: '* 각 요청 시점의 선택 모델 단가로 누적 계산',
        attr: { style: 'margin-top: 6px; color: var(--text-faint); font-size: 0.85em;' },
      });
    }
  }

  private createInfoBox(containerEl: HTMLElement): HTMLElement {
    const box = containerEl.createDiv();
    box.style.cssText = `
      padding: 10px 14px;
      margin: 8px 0 4px;
      background: var(--background-secondary);
      border-radius: 6px;
      font-size: 0.9em;
      line-height: 1.6;
    `;
    return box;
  }

  private renderRows(el: HTMLElement, rows: [string, string][]): void {
    for (const [label, value] of rows) {
      const row = el.createDiv({
        attr: { style: 'display: flex; justify-content: space-between; padding: 2px 0;' },
      });
      row.createEl('span', { text: label, attr: { style: 'color: var(--text-muted);' } });
      row.createEl('span', { text: value, attr: { style: 'font-weight: 500;' } });
    }
  }
}
