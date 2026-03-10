import { createHash } from 'crypto';

const DEFAULT_WINDOW_MS = 2 * 60 * 1000;

function normalizeForDedupe(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildFingerprint(toolName: string, content: string): string {
  const normalized = normalizeForDedupe(content);
  return createHash('sha256').update(`${toolName}:${normalized}`).digest('hex');
}

export class WriteDedupeRegistry {
  private seen = new Map<string, number>();

  constructor(private windowMs: number = DEFAULT_WINDOW_MS) {}

  isDuplicate(toolName: string, content: string, now: number = Date.now()): boolean {
    this.prune(now);
    const key = buildFingerprint(toolName, content);
    const last = this.seen.get(key);
    if (last !== undefined && now - last <= this.windowMs) {
      return true;
    }
    this.seen.set(key, now);
    return false;
  }

  private prune(now: number) {
    for (const [key, ts] of this.seen.entries()) {
      if (now - ts > this.windowMs) this.seen.delete(key);
    }
  }
}

export function createWriteDedupeRegistry(windowMs?: number): WriteDedupeRegistry {
  return new WriteDedupeRegistry(windowMs);
}
