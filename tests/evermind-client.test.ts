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

test('EverMemClient sends group_id in both params and body for conversation-meta PATCH', async () => {
  const calls: any[] = [];
  const originalCreate = (axios as any).create;

  (axios as any).create = () => ({
    request: async (config: any) => {
      calls.push(config);
      return { data: { ok: true } };
    },
    post: async () => ({ data: { ok: true } }),
    patch: async () => ({ data: { ok: true } }),
  });

  try {
    const client = new EverMemClient('test-key');
    await client.updateConversationMeta({
      group_id: 'repo-1',
      tags: ['api', 'testing'],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, '/api/v0/memories/conversation-meta');
    assert.equal(calls[0].params.group_id, 'repo-1');
    assert.equal(calls[0].data.group_id, 'repo-1');
    assert.deepEqual(calls[0].data.tags, ['api', 'testing']);
  } finally {
    (axios as any).create = originalCreate;
  }
});

test('EverMemClient falls back to conversation-meta POST when PATCH target is missing', async () => {
  const calls: any[] = [];
  const originalCreate = (axios as any).create;

  (axios as any).create = () => ({
    request: async (config: any) => {
      calls.push(config);
      if (config.method === 'PATCH') {
        const error: any = new Error('missing');
        error.response = {
          status: 404,
          data: { message: 'Specified conversation metadata not found: repo-1' },
        };
        throw error;
      }
      return { data: { ok: true, created: true } };
    },
    post: async () => ({ data: { ok: true } }),
    patch: async () => ({ data: { ok: true } }),
  });

  try {
    const client = new EverMemClient('test-key');
    const result = await client.updateConversationMeta({
      group_id: 'repo-1',
      tags: ['api'],
      description: 'AI coding assistant session',
    });

    assert.equal(result.created, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].url, '/api/v0/memories/conversation-meta');
    assert.equal(calls[1].params.group_id, 'repo-1');
    assert.equal(calls[1].data.group_id, 'repo-1');
    assert.equal(calls[1].data.scene, 'assistant');
    assert.ok(calls[1].data.created_at);
    assert.deepEqual(calls[1].data.tags, ['api']);
  } finally {
    (axios as any).create = originalCreate;
  }
});
