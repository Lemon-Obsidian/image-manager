import { App, Modal, Notice, TFile } from 'obsidian';
import { formatBytes } from './utils';

const PAGE_SIZE = 12;
const COLS = 4;
const ZOOM_OVERLAY_CLASS = 'orphan-zoom-overlay';

export class OrphanedImageModal extends Modal {
  private checked = new Set<string>();
  private page = 0;

  constructor(app: App, private files: TFile[]) {
    super(app);
    for (const f of files) this.checked.add(f.path);
  }

  private get totalPages(): number {
    return Math.max(1, Math.ceil(this.files.length / PAGE_SIZE));
  }

  onOpen(): void {
    this.modalEl.style.width = '880px';
    this.modalEl.style.maxWidth = '95vw';
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ── 빈 상태 ────────────────────────────────────────────────────
    if (this.files.length === 0) {
      contentEl.createEl('p', {
        text: '어떤 노트에도 링크되지 않은 이미지가 없습니다.',
        attr: { style: 'color:var(--text-muted);text-align:center;padding:40px 0;' },
      });
      return;
    }

    // ── 헤더 ───────────────────────────────────────────────────────
    const header = contentEl.createDiv({
      attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;' },
    });
    header.createEl('h2', { text: '고아 이미지', attr: { style: 'margin:0;' } });
    const totalSize = this.files.reduce((s, f) => s + f.stat.size, 0);
    header.createEl('span', {
      text: `${this.files.length}개 · ${formatBytes(totalSize)}`,
      attr: { style: 'color:var(--text-muted);font-size:0.9em;' },
    });

    // ── 컨트롤 바 ──────────────────────────────────────────────────
    const bar = contentEl.createDiv({
      attr: { style: 'display:flex;gap:8px;align-items:center;margin-bottom:12px;' },
    });

    const selectAllBtn = bar.createEl('button', { text: '전체 선택' });
    selectAllBtn.style.cssText = 'font-size:0.85em;padding:3px 10px;cursor:pointer;';
    selectAllBtn.addEventListener('click', () => {
      for (const f of this.files) this.checked.add(f.path);
      this.render();
    });

    const deselectAllBtn = bar.createEl('button', { text: '전체 해제' });
    deselectAllBtn.style.cssText = 'font-size:0.85em;padding:3px 10px;cursor:pointer;';
    deselectAllBtn.addEventListener('click', () => {
      this.checked.clear();
      this.render();
    });

    bar.createDiv({ attr: { style: 'flex:1;' } });

    const deleteBtn = bar.createEl('button') as HTMLButtonElement;
    deleteBtn.style.cssText = 'font-size:0.9em;padding:4px 14px;cursor:pointer;background:var(--color-red);color:#fff;border:none;border-radius:4px;';
    this.refreshDeleteBtn(deleteBtn);
    deleteBtn.addEventListener('click', () => this.deleteSelected());

    // ── 이미지 그리드 ───────────────────────────────────────────────
    const startIdx = this.page * PAGE_SIZE;
    const pageFiles = this.files.slice(startIdx, startIdx + PAGE_SIZE);

    const grid = contentEl.createDiv({
      attr: { style: `display:grid;grid-template-columns:repeat(${COLS},1fr);gap:10px;margin-bottom:14px;` },
    });

    for (const file of pageFiles) {
      this.renderImageCard(grid, file, deleteBtn);
    }

    // ── 페이지 네비게이션 ───────────────────────────────────────────
    if (this.totalPages > 1) {
      const nav = contentEl.createDiv({
        attr: { style: 'display:flex;justify-content:center;align-items:center;gap:12px;' },
      });

      const prevBtn = nav.createEl('button', { text: '← 이전' });
      prevBtn.disabled = this.page === 0;
      prevBtn.style.cssText = 'padding:4px 12px;cursor:pointer;';
      prevBtn.addEventListener('click', () => { this.page--; this.render(); });

      nav.createEl('span', {
        text: `${this.page + 1} / ${this.totalPages}`,
        attr: { style: 'font-size:0.9em;color:var(--text-muted);min-width:60px;text-align:center;' },
      });

      const nextBtn = nav.createEl('button', { text: '다음 →' });
      nextBtn.disabled = this.page >= this.totalPages - 1;
      nextBtn.style.cssText = 'padding:4px 12px;cursor:pointer;';
      nextBtn.addEventListener('click', () => { this.page++; this.render(); });
    }
  }

  private renderImageCard(container: HTMLElement, file: TFile, deleteBtn: HTMLButtonElement): void {
    const isSelected = this.checked.has(file.path);

    const card = container.createDiv();
    card.style.cssText = `
      position:relative;border-radius:8px;overflow:hidden;cursor:pointer;
      border:2px solid ${isSelected ? 'var(--color-accent)' : 'transparent'};
      background:var(--background-secondary);
      transition:border-color 0.15s;
    `;

    // ── 이미지 영역 (정사각형) ────────────────────────────────────
    const imgWrap = card.createDiv({
      attr: { style: 'width:100%;aspect-ratio:1;overflow:hidden;background:var(--background-modifier-border);position:relative;' },
    });

    const img = imgWrap.createEl('img');
    img.src = this.app.vault.getResourcePath(file);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.onerror = () => {
      imgWrap.empty();
      const placeholder = imgWrap.createEl('span', { text: '🖼' });
      placeholder.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:2em;';
    };

    // ── 체크 오버레이 ─────────────────────────────────────────────
    const checkOverlay = imgWrap.createDiv();
    checkOverlay.style.cssText = `
      position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:0.8em;
      background:${isSelected ? 'var(--color-accent)' : 'rgba(0,0,0,0.35)'};
      color:#fff;transition:background 0.15s;font-weight:bold;
    `;
    checkOverlay.textContent = isSelected ? '✓' : '';

    // ── 확대 버튼 (호버 시 표시) ──────────────────────────────────
    const zoomBtn = imgWrap.createDiv({ text: '🔍' });
    zoomBtn.style.cssText = `
      position:absolute;top:6px;right:6px;
      background:rgba(0,0,0,0.55);color:#fff;border-radius:4px;
      padding:3px 6px;font-size:0.75em;opacity:0;transition:opacity 0.15s;
      cursor:zoom-in;user-select:none;
    `;
    imgWrap.addEventListener('mouseenter', () => { zoomBtn.style.opacity = '1'; });
    imgWrap.addEventListener('mouseleave', () => { zoomBtn.style.opacity = '0'; });
    zoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showZoom(file);
    });

    // ── 파일명 ────────────────────────────────────────────────────
    card.createDiv({
      text: file.name,
      attr: { style: 'padding:5px 7px;font-size:0.78em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);' },
    });

    // ── 클릭 토글 ─────────────────────────────────────────────────
    card.addEventListener('click', () => {
      if (this.checked.has(file.path)) {
        this.checked.delete(file.path);
        card.style.borderColor = 'transparent';
        checkOverlay.style.background = 'rgba(0,0,0,0.35)';
        checkOverlay.textContent = '';
      } else {
        this.checked.add(file.path);
        card.style.borderColor = 'var(--color-accent)';
        checkOverlay.style.background = 'var(--color-accent)';
        checkOverlay.textContent = '✓';
      }
      this.refreshDeleteBtn(deleteBtn);
    });
  }

  private showZoom(file: TFile): void {
    const overlay = document.body.createDiv({ cls: ZOOM_OVERLAY_CLASS });
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.85);
      display:flex;align-items:center;justify-content:center;
      z-index:9999;cursor:zoom-out;
    `;

    const img = overlay.createEl('img');
    img.src = this.app.vault.getResourcePath(file);
    img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:6px;';

    const close = () => overlay.remove();
    overlay.addEventListener('click', close);

    // ESC로도 닫기
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  private refreshDeleteBtn(btn: HTMLButtonElement): void {
    const n = this.checked.size;
    const size = this.files.filter(f => this.checked.has(f.path)).reduce((s, f) => s + f.stat.size, 0);
    btn.textContent = n > 0 ? `선택 삭제 (${n}개 · ${formatBytes(size)})` : '선택 삭제';
    btn.disabled = n === 0;
  }

  private async deleteSelected(): Promise<void> {
    if (this.checked.size === 0) return;

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
    document.querySelectorAll(`.${ZOOM_OVERLAY_CLASS}`).forEach(el => el.remove());
  }
}
