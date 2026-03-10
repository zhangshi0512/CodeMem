import assert from 'node:assert/strict';
import test from 'node:test';
import { WriteDedupeRegistry } from '../src/dedupe.js';

test('dedupe marks repeated content within window as duplicate', () => {
  const registry = new WriteDedupeRegistry(1000);
  const t0 = 10000;

  assert.equal(registry.isDuplicate('add_foresight_todo', 'Fix auth timeout', t0), false);
  assert.equal(registry.isDuplicate('add_foresight_todo', 'Fix auth timeout', t0 + 100), true);
});

test('dedupe normalizes content casing and spacing', () => {
  const registry = new WriteDedupeRegistry(1000);
  const t0 = 20000;

  assert.equal(registry.isDuplicate('add_developer_preference', 'Use  2 spaces', t0), false);
  assert.equal(registry.isDuplicate('add_developer_preference', '  use 2   spaces  ', t0 + 200), true);
});

test('dedupe is tool-specific and expires after window', () => {
  const registry = new WriteDedupeRegistry(1000);
  const t0 = 30000;

  assert.equal(registry.isDuplicate('save_project_decision', 'Use redis cache', t0), false);
  assert.equal(registry.isDuplicate('add_foresight_todo', 'Use redis cache', t0 + 200), false);
  assert.equal(registry.isDuplicate('save_project_decision', 'Use redis cache', t0 + 1200), false);
});
