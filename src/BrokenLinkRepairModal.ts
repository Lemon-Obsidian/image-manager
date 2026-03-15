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
  private noteCache = new Map<string, string>();
  private currentNoteContent = '';

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
    // 초기값 전부 null — 사용자가 명시적으로 클릭한 것만 복구됨
    for (const link of this.links) {
      this.repairs.set(this.key(link), null);
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
    this.modalEl.style.width = '1360px';
    this.modalEl.style.maxWidth = '96vw';
    if (this.links.length > 0) {
      this.loadAndRender(this.links[this.linkIdx].mdFile);
    } else {
      this.render();
    }
  }

  private async loadAndRender(file: TFile): Promise<void> {
    if (!this.noteCache.has(file.path)) {
      this.noteCache.set(file.path, await this.app.vault.read(file));
    }
    this.currentNoteContent = this.noteCache.get(file.path)!;
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

  // ── 좌측: 노트 뷰어 ──────────────────────────────────────────────
  private renderNotePanel(container: HTMLElement, link: BrokenLink): void {
    const panel = container.createDiv({
      attr: { style: 'width:42%;display:flex;flex-direction:column;border-right:1px solid var(--background-modifier-border);padding-right:14px;overflow:hidden;' },
    });

    // 노트 제목
    panel.createDiv({
      text: `📄 ${link.mdFile.basename}`,
      attr: { style: 'font-size:0.85em;font-weight:600;color:var(--text-muted);padding-bottom:8px;flex-shrink:0;' },
    });

    // 노트 내용
    const contentArea = panel.createDiv({
      attr: { style: 'flex:1;overflow-y:auto;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:6px;' },
    });

    const lines = this.currentNoteContent.split('\n');
    const hlIdx = lines.findIndex(l => l.includes(link.original));

    const pre = contentArea.createEl('pre', {
      attr: { style: 'margin:0;padding:10px 12px;font-size:0.8em;line-height:1.7;white-space:pre-wrap;word-break:break-word;font-family:var(--font-monospace);' },
    });

    // 하이라이트 앞 텍스트
    const beforeText = hlIdx > 0 ? lines.slice(0, hlIdx).join('\n') + '\n' : (hlIdx === 0 ? '' : lines.join('\n'));
    if (beforeText) pre.appendText(beforeText);

    // 하이라이트 라인
    let highlightEl: HTMLElement | null = null;
    if (hlIdx >= 0) {
      const span = pre.createSpan();
      span.textContent = lines[hlIdx] + (hlIdx < lines.length - 1 ? '\n' : '');
      span.style.cssText = 'background:rgba(255,200,0,0.2);display:block;border-left:3px solid var(--color-yellow);padding-left:6px;margin-left:-6px;border-radius:0 2px 2px 0;';
      highlightEl = span;
    }

    // 하이라이트 뒤 텍스트
    if (hlIdx >= 0 && hlIdx < lines.length - 1) {
      pre.appendText(lines.slice(hlIdx + 1).join('\n'));
    }

    // 하이라이트 라인으로 스크롤
    if (highlightEl) {
      setTimeout(() => highlightEl?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    }
  }

  // ── 우측: 후보 선택 패널 ─────────────────────────────────────────
  private renderCandidatePanel(container: HTMLElement, link: BrokenLink): void {
    const panel = container.createDiv({
      attr: { style: 'flex:1;display:flex;flex-direction:column;padding-left:14px;overflow:hidden;' },
    });

    const key = this.key(link);
    const selected = this.repairs.get(key) ?? null;
    const ranked = BrokenLinkFinder.rankCandidates(link.ref, this.candidates);

    // 스크롤 가능한 상단 영역
    const scrollArea = panel.createDiv({
      attr: { style: 'flex:1;overflow-y:auto;' },
    });

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

    // ── 후보 모드 토글 ────────────────────────────────────────
    const toggleBar = scrollArea.createDiv({
      attr: { style: 'display:flex;align-items:center;gap:6px;margin-bottom:10px;' },
    });
    toggleBar.createEl('span', { text: '후보:', attr: { style: 'color:var(--text-muted);font-size:0.82em;' } });
    for (const [label, value] of [
      [`고아 (${this.orphanImages.length}개)`, 'orphan'],
      [`전체 (${this.allImages.length}개)`, 'all'],
    ] as [string, CandidateMode][]) {
      const btn = toggleBar.createEl('button', { text: label });
      btn.style.cssText = `font-size:0.82em;padding:2px 10px;cursor:pointer;border-radius:4px;${
        this.mode === value ? 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;' : ''
      }`;
      btn.addEventListener('click', () => {
        this.mode = value;
        this.candPage = 0;
        this.render();
      });
    }

    // ── 후보 그리드 ───────────────────────────────────────────
    if (ranked.length === 0) {
      scrollArea.createEl('div', {
        text: '후보 이미지 없음',
        attr: { style: 'color:var(--text-muted);font-size:0.85em;text-align:center;padding:24px 0;' },
      });
    } else {
      const totalCandPages = Math.ceil(ranked.length / CAND_PAGE_SIZE);
      const pageCands = ranked.slice(this.candPage * CAND_PAGE_SIZE, (this.candPage + 1) * CAND_PAGE_SIZE);

      scrollArea.createEl('div', {
        text: `후보 이미지 (${ranked.length}개)`,
        attr: { style: 'font-size:0.82em;color:var(--text-muted);margin-bottom:6px;' },
      });

      const grid = scrollArea.createDiv({
        attr: { style: `display:grid;grid-template-columns:repeat(${COLS},1fr);gap:8px;margin-bottom:8px;` },
      });
      for (let i = 0; i < pageCands.length; i++) {
        const isTopRanked = this.candPage === 0 && i === 0;
        this.renderCandCard(grid, pageCands[i], selected, key, isTopRanked);
      }

      // 후보 페이지네이션
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
      this.loadAndRender(this.links[this.linkIdx].mdFile);
    });

    const skipBtn = nav.createEl('button', { text: '건너뜀' });
    skipBtn.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:0.85em;';
    skipBtn.addEventListener('click', () => {
      this.repairs.set(key, null);
      if (this.linkIdx < this.links.length - 1) {
        this.linkIdx++;
        this.candPage = 0;
        this.loadAndRender(this.links[this.linkIdx].mdFile);
      } else {
        this.render();
      }
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
    nextBtn.addEventListener('click', () => {
      this.linkIdx++;
      this.candPage = 0;
      this.loadAndRender(this.links[this.linkIdx].mdFile);
    });
  }

  private renderCandCard(container: HTMLElement, file: TFile, selected: TFile | null, key: string, isTopRanked = false): void {
    const isSelected = selected?.path === file.path;

    const card = container.createDiv();
    card.style.cssText = `
      position:relative;border-radius:8px;overflow:hidden;cursor:pointer;
      border:2px solid ${isSelected ? 'var(--color-accent)' : isTopRanked ? 'var(--color-accent)' : 'transparent'};
      ${!isSelected && isTopRanked ? 'border-style:dashed;' : ''}
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

    // 파일명 + 추천 뱃지
    const nameRow = card.createDiv({
      attr: { style: 'display:flex;align-items:center;gap:4px;padding:5px 7px;' },
    });
    nameRow.createDiv({
      text: file.name,
      attr: { style: 'font-size:0.78em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);flex:1;min-width:0;' },
    });
    if (isTopRanked && !isSelected) {
      nameRow.createEl('span', {
        text: '추천',
        attr: { style: 'flex-shrink:0;font-size:0.7em;padding:1px 5px;border-radius:3px;background:var(--color-accent);color:var(--text-on-accent);opacity:0.7;' },
      });
    }

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

    const generator = new AltTextGenerator(this.app, this.settings);

    const byNote = new Map<string, { link: BrokenLink; replacement: TFile; altText: string | null }[]>();
    for (const link of this.links) {
      const replacement = this.repairs.get(this.key(link));
      if (!replacement) { skipped++; continue; }
      // 교체 이미지의 기존 alt text 조회. 없으면 null (alt 없이 링크 생성)
      const altText = await generator.getExistingAltText(replacement);
      const arr = byNote.get(link.mdFile.path) ?? [];
      arr.push({ link, replacement, altText });
      byNote.set(link.mdFile.path, arr);
    }

    for (const [, items] of byNote) {
      const mdFile = items[0].link.mdFile;
      let content = await this.app.vault.read(mdFile);
      for (const { link, replacement, altText } of items) {
        const newLink = `![[${replacement.name}${altText ? `|${altText}` : ''}]]`;
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
