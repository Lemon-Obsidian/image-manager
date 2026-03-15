import { App, Modal, TFile } from 'obsidian';
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
    this.modalEl.style.width = '800px';
    this.modalEl.style.maxWidth = '90vw';

    // 헤더
    const header = contentEl.createDiv({
      attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;' },
    });
    header.createEl('h2', { text: 'Alt Text 생성 히스토리', attr: { style: 'margin:0;' } });

    if (this.history.length > 0) {
      const clearBtn = header.createEl('button', { text: '전체 삭제' });
      clearBtn.style.cssText = 'font-size:0.85em;padding:4px 10px;cursor:pointer;';
      clearBtn.addEventListener('click', () => { this.onClear(); this.close(); });
    }

    if (this.history.length === 0) {
      contentEl.createEl('p', {
        text: '아직 생성 내역이 없습니다.',
        attr: { style: 'color:var(--text-muted);text-align:center;padding:32px 0;' },
      });
      return;
    }

    contentEl.createEl('div', {
      text: `총 ${this.history.length.toLocaleString()}개 기록`,
      attr: { style: 'color:var(--text-muted);font-size:0.85em;margin-bottom:10px;' },
    });

    // 카드 그리드
    const grid = contentEl.createDiv();
    grid.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:65vh;overflow-y:auto;padding-right:4px;';

    for (const rec of this.history) {
      this.renderCard(grid, rec);
    }
  }

  private renderCard(container: HTMLElement, rec: AltTextHistoryRecord): void {
    const card = container.createDiv();
    card.style.cssText = `
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
    `;

    // 썸네일
    const thumb = card.createDiv();
    thumb.style.cssText = 'flex-shrink:0;width:80px;height:80px;border-radius:4px;overflow:hidden;background:var(--background-modifier-border);display:flex;align-items:center;justify-content:center;';

    const file = this.app.vault.getAbstractFileByPath(rec.filePath);
    if (file instanceof TFile) {
      const url = this.app.vault.getResourcePath(file);
      const img = thumb.createEl('img');
      img.src = url;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.onerror = () => {
        thumb.empty();
        thumb.createEl('span', { text: '🖼', attr: { style: 'font-size:1.8em;' } });
      };
    } else {
      thumb.createEl('span', { text: '🖼', attr: { style: 'font-size:1.8em;color:var(--text-muted);' } });
    }

    // 정보 영역
    const info = card.createDiv();
    info.style.cssText = 'flex:1;min-width:0;';

    // alt text (크게)
    info.createEl('div', {
      text: rec.altText || '(빈 응답)',
      attr: {
        style: `font-size:1em;font-weight:500;margin-bottom:4px;word-break:break-word;${!rec.altText ? 'color:var(--text-muted);font-style:italic;' : ''}`,
      },
    });

    // 파일명 + 날짜
    const meta = info.createDiv({ attr: { style: 'display:flex;gap:12px;flex-wrap:wrap;font-size:0.8em;color:var(--text-muted);' } });
    meta.createEl('span', { text: `📄 ${rec.fileName}` });
    meta.createEl('span', {
      text: new Date(rec.timestamp).toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }),
    });
    meta.createEl('span', { text: `${rec.model}` });
    meta.createEl('span', { text: `${(rec.promptTokens + rec.completionTokens).toLocaleString()} 토큰` });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
