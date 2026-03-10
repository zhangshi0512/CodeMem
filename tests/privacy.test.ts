import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeForMemoryWrite, stripMemoryTags } from '../src/privacy.js';

test('stripMemoryTags removes private and context blocks', () => {
  const input = 'Keep this <private>hide this</private> and <codemem-context>hide</codemem-context> keep';
  const cleaned = stripMemoryTags(input);
  assert.equal(cleaned, 'Keep this  and  keep');
});

test('sanitizeForMemoryWrite returns null when content is fully private', () => {
  const input = '<private>secret</private>';
  assert.equal(sanitizeForMemoryWrite(input), null);
});

test('sanitizeForMemoryWrite returns cleaned content when public text exists', () => {
  const input = 'Public note <private>secret</private>';
  assert.equal(sanitizeForMemoryWrite(input), 'Public note');
});
