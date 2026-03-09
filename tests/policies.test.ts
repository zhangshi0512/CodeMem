import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSearchFilters,
  chooseRetrieveMethod,
  getPlatformFromMessageId,
  getSessionFromMessageId,
  isBulkDelete,
  normalizeScope,
} from '../src/policies.js';

test('normalizeScope respects provided scope and defaults', () => {
  assert.equal(normalizeScope('session', 'repo'), 'session');
  assert.equal(normalizeScope(undefined, 'all'), 'all');
  assert.equal(normalizeScope('invalid', 'repo'), 'repo');
});

test('buildSearchFilters enforces scoped filters', () => {
  assert.deepEqual(buildSearchFilters('session', 'u1', 'g1'), { user_id: 'u1', group_ids: ['g1'] });
  assert.deepEqual(buildSearchFilters('repo', 'u1', 'g1'), { user_id: 'u1', group_ids: ['g1'] });
  assert.deepEqual(buildSearchFilters('all', 'u1', 'g1'), { user_id: 'u1' });
});

test('chooseRetrieveMethod applies orchestration heuristics', () => {
  assert.equal(chooseRetrieveMethod('find auth config', undefined), 'hybrid');
  assert.equal(chooseRetrieveMethod('compare auth and billing decisions across sessions and explain tradeoff', undefined), 'agentic');
  assert.equal(chooseRetrieveMethod('any', 'keyword'), 'keyword');
});

test('session/platform extraction from message ids works', () => {
  const messageId = 'decisionepi_20260309-143022-abc123_cursor_1234567890_abc123';
  assert.equal(getSessionFromMessageId(messageId), '20260309-143022-abc123');
  assert.equal(getPlatformFromMessageId(messageId), 'cursor');
});

test('bulk delete detection is safe-by-default', () => {
  assert.equal(isBulkDelete(undefined), true);
  assert.equal(isBulkDelete('__all__'), true);
  assert.equal(isBulkDelete('507f1f77bcf86cd799439011'), false);
});
