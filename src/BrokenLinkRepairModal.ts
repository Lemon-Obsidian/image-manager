import { App, Modal, Notice, TFile } from 'obsidian';
import { BrokenLink, BrokenLinkFinder } from './BrokenLinkFinder';
import { AltTextGenerator } from './AltTextGenerator';
import { ImageManagerSettings } from './types';

type CandidateMode = 'orphan' | 'all';
const COLS = 4;
const CAND_PAGE_SIZE = 12;
const ZOOM_OVERLAY_CLASS = 'broken-link-zoom-overlay';

export class BrokenLinkRepairModal extends Modal {
  private mode: CandidateMode = 'orphan';
  private repairs = new Map<string, TFile | null>();
  private links: BrokenLink[] = [];
  private allImages: TFile[] = [];
  private orphanImages: TFile[] = [];
  private linkIdx = 0;
  private candPage = 0;
  private searchQuery = '';
  /** 노트별 편집 내용. 삭제·수동 편집 모두 여기에 누적됨 */
  private noteEdits = new Map<string, string>();

  constructor(
    app: App,
    private settings: ImageManagerSettings,
    links: BrokenLink[],
    allImages: TFile[],
    orphanImages: TFile[]
  ) {
    super(app);
    this.links = links;
    this.allImages = allImages;
    this.orphanImages = orphanImages;
    for (const link of this.links) this.repairs.set(this.key(link), null);
  }

  private key(link: BrokenLink): string {
    return `${link.mdFile.path}::${link.ref}`;
  }

  private get candidates(): TFile[] {
    return this.mode === 'orphan' ? this.orphanImages : this.allImages;
  }

  private get repairCount(): number {
    return [...this.repairs.values()].filter(v => v instanceof TFile).length;
  }

  private get editCount(): number {
    return this.noteEdits.size;
  }

  onOpen(): void {
    this.modalEl.style.width = '1360px';
    this.modalEl.style.maxWidth = '96vw';
    if (this.links.length > 0) {
      this.loadAndRender(this.links[this.linkIdx].mdFile);
    } else {
      this.render();
    }
  }

  private async loadAndRender(file: TFile): Promise<void> {
    if (!this.noteEdits.has(file.path)) {
      this.noteEdits.set(file.path, await this.app.vault.read(file));
    }
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ── 헤더 ───────────────────────────────────────────────────────
    const header = contentEl.createDiv({
      attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;' },
    });
    header.createEl('h2', { text: '깨진 이미지 링크 복구', attr: { style: 'margin:0;' } });
    header.createEl('span', {
      text: `${this.links.length}개 깨진 링크`,
      attr: { style: 'color:var(--text-muted);font-size:0.9em;' },
    });

    if (this.links.length === 0) {
      contentEl.createEl('p', {
        text: '깨진 이미지 링크가 없습니다.',
        attr: { style: 'color:var(--text-muted);text-align:center;padding:32px 0;' },
      });
      return;
    }

    // ── 좌우 분할 ──────────────────────────────────────────────────
    const main = contentEl.createDiv({
      attr: { style: 'display:flex;gap:0;align-items:stretch;height:calc(85vh - 80px);overflow:hidden;' },
    });

    const link = this.links[this.linkIdx];
    this.renderNotePanel(main, link);
    this.renderCandidatePanel(main, link);
  }

  // ── 좌측: 편집 가능한 노트 뷰어 ────────────────────────────────
  private renderNotePanel(container: HTMLElement, link: BrokenLink): void {
    const panel = container.createDiv({
      attr: { style: 'width:42%;display:flex;flex-direction:column;border-right:1px solid var(--background-modifier-border);padding-right:14px;overflow:hidden;' },
    });

    panel.createDiv({
      text: `📄 ${link.mdFile.basename}`,
      attr: { style: 'font-size:0.85em;font-weight:600;color:var(--text-muted);padding-bottom:8px;flex-shrink:0;' },
    });

    const content = this.noteEdits.get(link.mdFile.path) ?? '';

    const textarea = panel.createEl('textarea');
    textarea.value = content;
    textarea.style.cssText = `
      flex:1;width:100%;box-sizing:border-box;resize:none;
      background:var(--background-primary);color:var(--text-normal);
      border:1px solid var(--background-modifier-border);border-radius:6px;
      padding:10px 12px;font-size:0.8em;line-height:1.7;
      font-family:var(--font-monospace);
    `;

    // 편집 즉시 반영
    textarea.addEventListener('input', () => {
      this.noteEdits.set(link.mdFile.path, textarea.value);
    });

    // 깨진 링크 라인으로 스크롤
    const hlIdx = content.split('\n').findIndex(l => l.includes(link.original));
    if (hlIdx >= 0) {
      setTimeout(() => {
        const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 22;
        textarea.scrollTop = Math.max(0, (hlIdx - 3) * lineHeight);
      }, 60);
    }
  }

  // ── 우측: 후보 선택 패널 ────────────────────────────────────────
  private renderCandidatePanel(container: HTMLElement, link: BrokenLink): void {
    const panel = container.createDiv({
      attr: { style: 'flex:1;display:flex;flex-direction:column;padding-left:14px;overflow:hidden;' },
    });

    const key = this.key(link);
    const selected = this.repairs.get(key) ?? null;
    const allRanked = BrokenLinkFinder.rankCandidates(link.ref, this.candidates);
    const ranked = this.searchQuery
      ? allRanked.filter(f => f.name.toLowerCase().includes(this.searchQuery.toLowerCase()))
      : allRanked;

    const scrollArea = panel.createDiv({ attr: { style: 'flex:1;overflow-y:auto;' } });

    // ── 링크 정보 ─────────────────────────────────────────────
    const infoCard = scrollArea.createDiv({
      attr: { style: 'background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:8px;padding:10px 12px;margin-bottom:10px;' },
    });
    const infoTop = infoCard.createDiv({
      attr: { style: 'display:flex;justify-content:space-between;align-items:flex-start;' },
    });
    const infoLeft = infoTop.createDiv();
    infoLeft.createEl('div', {
      text: `🔴 ${link.ref}`,
      attr: { style: 'font-size:0.9em;font-weight:600;color:var(--color-red);word-break:break-all;' },
    });
    if (link.alt) {
      infoLeft.createEl('div', {
        text: `alt: ${link.alt}`,
        attr: { style: 'font-size:0.78em;color:var(--text-faint);margin-top:2px;' },
      });
    }
    infoTop.createEl('span', {
      text: `${this.linkIdx + 1} / ${this.links.length}`,
      attr: { style: 'font-size:0.85em;color:var(--text-muted);white-space:nowrap;margin-left:12px;' },
    });
    if (selected) {
      infoCard.createEl('div', {
        text: `✓ 선택됨: ${selected.name}`,
        attr: { style: 'font-size:0.8em;color:var(--color-accent);margin-top:6px;' },
      });
    }

    // ── 후보 모드 토글 + 검색 ────────────────────────────────
    const controlBar = scrollArea.createDiv({
      attr: { style: 'display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;' },
    });
    controlBar.createEl('span', { text: '후보:', attr: { style: 'color:var(--text-muted);font-size:0.82em;' } });
    for (const [label, value] of [
      [`고아 (${this.orphanImages.length}개)`, 'orphan'],
      [`전체 (${this.allImages.length}개)`, 'all'],
    ] as [string, CandidateMode][]) {
      const btn = controlBar.createEl('button', { text: label });
      btn.style.cssText = `font-size:0.82em;padding:2px 10px;cursor:pointer;border-radius:4px;${
        this.mode === value ? 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;' : ''
      }`;
      btn.addEventListener('click', () => {
        this.mode = value;
        this.candPage = 0;
        this.render();
      });
    }

    controlBar.createDiv({ attr: { style: 'flex:1;' } });

    const searchInput = controlBar.createEl('input') as HTMLInputElement;
    searchInput.type = 'text';
    searchInput.placeholder = '이미지 이름 검색...';
    searchInput.value = this.searchQuery;
    searchInput.style.cssText = 'font-size:0.82em;padding:2px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);width:160px;';
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.candPage = 0;
      this.render();
    });

    // ── 후보 그리드 ───────────────────────────────────────────
    if (allRanked.length === 0) {
      scrollArea.createEl('div', {
        text: '후보 이미지 없음',
        attr: { style: 'color:var(--text-muted);font-size:0.85em;text-align:center;padding:24px 0;' },
      });
    } else if (ranked.length === 0) {
      scrollArea.createEl('div', {
        text: `검색 결과 없음 (전체 ${allRanked.length}개)`,
        attr: { style: 'color:var(--text-muted);font-size:0.85em;text-align:center;padding:24px 0;' },
      });
    } else {
      const totalCandPages = Math.ceil(ranked.length / CAND_PAGE_SIZE);
      const pageCands = ranked.slice(this.candPage * CAND_PAGE_SIZE, (this.candPage + 1) * CAND_PAGE_SIZE);

      scrollArea.createEl('div', {
        text: `후보 이미지 (${ranked.length}개${this.searchQuery ? ` / 전체 ${allRanked.length}개` : ''})`,
        attr: { style: 'font-size:0.82em;color:var(--text-muted);margin-bottom:6px;' },
      });

      const grid = scrollArea.createDiv({
        attr: { style: `display:grid;grid-template-columns:repeat(${COLS},1fr);gap:8px;margin-bottom:8px;` },
      });
      for (const cand of pageCands) {
        this.renderCandCard(grid, cand, selected, key);
      }

      if (totalCandPages > 1) {
        const candNav = scrollArea.createDiv({
          attr: { style: 'display:flex;justify-content:center;align-items:center;gap:10px;margin-bottom:8px;' },
        });
        const cpPrev = candNav.createEl('button', { text: '← 이전' });
        cpPrev.disabled = this.candPage === 0;
        cpPrev.style.cssText = 'font-size:0.82em;padding:2px 8px;cursor:pointer;';
        cpPrev.addEventListener('click', () => { this.candPage--; this.render(); });
        candNav.createEl('span', {
          text: `${this.candPage + 1} / ${totalCandPages}`,
          attr: { style: 'font-size:0.82em;color:var(--text-muted);min-width:44px;text-align:center;' },
        });
        const cpNext = candNav.createEl('button', { text: '다음 →' });
        cpNext.disabled = this.candPage >= totalCandPages - 1;
        cpNext.style.cssText = 'font-size:0.82em;padding:2px 8px;cursor:pointer;';
        cpNext.addEventListener('click', () => { this.candPage++; this.render(); });
      }
    }

    // ── 하단 네비게이션 (고정) ────────────────────────────────
    const nav = panel.createDiv({
      attr: { style: 'flex-shrink:0;display:flex;align-items:center;gap:8px;padding-top:10px;border-top:1px solid var(--background-modifier-border);' },
    });

    const prevBtn = nav.createEl('button', { text: '← 이전' });
    prevBtn.disabled = this.linkIdx === 0;
    prevBtn.style.cssText = 'padding:4px 12px;cursor:pointer;';
    prevBtn.addEventListener('click', () => {
      this.linkIdx--;
      this.candPage = 0;
      this.searchQuery = '';
      this.loadAndRender(this.links[this.linkIdx].mdFile);
    });

    const skipBtn = nav.createEl('button', { text: '건너뜀' });
    skipBtn.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:0.85em;';
    skipBtn.addEventListener('click', () => {
      this.repairs.set(key, null);
      this.goNext();
    });

    const deleteLinkBtn = nav.createEl('button', { text: '링크 삭제' });
    deleteLinkBtn.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:0.85em;color:var(--color-red);';
    deleteLinkBtn.addEventListener('click', () => {
      const current = this.noteEdits.get(link.mdFile.path) ?? '';
      const lines = current.split('\n');
      const lineIdx = lines.findIndex(l => l.includes(link.original));
      if (lineIdx >= 0) {
        const trimmed = lines[lineIdx].replace(link.original, '').trim();
        if (trimmed === '') lines.splice(lineIdx, 1);
        else lines[lineIdx] = lines[lineIdx].replace(link.original, '');
        this.noteEdits.set(link.mdFile.path, lines.join('\n'));
      }
      this.repairs.set(key, null);
      this.goNext();
    });

    nav.createDiv({ attr: { style: 'flex:1;' } });

    const rc = this.repairCount;
    const ec = this.editCount;
    const total = rc + ec;
    const applyLabel = total === 0 ? '적용'
      : rc > 0 && ec > 0 ? `복구 ${rc}개 · 편집 저장 적용`
      : rc > 0 ? `${rc}개 링크 복구 적용`
      : `편집 저장 적용`;
    const applyBtn = nav.createEl('button', { text: applyLabel });
    applyBtn.disabled = total === 0;
    applyBtn.style.cssText = `padding:4px 14px;cursor:pointer;font-size:0.9em;${
      total > 0 ? 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;' : ''
    }`;
    applyBtn.addEventListener('click', () => this.applyAll());

    const nextBtn = nav.createEl('button', { text: '다음 →' });
    nextBtn.disabled = this.linkIdx >= this.links.length - 1;
    nextBtn.style.cssText = 'padding:4px 12px;cursor:pointer;';
    nextBtn.addEventListener('click', () => {
      this.linkIdx++;
      this.candPage = 0;
      this.searchQuery = '';
      this.loadAndRender(this.links[this.linkIdx].mdFile);
    });
  }

  private goNext(): void {
    if (this.linkIdx < this.links.length - 1) {
      this.linkIdx++;
      this.candPage = 0;
      this.searchQuery = '';
      this.loadAndRender(this.links[this.linkIdx].mdFile);
    } else {
      this.render();
    }
  }

  private renderCandCard(container: HTMLElement, file: TFile, selected: TFile | null, key: string): void {
    const isSelected = selected?.path === file.path;

    const card = container.createDiv();
    card.style.cssText = `
      position:relative;border-radius:8px;overflow:hidden;cursor:pointer;
      border:2px solid ${isSelected ? 'var(--color-accent)' : 'transparent'};
      background:var(--background-secondary);transition:border-color 0.15s;
    `;

    const imgWrap = card.createDiv({
      attr: { style: 'width:100%;aspect-ratio:1;overflow:hidden;background:var(--background-modifier-border);position:relative;' },
    });

    const img = imgWrap.createEl('img');
    img.src = this.app.vault.getResourcePath(file);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.onerror = () => {
      imgWrap.empty();
      const ph = imgWrap.createEl('span', { text: '🖼' });
      ph.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:2em;';
    };

    // 체크 오버레이
    const checkOverlay = imgWrap.createDiv();
    checkOverlay.style.cssText = `
      position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:0.8em;
      background:${isSelected ? 'var(--color-accent)' : 'rgba(0,0,0,0.35)'};
      color:#fff;font-weight:bold;
    `;
    checkOverlay.textContent = isSelected ? '✓' : '';

    // 확대 버튼
    const zoomBtn = imgWrap.createDiv({ text: '🔍' });
    zoomBtn.style.cssText = `
      position:absolute;top:6px;right:6px;
      background:rgba(0,0,0,0.55);color:#fff;border-radius:4px;
      padding:3px 6px;font-size:0.75em;opacity:0;transition:opacity 0.15s;
      cursor:zoom-in;user-select:none;
    `;
    imgWrap.addEventListener('mouseenter', () => { zoomBtn.style.opacity = '1'; });
    imgWrap.addEventListener('mouseleave', () => { zoomBtn.style.opacity = '0'; });
    zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showZoom(file); });

    card.createDiv({
      text: file.name,
      attr: { style: 'padding:5px 7px;font-size:0.78em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);' },
    });

    card.addEventListener('click', () => {
      this.repairs.set(key, file);
      this.render();
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  private async applyAll(): Promise<void> {
    let fixed = 0;
    let skipped = 0;

    const generator = new AltTextGenerator(this.app, this.settings);

    // TFile 복구: noteEdits 위에 적용
    for (const link of this.links) {
      const replacement = this.repairs.get(this.key(link));
      if (!(replacement instanceof TFile)) { skipped++; continue; }
      const base = this.noteEdits.get(link.mdFile.path) ?? await this.app.vault.read(link.mdFile);
      const altText = await generator.getExistingAltText(replacement);
      const newLink = `![[${replacement.name}${altText ? `|${altText}` : ''}]]`;
      this.noteEdits.set(link.mdFile.path, base.split(link.original).join(newLink));
      fixed++;
    }

    // noteEdits에 있는 모든 노트 저장 (링크 삭제 + 수동 편집 + 복구 포함)
    for (const [notePath, content] of this.noteEdits) {
      const mdFile = this.app.vault.getAbstractFileByPath(notePath);
      if (mdFile instanceof TFile) {
        await this.app.vault.modify(mdFile, content);
      }
    }

    const parts = [];
    if (fixed > 0) parts.push(`${fixed}개 복구`);
    const editedNotes = this.noteEdits.size;
    if (editedNotes > 0 && fixed === 0) parts.push(`${editedNotes}개 노트 편집 저장`);
    else if (editedNotes > fixed) parts.push(`편집 저장`);
    if (skipped > 0) parts.push(`${skipped}개 건너뜀`);

    new Notice(`✓ ${parts.join(' / ')}`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    document.querySelectorAll(`.${ZOOM_OVERLAY_CLASS}`).forEach(el => el.remove());
  }
}
