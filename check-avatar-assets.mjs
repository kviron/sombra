import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarCache } from './src/shared/api/avatars.ts';

const HASH = 'VghQszs0tIAIbNdcPqykA3P_L6hdzIo-uAb47pbN1bE';
const OTHER = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function state(overrides = {}) {
  return {
    me: { id: 'u1', name: 'Me', avatar: '', avatarHash: HASH },
    users: [{ id: 'u1', name: 'Me', avatar: '', avatarHash: HASH }, { id: 'u2', name: 'Peer', avatar: '' }],
    groups: [{ id: 'g1', name: 'Group', avatar: '', avatarHash: OTHER }],
    messages: [],
    ...overrides,
  };
}

test('inline avatars are left alone and never fetched', async () => {
  let calls = 0;
  const cache = createAvatarCache(async () => {
    calls += 1;
    return undefined;
  });
  const plain = { me: { id: 'u1', avatar: PNG }, users: [{ id: 'u1', avatar: PNG }], groups: [] };
  assert.equal(await cache.hydrate(plain), plain);
  assert.equal(calls, 0);
});

test('missing pictures are fetched once per version and patched into the snapshot', async () => {
  const asked = [];
  const cache = createAvatarCache(async ref => {
    asked.push(`${ref.kind}:${ref.id}:${ref.sha}`);
    return { kind: ref.kind, id: ref.id, sha: ref.sha, data: PNG };
  });
  const first = await cache.hydrate(state());
  assert.equal(first.me.avatar, PNG);
  assert.equal(first.users[0].avatar, PNG);
  assert.equal(first.groups[0].avatar, PNG);
  assert.equal(first.users[1].avatar, '');
  assert.deepEqual(asked.sort(), [`group:g1:${OTHER}`, `user:u1:${HASH}`]);
  // The next poll sends the same hashes: no request, same picture.
  asked.length = 0;
  const second = await cache.hydrate(state());
  assert.equal(second.me.avatar, PNG);
  assert.equal(asked.length, 0);
});

test('a failed fetch is not retried on every poll', async () => {
  let calls = 0;
  const cache = createAvatarCache(async () => {
    calls += 1;
    throw new Error('offline');
  });
  const first = await cache.hydrate(state());
  assert.equal(first.me.avatar, '');
  const afterFirst = calls; // one request per distinct picture, both failed
  assert.equal(afterFirst, 2);
  await cache.hydrate(state());
  assert.equal(calls, afterFirst);
  cache.clear();
  await cache.hydrate(state());
  assert.equal(calls, afterFirst * 2);
});

test('a stale or malformed answer is rejected instead of shown', async () => {
  const stale = createAvatarCache(async ref => ({ kind: ref.kind, id: ref.id, sha: 'nope', data: PNG }));
  assert.equal((await stale.hydrate(state())).me.avatar, '');
  const junk = createAvatarCache(async ref => ({ kind: ref.kind, id: ref.id, sha: ref.sha, data: 'javascript:alert(1)' }));
  assert.equal((await junk.hydrate(state())).me.avatar, '');
  const wrongKind = createAvatarCache(async ref => ({ kind: 'group', id: ref.id, sha: ref.sha, data: PNG }));
  assert.equal((await wrongKind.hydrate(state())).me.avatar, '');
});

test('concurrent polls share one request per picture', async () => {
  let calls = 0;
  const cache = createAvatarCache(async ref => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { kind: ref.kind, id: ref.id, sha: ref.sha, data: PNG };
  });
  const [a, b] = await Promise.all([cache.hydrate(state()), cache.hydrate(state())]);
  assert.equal(a.me.avatar, PNG);
  assert.equal(b.me.avatar, PNG);
  assert.equal(calls, 2); // one user + one group, not four
});
