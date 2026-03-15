import { App, Modal } from 'obsidian';
import { AltTextHistoryRecord } from './types';

export class AltTextHistoryModal extends Modal {
  constructor(
    app: App,
    private history: AltTextHistoryRecord[],
    private onClear: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // 헤더
    const header = contentEl.createDiv({
      attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' },
    });
    header.createEl('h2', { text: 'Alt Text 생성 히스토리', attr: { style: 'margin: 0;' } });

    if (this.history.length > 0) {
      const clearBtn = header.createEl('button', { text: '전체 삭제' });
      clearBtn.style.cssText = 'font-size: 0.85em; padding: 4px 10px; cursor: pointer;';
      clearBtn.addEventListener('click', () => {
        this.onClear();
        this.close();
      });
    }

    if (this.history.length === 0) {
      contentEl.createEl('p', {
        text: '아직 생성 내역이 없습니다.',
        attr: { style: 'color: var(--text-muted); text-align: center; padding: 32px 0;' },
      });
      return;
    }

    // 총 개수
    contentEl.createEl('div', {
      text: `총 ${this.history.length.toLocaleString()}개 기록`,
      attr: { style: 'color: var(--text-muted); font-size: 0.85em; margin-bottom: 8px;' },
    });

    // 스크롤 컨테이너
    const scroll = contentEl.createDiv();
    scroll.style.cssText = 'max-height: 60vh; overflow-y: auto;';

    const table = scroll.createEl('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 0.9em;';

    // 헤더
    const thead = table.createEl('thead');
    const hRow = thead.createEl('tr');
    for (const [text, width] of [
      ['시간', '140px'],
      ['파일명', '160px'],
      ['Alt Text', 'auto'],
      ['모델', '100px'],
      ['토큰', '80px'],
    ] as [string, string][]) {
      const th = hRow.createEl('th', { text });
      th.style.cssText = `
        text-align: left;
        padding: 6px 8px;
        border-bottom: 2px solid var(--background-modifier-border);
        color: var(--text-muted);
        font-weight: 500;
        width: ${width};
        position: sticky;
        top: 0;
        background: var(--background-primary);
      `;
    }

    // 행
    const tbody = table.createEl('tbody');
    for (const rec of this.history) {
      const row = tbody.createEl('tr');
      row.style.cssText = 'border-bottom: 1px solid var(--background-modifier-border);';

      const date = new Date(rec.timestamp).toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });

      for (const [text, title] of [
        [date, rec.timestamp],
        [rec.fileName, rec.fileName],
        [rec.altText, rec.altText],
        [rec.model, rec.model],
        [`${(rec.promptTokens + rec.completionTokens).toLocaleString()}`, `입력 ${rec.promptTokens} / 출력 ${rec.completionTokens}`],
      ] as [string, string][]) {
        const td = row.createEl('td', { text });
        td.title = title;
        td.style.cssText = 'padding: 6px 8px; vertical-align: top; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
