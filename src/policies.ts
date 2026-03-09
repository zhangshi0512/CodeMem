export type MemoryScope = 'session' | 'repo' | 'all';
export type RetrieveMethod = 'hybrid' | 'agentic' | 'keyword' | 'vector';

export interface SearchFilters {
  user_id?: string;
  group_ids?: string[];
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

export function isBulkDelete(memoryId?: string): boolean {
  return !memoryId || memoryId === '__all__';
}

