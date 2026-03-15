import { App, Modal, Notice, TFile } from 'obsidian';
import { BrokenLink, BrokenLinkFinder } from './BrokenLinkFinder';
import { ALL_IMAGE_EXTENSIONS } from './types';

type CandidateMode = 'orphan' | 'all';

export class BrokenLinkRepairModal extends Modal {
  private mode: CandidateMode = 'orphan';
  private repairs = new Map<string, TFile | null>(); // key: `mdPath::ref` → 선택된 파일
  private links: BrokenLink[] = [];
  private allImages: TFile[] = [];
  private orphanImages: TFile[] = [];

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

    // 기본 자동 매칭
    for (const link of links) {
      const key = this.key(link);
      const candidates = BrokenLinkFinder.rankCandidates(link.ref, orphanImages);
      this.repairs.set(key, candidates[0] ?? null);
    }
  }

  private key(link: BrokenLink): string {
    return `${link.mdFile.path}::${link.ref}`;
  }

  private get candidates(): TFile[] {
    return this.mode === 'orphan' ? this.orphanImages : this.allImages;
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.style.width = '780px';
    this.modalEl.style.maxWidth = '92vw';

    // ── 헤더 ──────────────────────────────────────────────────────
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

    // ── 후보 토글 ────────────────────────────────────────────────
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
        // 자동 매칭 재계산
        for (const link of this.links) {
          const ranked = BrokenLinkFinder.rankCandidates(link.ref, this.candidates);
          if (ranked.length > 0) this.repairs.set(this.key(link), ranked[0]);
        }
        this.render();
      });
    }

    // ── 링크 목록 ────────────────────────────────────────────────
    const list = contentEl.createDiv();
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow-y:auto;padding-right:4px;margin-bottom:12px;';

    for (const link of this.links) {
      this.renderLinkRow(list, link);
    }

    // ── 하단 바 ──────────────────────────────────────────────────
    const footer = contentEl.createDiv({
      attr: { style: 'display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid var(--background-modifier-border);' },
    });
    const assignedCount = [...this.repairs.values()].filter(Boolean).length;
    const applyBtn = footer.createEl('button', { text: `${assignedCount}개 링크 복구 적용` });
    applyBtn.disabled = assignedCount === 0;
    applyBtn.style.cssText = `padding:5px 16px;cursor:pointer;font-size:0.9em;${
      assignedCount > 0 ? 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;' : ''
    }`;
    applyBtn.addEventListener('click', () => this.applyAll());
  }

  private renderLinkRow(container: HTMLElement, link: BrokenLink): void {
    const key = this.key(link);
    const selected = this.repairs.get(key) ?? null;
    const ranked = BrokenLinkFinder.rankCandidates(link.ref, this.candidates);

    const card = container.createDiv();
    card.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;padding:10px 12px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:6px;';

    // 왼쪽: 깨진 링크 정보
    const left = card.createDiv();
    left.createEl('div', {
      text: link.mdFile.basename,
      attr: { style: 'font-size:0.8em;color:var(--text-muted);margin-bottom:2px;' },
    });
    left.createEl('div', {
      text: `🔴 ${link.ref}`,
      attr: { style: 'font-size:0.85em;font-weight:500;word-break:break-all;color:var(--color-red);' },
    });
    if (link.alt) {
      left.createEl('div', {
        text: `alt: ${link.alt}`,
        attr: { style: 'font-size:0.78em;color:var(--text-faint);' },
      });
    }

    // 화살표
    card.createEl('div', { text: '→', attr: { style: 'font-size:1.2em;color:var(--text-muted);text-align:center;' } });

    // 오른쪽: 후보 선택
    const right = card.createDiv({ attr: { style: 'min-width:0;' } });

    if (ranked.length === 0) {
      right.createEl('div', {
        text: '후보 없음',
        attr: { style: 'color:var(--text-muted);font-size:0.85em;' },
      });
      return;
    }

    // 선택된 파일 썸네일 + 이름
    const preview = right.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px;' } });

    const thumb = preview.createDiv();
    thumb.style.cssText = 'flex-shrink:0;width:48px;height:48px;border-radius:4px;overflow:hidden;background:var(--background-modifier-border);display:flex;align-items:center;justify-content:center;';
    this.renderThumb(thumb, selected);

    const nameEl = preview.createEl('div', {
      text: selected ? selected.name : '—',
      attr: { style: 'font-size:0.85em;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
    });

    // 후보 드롭다운
    const select = right.createEl('select');
    select.style.cssText = 'width:100%;font-size:0.82em;padding:2px 4px;';

    const noneOpt = select.createEl('option', { text: '— 건너뜀 —', value: '' });
    noneOpt.selected = !selected;

    for (const candidate of ranked) {
      const opt = select.createEl('option', { text: candidate.name, value: candidate.path });
      opt.selected = selected?.path === candidate.path;
    }

    select.addEventListener('change', () => {
      const chosen = this.app.vault.getAbstractFileByPath(select.value);
      this.repairs.set(key, chosen instanceof TFile ? chosen : null);
      // 썸네일 + 이름 갱신
      thumb.empty();
      this.renderThumb(thumb, chosen instanceof TFile ? chosen : null);
      nameEl.textContent = chosen instanceof TFile ? chosen.name : '—';
    });
  }

  private renderThumb(container: HTMLElement, file: TFile | null): void {
    if (!file) {
      container.createEl('span', { text: '?', attr: { style: 'font-size:1.2em;color:var(--text-muted);' } });
      return;
    }
    const img = container.createEl('img');
    img.src = this.app.vault.getResourcePath(file);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    img.onerror = () => { container.empty(); container.createEl('span', { text: '🖼', attr: { style: 'font-size:1.2em;' } }); };
  }

  private async applyAll(): Promise<void> {
    let fixed = 0;
    let skipped = 0;

    // mdFile별로 묶어서 한 번에 처리
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
  }
}
