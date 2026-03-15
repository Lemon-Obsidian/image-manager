import { App, Modal, Notice, TFile } from 'obsidian';
import { BrokenLink, BrokenLinkFinder } from './BrokenLinkFinder';

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

  constructor(
    app: App,
    links: BrokenLink[],
    allImages: TFile[],
    orphanImages: TFile[]
  ) {
    super(app);
    this.links = links;
    this.allImages = allImages;
    this.orphanImages = orphanImages;
    this.autoMatch();
  }

  private autoMatch(): void {
    for (const link of this.links) {
      const candidates = BrokenLinkFinder.rankCandidates(link.ref, this.candidates);
      this.repairs.set(this.key(link), candidates[0] ?? null);
    }
  }

  private key(link: BrokenLink): string {
    return `${link.mdFile.path}::${link.ref}`;
  }

  private get candidates(): TFile[] {
    return this.mode === 'orphan' ? this.orphanImages : this.allImages;
  }

  private get assignedCount(): number {
    return [...this.repairs.values()].filter(Boolean).length;
  }

  onOpen(): void {
    this.modalEl.style.width = '880px';
    this.modalEl.style.maxWidth = '95vw';
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

    // ── 후보 모드 토글 ─────────────────────────────────────────────
    const toggleBar = contentEl.createDiv({
      attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:12px;background:var(--background-secondary);padding:8px 12px;border-radius:6px;' },
    });
    toggleBar.createEl('span', { text: '후보 이미지:', attr: { style: 'color:var(--text-muted);font-size:0.85em;' } });

    for (const [label, value] of [
      [`고아 이미지 (${this.orphanImages.length}개)`, 'orphan'],
      [`전체 이미지 (${this.allImages.length}개)`, 'all'],
    ] as [string, CandidateMode][]) {
      const btn = toggleBar.createEl('button', { text: label });
      btn.style.cssText = `font-size:0.85em;padding:3px 12px;cursor:pointer;border-radius:4px;${
        this.mode === value ? 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;' : ''
      }`;
      btn.addEventListener('click', () => {
        this.mode = value;
        this.candPage = 0;
        this.autoMatch();
        this.render();
      });
    }

    // ── 링크 정보 카드 ─────────────────────────────────────────────
    const link = this.links[this.linkIdx];
    const key = this.key(link);
    const selected = this.repairs.get(key) ?? null;
    const ranked = BrokenLinkFinder.rankCandidates(link.ref, this.candidates);

    const infoCard = contentEl.createDiv({
      attr: { style: 'background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:8px;padding:12px 14px;margin-bottom:12px;' },
    });

    const infoTop = infoCard.createDiv({
      attr: { style: 'display:flex;justify-content:space-between;align-items:flex-start;' },
    });
    const infoLeft = infoTop.createDiv();
    infoLeft.createEl('div', {
      text: `📄 ${link.mdFile.basename}`,
      attr: { style: 'font-size:0.82em;color:var(--text-muted);margin-bottom:4px;' },
    });
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

    // ── 후보 그리드 ────────────────────────────────────────────────
    if (ranked.length === 0) {
      contentEl.createEl('div', {
        text: '후보 이미지 없음',
        attr: { style: 'color:var(--text-muted);font-size:0.85em;text-align:center;padding:24px 0;' },
      });
    } else {
      const totalCandPages = Math.ceil(ranked.length / CAND_PAGE_SIZE);
      const candStart = this.candPage * CAND_PAGE_SIZE;
      const pageCands = ranked.slice(candStart, candStart + CAND_PAGE_SIZE);

      const candHeader = contentEl.createDiv({
        attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;' },
      });
      candHeader.createEl('span', {
        text: `후보 이미지 (${ranked.length}개)`,
        attr: { style: 'font-size:0.85em;color:var(--text-muted);' },
      });

      const grid = contentEl.createDiv({
        attr: { style: `display:grid;grid-template-columns:repeat(${COLS},1fr);gap:10px;margin-bottom:10px;` },
      });
      for (const cand of pageCands) {
        this.renderCandCard(grid, cand, selected, key);
      }

      // 후보 페이지네이션
      if (totalCandPages > 1) {
        const candNav = contentEl.createDiv({
          attr: { style: 'display:flex;justify-content:center;align-items:center;gap:10px;margin-bottom:10px;' },
        });
        const cpPrev = candNav.createEl('button', { text: '← 이전' });
        cpPrev.disabled = this.candPage === 0;
        cpPrev.style.cssText = 'font-size:0.85em;padding:3px 10px;cursor:pointer;';
        cpPrev.addEventListener('click', () => { this.candPage--; this.render(); });

        candNav.createEl('span', {
          text: `${this.candPage + 1} / ${totalCandPages}`,
          attr: { style: 'font-size:0.85em;color:var(--text-muted);min-width:50px;text-align:center;' },
        });

        const cpNext = candNav.createEl('button', { text: '다음 →' });
        cpNext.disabled = this.candPage >= totalCandPages - 1;
        cpNext.style.cssText = 'font-size:0.85em;padding:3px 10px;cursor:pointer;';
        cpNext.addEventListener('click', () => { this.candPage++; this.render(); });
      }
    }

    // ── 하단 네비게이션 ────────────────────────────────────────────
    const nav = contentEl.createDiv({
      attr: { style: 'display:flex;align-items:center;gap:8px;padding-top:10px;border-top:1px solid var(--background-modifier-border);' },
    });

    const prevBtn = nav.createEl('button', { text: '← 이전' });
    prevBtn.disabled = this.linkIdx === 0;
    prevBtn.style.cssText = 'padding:4px 12px;cursor:pointer;';
    prevBtn.addEventListener('click', () => { this.linkIdx--; this.candPage = 0; this.render(); });

    const skipBtn = nav.createEl('button', { text: '건너뜀' });
    skipBtn.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:0.85em;';
    skipBtn.addEventListener('click', () => {
      this.repairs.set(key, null);
      if (this.linkIdx < this.links.length - 1) { this.linkIdx++; this.candPage = 0; }
      this.render();
    });

    nav.createDiv({ attr: { style: 'flex:1;' } });

    const n = this.assignedCount;
    const applyBtn = nav.createEl('button', {
      text: n > 0 ? `${n}개 링크 복구 적용` : '복구 적용',
    });
    applyBtn.disabled = n === 0;
    applyBtn.style.cssText = `padding:4px 14px;cursor:pointer;font-size:0.9em;${
      n > 0 ? 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;' : ''
    }`;
    applyBtn.addEventListener('click', () => this.applyAll());

    const nextBtn = nav.createEl('button', { text: '다음 →' });
    nextBtn.disabled = this.linkIdx >= this.links.length - 1;
    nextBtn.style.cssText = 'padding:4px 12px;cursor:pointer;';
    nextBtn.addEventListener('click', () => { this.linkIdx++; this.candPage = 0; this.render(); });
  }

  private renderCandCard(container: HTMLElement, file: TFile, selected: TFile | null, key: string): void {
    const isSelected = selected?.path === file.path;

    const card = container.createDiv();
    card.style.cssText = `
      position:relative;border-radius:8px;overflow:hidden;cursor:pointer;
      border:2px solid ${isSelected ? 'var(--color-accent)' : 'transparent'};
      background:var(--background-secondary);
      transition:border-color 0.15s;
    `;

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

    // 체크 오버레이
    const checkOverlay = imgWrap.createDiv();
    checkOverlay.style.cssText = `
      position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:0.8em;
      background:${isSelected ? 'var(--color-accent)' : 'rgba(0,0,0,0.35)'};
      color:#fff;transition:background 0.15s;font-weight:bold;
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

    // 파일명
    card.createDiv({
      text: file.name,
      attr: { style: 'padding:5px 7px;font-size:0.78em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);' },
    });

    // 클릭 → 선택
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

    const byNote = new Map<string, { link: BrokenLink; replacement: TFile }[]>();
    for (const link of this.links) {
      const replacement = this.repairs.get(this.key(link));
      if (!replacement) { skipped++; continue; }
      const arr = byNote.get(link.mdFile.path) ?? [];
      arr.push({ link, replacement });
      byNote.set(link.mdFile.path, arr);
    }

    for (const [, items] of byNote) {
      const mdFile = items[0].link.mdFile;
      let content = await this.app.vault.read(mdFile);
      for (const { link, replacement } of items) {
        const newLink = `![[${replacement.name}${link.alt ? `|${link.alt}` : ''}]]`;
        content = content.split(link.original).join(newLink);
        fixed++;
      }
      await this.app.vault.modify(mdFile, content);
    }

    new Notice(`✓ ${fixed}개 링크 복구 완료${skipped > 0 ? ` / ${skipped}개 건너뜀` : ''}`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    document.querySelectorAll(`.${ZOOM_OVERLAY_CLASS}`).forEach(el => el.remove());
  }
}
