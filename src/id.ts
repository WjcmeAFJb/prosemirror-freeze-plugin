/**
 * Generate a unique string ID. Prefers `crypto.randomUUID` when available
 * (Node 19+, modern browsers), falls back to a Math.random-based id otherwise.
 *
 * Adjacent frozen nodes must carry distinct ids so that the editor model
 * keeps them as separate inline atoms rather than treating them as a single
 * collapsed range.
 */
export function defaultGenerateId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  // Fallback: timestamp + 4 random chunks. Not a real UUID but unique enough.
  const rand = (): string => Math.random().toString(36).slice(2, 10);
  return `frz-${Date.now().toString(36)}-${rand()}-${rand()}`;
}
