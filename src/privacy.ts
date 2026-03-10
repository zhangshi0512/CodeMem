const MAX_TAG_COUNT = 100;

function countTags(content: string): number {
  const privateCount = (content.match(/<private>/g) || []).length;
  const contextCount = (content.match(/<codemem-context>/g) || []).length;
  return privateCount + contextCount;
}

export function stripMemoryTags(content: string): string {
  const tagCount = countTags(content);
  const raw = tagCount > MAX_TAG_COUNT ? content.slice(0, 100000) : content;
  return raw
    .replace(/<codemem-context>[\s\S]*?<\/codemem-context>/g, '')
    .replace(/<private>[\s\S]*?<\/private>/g, '')
    .trim();
}

export function sanitizeForMemoryWrite(content: string): string | null {
  const cleaned = stripMemoryTags(content);
  return cleaned.length > 0 ? cleaned : null;
}
