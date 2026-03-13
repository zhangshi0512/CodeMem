export type MemoryScope = 'session' | 'repo' | 'all';
export type RetrieveMethod = 'hybrid' | 'agentic' | 'keyword' | 'vector';

export interface SearchFilters {
  user_id?: string;
  group_ids?: string[];
}

export interface SearchMemoryRecord {
  id?: string;
  memory_type?: string;
  score?: number;
  summary?: string;
  atomic_fact?: string;
  foresight?: string;
  content?: string;
  timestamp?: string;
  original_data?: Array<{
    data?: Array<{
      extend?: {
        message_id?: string;
      };
    }>;
  }>;
}

export function normalizeScope(scope: string | undefined, defaultScope: string | undefined): MemoryScope {
  const raw = (scope || defaultScope || 'repo').toLowerCase();
  if (raw === 'session' || raw === 'repo' || raw === 'all') return raw;
  return 'repo';
}

export function buildSearchFilters(scope: MemoryScope, userId: string, groupId: string): SearchFilters {
  if (scope === 'all') {
    // "all" means all groups/projects for this user, not cross-user retrieval.
    return { user_id: userId };
  }
  return {
    user_id: userId,
    group_ids: [groupId],
  };
}

export function chooseRetrieveMethod(query: string, requested?: string): RetrieveMethod {
  if (requested === 'hybrid' || requested === 'agentic' || requested === 'keyword' || requested === 'vector') {
    return requested;
  }

  const q = query.trim().toLowerCase();
  const complexSignals = [' and ', 'compare', 'tradeoff', 'why', 'how', 'multi', 'across', 'conflict'];
  const isComplex = q.length > 120 || complexSignals.some((token) => q.includes(token));
  return isComplex ? 'agentic' : 'hybrid';
}

export function getSessionFromMessageId(messageId?: string): string | null {
  if (!messageId) return null;
  const match = messageId.match(/^[^_]+_([^_]+)_[^_]+_/);
  return match ? match[1] : null;
}

export function getPlatformFromMessageId(messageId?: string): string | null {
  if (!messageId) return null;
  const match = messageId.match(/^[^_]+_[^_]+_([^_]+)_/);
  return match ? match[1] : null;
}

export function getMessageIdFromMemory(mem: SearchMemoryRecord): string | null {
  const fromOriginal = mem.original_data?.[0]?.data?.[0]?.extend?.message_id;
  if (fromOriginal) return fromOriginal;

  if (mem.id && mem.id.includes('_')) return mem.id;
  return null;
}

export function getSessionFromMemory(mem: SearchMemoryRecord): string | null {
  const messageId = getMessageIdFromMemory(mem);
  return getSessionFromMessageId(messageId || undefined);
}

export function getPlatformFromMemory(mem: SearchMemoryRecord): string | null {
  const messageId = getMessageIdFromMemory(mem);
  return getPlatformFromMessageId(messageId || undefined);
}

export function estimateTokenCount(parts: Array<string | undefined>): number {
  const text = parts.filter(Boolean).join(' ');
  return Math.max(1, Math.ceil(text.length / 4));
}

export function isBulkDelete(memoryId?: string): boolean {
  return !memoryId || memoryId === '__all__';
}

/**
 * Extract file paths from the structured content prefix [files:a.ts,b.ts | ...]
 */
export function extractFilesFromContent(text: string): string[] {
  const match = text.match(/\[files:([^\]|]+)/);
  if (!match) return [];
  return match[1].split(',').map((f) => f.trim()).filter(Boolean);
}

/**
 * Check if a memory's text fields reference a given file path.
 * Uses substring matching on combined text + parsed file list prefix matching.
 */
export function matchesFileFilter(mem: SearchMemoryRecord, fileFilter: string): boolean {
  const searchText = [mem.summary, mem.atomic_fact, mem.content].filter(Boolean).join(' ');
  if (searchText.includes(fileFilter)) return true;
  const files = extractFilesFromContent(searchText);
  return files.some((f) => f.includes(fileFilter) || fileFilter.includes(f));
}

/**
 * Extract superseded memory IDs from [supersedes:id1,id2] tag in content.
 */
export function extractSupersededIds(text: string): string[] {
  const match = text.match(/\[supersedes:([^\]]+)\]/);
  if (!match) return [];
  return match[1].split(',').map((id) => id.trim()).filter(Boolean);
}

/**
 * Remove memories that are superseded by other memories in the same result set.
 * If memory Y contains [supersedes:X] and both X and Y are in the list, drop X.
 */
export function filterSuperseded(memories: SearchMemoryRecord[]): SearchMemoryRecord[] {
  const supersededIds = new Set<string>();
  for (const mem of memories) {
    const text = [mem.summary, mem.atomic_fact, mem.content].filter(Boolean).join(' ');
    for (const id of extractSupersededIds(text)) {
      supersededIds.add(id);
    }
  }
  if (supersededIds.size === 0) return memories;
  return memories.filter((mem) => !mem.id || !supersededIds.has(mem.id));
}
