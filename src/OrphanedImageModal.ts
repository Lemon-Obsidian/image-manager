import { App, Modal, Notice, TFile } from 'obsidian';
import { formatBytes } from './utils';

export class OrphanedImageModal extends Modal {
  private checked = new Set<string>();

  constructor(
    app: App,
    private files: TFile[]
  ) {
    super(app);
    // 기본 전체 선택
    for (const f of files) this.checked.add(f.path);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.style.width = '720px';
    this.modalEl.style.maxWidth = '90vw';

    // ── 헤더 ──────────────────────────────────────────────────────
    const header = contentEl.createDiv({
      attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;' },
    });
    header.createEl('h2', { text: '고아 이미지', attr: { style: 'margin:0;' } });

    const totalSize = this.files.reduce((s, f) => s + f.stat.size, 0);
    header.createEl('span', {
      text: `${this.files.length}개 · ${formatBytes(totalSize)}`,
      attr: { style: 'color:var(--text-muted);font-size:0.9em;' },
    });

    if (this.files.length === 0) {
      contentEl.createEl('p', {
        text: '어떤 노트에도 링크되지 않은 이미지가 없습니다.',
        attr: { style: 'color:var(--text-muted);text-align:center;padding:32px 0;' },
      });
      return;
    }

    // ── 컨트롤 바 ────────────────────────────────────────────────
    const bar = contentEl.createDiv({
      attr: { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px;' },
    });

    const selectAllBtn = bar.createEl('button', { text: '전체 선택' });
    selectAllBtn.style.cssText = 'font-size:0.85em;padding:3px 10px;cursor:pointer;';
    selectAllBtn.addEventListener('click', () => {
      for (const f of this.files) this.checked.add(f.path);
      this.refreshList(list);
      this.refreshDeleteBtn(deleteBtn);
    });

    const deselectAllBtn = bar.createEl('button', { text: '전체 해제' });
    deselectAllBtn.style.cssText = 'font-size:0.85em;padding:3px 10px;cursor:pointer;';
    deselectAllBtn.addEventListener('click', () => {
      this.checked.clear();
      this.refreshList(list);
      this.refreshDeleteBtn(deleteBtn);
    });

    bar.createDiv({ attr: { style: 'flex:1;' } }); // spacer

    const deleteBtn = bar.createEl('button');
    deleteBtn.style.cssText = 'font-size:0.9em;padding:4px 14px;cursor:pointer;background:var(--color-red);color:#fff;border:none;border-radius:4px;';
    this.refreshDeleteBtn(deleteBtn);
    deleteBtn.addEventListener('click', () => this.deleteSelected(deleteBtn));

    // ── 파일 목록 ────────────────────────────────────────────────
    const list = contentEl.createDiv();
    list.style.cssText = 'max-height:60vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;';
    this.refreshList(list);
  }

  private refreshList(container: HTMLElement): void {
    container.empty();
    for (const file of this.files) {
      this.renderRow(container, file);
    }
  }

  private renderRow(container: HTMLElement, file: TFile): void {
    const row = container.createDiv();
    row.style.cssText = `
      display:flex;gap:10px;align-items:center;
      padding:8px 10px;border-radius:6px;cursor:pointer;
      background:${this.checked.has(file.path) ? 'var(--background-modifier-active-hover)' : 'var(--background-secondary)'};
      border:1px solid var(--background-modifier-border);
    `;

    // 체크박스
    const checkbox = row.createEl('input', { type: 'checkbox' } as any) as HTMLInputElement;
    checkbox.checked = this.checked.has(file.path);
    checkbox.style.cssText = 'flex-shrink:0;width:16px;height:16px;cursor:pointer;';

    // 썸네일
    const thumb = row.createDiv();
    thumb.style.cssText = 'flex-shrink:0;width:56px;height:56px;border-radius:4px;overflow:hidden;background:var(--background-modifier-border);display:flex;align-items:center;justify-content:center;';
    const url = this.app.vault.getResourcePath(file);
    const img = thumb.createEl('img');
    img.src = url;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    img.onerror = () => { thumb.empty(); thumb.createEl('span', { text: '🖼', attr: { style: 'font-size:1.5em;' } }); };

    // 파일 정보
    const info = row.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
    info.createEl('div', {
      text: file.name,
      attr: { style: 'font-size:0.9em;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
    });
    info.createEl('div', {
      text: `${file.parent?.path ?? '/'} · ${formatBytes(file.stat.size)}`,
      attr: { style: 'font-size:0.78em;color:var(--text-muted);margin-top:2px;' },
    });

    // 클릭 토글
    const toggle = () => {
      if (this.checked.has(file.path)) {
        this.checked.delete(file.path);
        checkbox.checked = false;
        row.style.background = 'var(--background-secondary)';
      } else {
        this.checked.add(file.path);
        checkbox.checked = true;
        row.style.background = 'var(--background-modifier-active-hover)';
      }
    };
    row.addEventListener('click', (e) => { if (e.target !== checkbox) toggle(); });
    checkbox.addEventListener('change', toggle);
  }

  private refreshDeleteBtn(btn: HTMLButtonElement): void {
    const n = this.checked.size;
    const size = this.files
      .filter((f) => this.checked.has(f.path))
      .reduce((s, f) => s + f.stat.size, 0);
    btn.textContent = n > 0 ? `선택 삭제 (${n}개 · ${formatBytes(size)})` : '선택 삭제';
    btn.disabled = n === 0;
  }

  private async deleteSelected(btn: HTMLButtonElement): Promise<void> {
    if (this.checked.size === 0) return;

    btn.disabled = true;
    btn.textContent = '삭제 중…';

    let deleted = 0;
    let failed = 0;
    for (const path of [...this.checked]) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      try {
        await this.app.vault.trash(file, true);
        deleted++;
      } catch (e) {
        console.error(`OrphanedImageModal: 삭제 실패 (${path})`, e);
        failed++;
      }
    }

    new Notice(
      failed > 0
        ? `🗑 ${deleted}개 삭제 완료 / ${failed}개 실패`
        : `🗑 ${deleted}개를 휴지통으로 이동했습니다.`
    );
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
