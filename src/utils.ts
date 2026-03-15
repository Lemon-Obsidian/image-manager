export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatReduction(originalSize: number, newSize: number): string {
  const pct = Math.round((1 - newSize / originalSize) * 100);
  return `${formatBytes(originalSize)} → ${formatBytes(newSize)} (-${pct}%)`;
}
