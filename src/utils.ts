import { Notice } from 'obsidian';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatReduction(originalSize: number, newSize: number): string {
  const pct = Math.round((1 - newSize / originalSize) * 100);
  return `${formatBytes(originalSize)} → ${formatBytes(newSize)} (-${pct}%)`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 모든 작업에 일관된 진행 알림 제공.
 * 경과 시간을 실시간으로 표시하고, 완료 시 소요 시간을 함께 노출한다.
 */
export class ProgressNotice {
  private notice: Notice;
  private startTime: number;

  constructor(private label: string) {
    this.startTime = Date.now();
    this.notice = new Notice(`⏳ ${label}`, 0);
  }

  update(current: number, total: number): void {
    const elapsed = this.elapsedSec();
    this.notice.setMessage(`⏳ ${this.label}\n${current} / ${total} · ${elapsed}s 경과`);
  }

  finish(message: string): void {
    const elapsed = this.elapsedSec();
    this.notice.hide();
    new Notice(`${message}\n⏱ 소요 시간: ${elapsed}s`);
  }

  error(message: string): void {
    this.notice.hide();
    new Notice(`✗ ${message}`);
  }

  elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  private elapsedSec(): string {
    return (this.elapsedMs() / 1000).toFixed(1);
  }
}
