import { App, Modal } from 'obsidian';
import { formatBytes, formatReduction } from './utils';

export interface ConversionRecord {
  originalName: string;
  originalSize: number;
  newSize: number;
  skipped: boolean;
}

export class ReportModal extends Modal {
  constructor(
    app: App,
    private records: ConversionRecord[]
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '이미지 압축 리포트' });

    const converted = this.records.filter((r) => !r.skipped);
    const skipped = this.records.filter((r) => r.skipped);

    contentEl.createEl('p', {
      text: `변환: ${converted.length}개 / 건너뜀: ${skipped.length}개`,
      attr: { style: 'color: var(--text-muted); margin-bottom: 12px;' },
    });

    if (this.records.length === 0) {
      contentEl.createEl('p', { text: '변환된 이미지가 없습니다.' });
      return;
    }

    const tableWrapper = contentEl.createDiv();
    tableWrapper.style.overflowX = 'auto';

    const table = tableWrapper.createEl('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    // Header
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    for (const header of ['파일명', '원본 크기', '변환 후', '절감률']) {
      const th = headerRow.createEl('th', { text: header });
      th.style.textAlign = 'left';
      th.style.padding = '8px 12px';
      th.style.borderBottom = '2px solid var(--background-modifier-border)';
      th.style.whiteSpace = 'nowrap';
    }

    // Body
    const tbody = table.createEl('tbody');

    for (const record of this.records) {
      const row = tbody.createEl('tr');

      const nameCell = row.createEl('td', { text: record.originalName });
      nameCell.style.padding = '6px 12px';
      nameCell.style.borderBottom = '1px solid var(--background-modifier-border-hover)';

      if (record.skipped) {
        const skipCell = row.createEl('td', { text: '–' });
        skipCell.colSpan = 3;
        skipCell.style.padding = '6px 12px';
        skipCell.style.color = 'var(--text-muted)';
        skipCell.style.borderBottom = '1px solid var(--background-modifier-border-hover)';
      } else {
        const pct = Math.round((1 - record.newSize / record.originalSize) * 100);

        for (const [text, color] of [
          [formatBytes(record.originalSize), ''],
          [formatBytes(record.newSize), ''],
          [`-${pct}%`, pct > 0 ? 'var(--color-green)' : 'var(--text-muted)'],
        ] as [string, string][]) {
          const td = row.createEl('td', { text });
          td.style.padding = '6px 12px';
          td.style.borderBottom = '1px solid var(--background-modifier-border-hover)';
          td.style.whiteSpace = 'nowrap';
          if (color) td.style.color = color;
        }
      }
    }

    // Footer (합계)
    if (converted.length > 0) {
      const totalOriginal = converted.reduce((s, r) => s + r.originalSize, 0);
      const totalNew = converted.reduce((s, r) => s + r.newSize, 0);

      const tfoot = table.createEl('tfoot');
      const footRow = tfoot.createEl('tr');
      footRow.style.fontWeight = 'bold';

      const labelCell = footRow.createEl('td', { text: `합계 (${converted.length}개)` });
      labelCell.style.padding = '8px 12px';
      labelCell.style.borderTop = '2px solid var(--background-modifier-border)';

      for (const text of [
        formatBytes(totalOriginal),
        formatBytes(totalNew),
        `-${Math.round((1 - totalNew / totalOriginal) * 100)}%`,
      ]) {
        const td = footRow.createEl('td', { text });
        td.style.padding = '8px 12px';
        td.style.borderTop = '2px solid var(--background-modifier-border)';
        td.style.whiteSpace = 'nowrap';
      }

      contentEl.createEl('p', {
        text: `총 절감: ${formatReduction(totalOriginal, totalNew)}`,
        attr: { style: 'margin-top: 12px; font-weight: 500;' },
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
