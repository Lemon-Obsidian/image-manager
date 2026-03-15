import { App, Modal, TFile } from 'obsidian';
import { DuplicateGroup } from './DuplicateDetector';
import { formatBytes } from './utils';

export class DuplicateModal extends Modal {
  constructor(
    app: App,
    private groups: DuplicateGroup[]
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '중복 이미지 탐지 결과' });

    if (this.groups.length === 0) {
      contentEl.createEl('p', { text: '중복 이미지가 없습니다.' });
      return;
    }

    contentEl.createEl('p', {
      text: `${this.groups.length}개 그룹에서 중복 이미지가 발견되었습니다.`,
    });

    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i];
      const groupEl = contentEl.createDiv({ cls: 'duplicate-group' });
      groupEl.style.marginBottom = '16px';
      groupEl.style.padding = '12px';
      groupEl.style.border = '1px solid var(--background-modifier-border)';
      groupEl.style.borderRadius = '6px';

      groupEl.createEl('h4', {
        text: `그룹 ${i + 1} (${group.files.length}개 파일)`,
        attr: { style: 'margin: 0 0 8px 0;' },
      });

      for (const file of group.files) {
        const fileEl = groupEl.createDiv({ cls: 'duplicate-file' });
        fileEl.style.display = 'flex';
        fileEl.style.alignItems = 'center';
        fileEl.style.justifyContent = 'space-between';
        fileEl.style.padding = '6px 0';
        fileEl.style.borderBottom = '1px solid var(--background-modifier-border-hover)';

        const infoEl = fileEl.createDiv();
        infoEl.createEl('div', {
          text: file.name,
          attr: { style: 'font-weight: 500;' },
        });
        infoEl.createEl('div', {
          text: file.path,
          attr: { style: 'font-size: 0.85em; color: var(--text-muted);' },
        });
        infoEl.createEl('div', {
          text: formatBytes(file.stat.size),
          attr: { style: 'font-size: 0.85em; color: var(--text-muted);' },
        });

        const btnEl = fileEl.createDiv({ attr: { style: 'display: flex; gap: 6px; flex-shrink: 0;' } });

        const openBtn = btnEl.createEl('button', { text: '열기' });
        openBtn.addEventListener('click', () => {
          this.app.workspace.openLinkText(file.path, '', false);
        });

        const deleteBtn = btnEl.createEl('button', { text: '삭제' });
        deleteBtn.style.color = 'var(--text-error)';
        deleteBtn.addEventListener('click', async () => {
          await this.app.vault.trash(file, true);
          fileEl.remove();
          // 그룹에 파일이 1개만 남으면 그룹 제목 업데이트
          const remaining = groupEl.querySelectorAll('.duplicate-file').length;
          if (remaining === 0) {
            groupEl.remove();
          }
        });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
