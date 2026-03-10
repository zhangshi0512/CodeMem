import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { EverMemClient } from '../src/evermind-client.js';

test('EverMemClient sends query payload via params for GET endpoints', async () => {
  const calls: any[] = [];
  const originalCreate = (axios as any).create;

  (axios as any).create = () => ({
    request: async (config: any) => {
      calls.push(config);
      return { data: { ok: true, result: { memories: [] } } };
    },
    post: async (url: string, body: any) => ({ data: { url, body } }),
    patch: async (url: string, body: any) => ({ data: { url, body } }),
  });

  try {
    const client = new EverMemClient('test-key');
    await client.searchMemories({ query: 'auth bug', top_k: 5 });
    await client.getMemories({ page: 2, page_size: 7 });
    await client.getConversationMeta({ group_id: 'g1' });

    assert.equal(calls.length, 3);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, '/api/v0/memories/search');
    assert.equal(calls[0].params.query, 'auth bug');
    assert.equal(calls[0].data, undefined);

    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].url, '/api/v0/memories');
    assert.equal(calls[1].params.page, 2);
    assert.equal(calls[1].params.page_size, 7);
    assert.equal(calls[1].data, undefined);

    assert.equal(calls[2].method, 'GET');
    assert.equal(calls[2].url, '/api/v0/memories/conversation-meta');
    assert.equal(calls[2].params.group_id, 'g1');
    assert.equal(calls[2].data, undefined);
  } finally {
    (axios as any).create = originalCreate;
  }
});
