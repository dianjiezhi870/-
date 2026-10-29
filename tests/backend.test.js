'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../cloudfunctions/api/service');
const { createStorage, MAX_AVATAR_BYTES } = require('../cloudfunctions/api/storage');

// This adapter models database transaction isolation and rollback. Production
// uses the CloudBase adapter; tests deliberately exercise service authorization.
class MemoryRepository {
  constructor() {
    this.collections = new Map();
    this.queue = Promise.resolve();
  }
  async get(collection, id) {
    return structuredClone(this.collections.get(collection)?.get(id) || null);
  }
  async set(collection, id, value) {
    if (!this.collections.has(collection)) this.collections.set(collection, new Map());
    this.collections.get(collection).set(id, structuredClone({ ...value, _id: id }));
  }
  async query(collection, filters = {}, options = {}) {
    const field = (value, key) => key.split('.').reduce((current, part) => current?.[part], value);
    let rows = [...(this.collections.get(collection)?.values() || [])].filter(row =>
      Object.entries(filters).every(([key, value]) => field(row, key) === value)
    );
    if (options.search) {
      const keyword = options.search.toLocaleLowerCase();
      rows = rows.filter(row => ['title', 'content', 'location'].some(key =>
        String(row[key] || '').toLocaleLowerCase().includes(keyword)
      ));
    }
    for (const { field: key, direction } of [...(options.sort || [])].reverse()) {
      rows.sort((a, b) => {
        const av = field(a, key), bv = field(b, key);
        return (av < bv ? -1 : av > bv ? 1 : 0) * (direction === 'desc' ? -1 : 1);
      });
    }
    const offset = options.offset || 0;
    return structuredClone(rows.slice(offset, offset + (options.limit ?? rows.length)));
  }
  async transaction(callback) {
    const result = this.queue.then(async () => {
      const before = structuredClone(this.collections);
      try { return await callback(this); }
      catch (error) { this.collections = before; throw error; }
    });
    this.queue = result.catch(() => {});
    return result;
  }
}

function fixture(overrides = {}) {
  let serial = 0;
  let clock = Date.UTC(2026, 9, 29);
  const repository = overrides.repository || new MemoryRepository();
  const service = createService({
    repository,
    adminOpenids: ['admin'],
    moderateText: async () => {},
    promoteImages: async (images, postId, stage) => images.map((entry, index) => ({
      ...entry, fileId: `cloud://test-env.bucket/${stage}/${postId}/immutable-${index}.jpg`
    })),
    promoteAvatar: async (fileId, openid) => `cloud://test-env.bucket/avatars/${openid}/immutable.jpg`,
    cleanupFiles: async () => {},
    now: () => ++clock,
    id: () => `generated-${++serial}`,
    ...overrides
  });
  const call = (action, data = {}, openid = 'alice') => service.handle(action, data, openid);
  return { repository, service, call };
}

const image = openid => ({
  fileId: `cloud://test-env.bucket/uploads/${openid}/landscape.jpg`,
  width: 1600,
  height: 1200
});
const payload = (openid = 'alice') => ({
  title: '黄水山野清晨',
  content: '记录晨雾中的山林。',
  images: [image(openid)],
  category: '山野',
  location: '黄水'
});

async function published(call, openid = 'alice') {
  const created = await call('post.create', payload(openid), openid);
  await call('post.review', { id: created.post.id, status: 'published' }, 'admin');
  return created.post.id;
}

test('session derives identity and administrator privileges from trusted caller only', async () => {
  const { call } = fixture();
  const normal = await call('session', { openid: 'admin', userId: 'admin', isAdmin: true });
  assert.equal(normal.user.id, 'alice');
  assert.equal(normal.user.isAdmin, false);
  const administrator = await call('session', {}, 'admin');
  assert.equal(administrator.user.isAdmin, true);
  await assert.rejects(() => call('session', {}, ''), /.+/);
});

test('every authenticated user can publish, but unreviewed work is private to author and admin', async () => {
  const { call } = fixture();
  const { post } = await call('post.create', { ...payload(), isAdmin: true, status: 'published' });
  assert.equal(post.status, 'pending');
  assert.equal(post.author.id, 'alice');
  assert.equal((await call('feed', {}, 'bob')).items.length, 0);
  assert.equal((await call('feed', { mine: true })).items[0].id, post.id);
  assert.equal((await call('detail', { id: post.id })).post.id, post.id);
  assert.equal((await call('detail', { id: post.id }, 'admin')).post.id, post.id);
  await assert.rejects(() => call('detail', { id: post.id }, 'bob'));
  await assert.rejects(() => call('post.like', { id: post.id }, 'bob'));
  await assert.rejects(() => call('comment.create', { postId: post.id, content: '很漂亮' }, 'bob'));
});

test('only an administrator can review and publish works', async () => {
  const { call } = fixture();
  const { post } = await call('post.create', payload());
  await assert.rejects(() => call('post.review', { id: post.id, status: 'published', isAdmin: true }));
  await assert.rejects(() => call('moderation.list'));
  assert.equal((await call('moderation.list', {}, 'admin')).items.length, 1);
  const reviewed = await call('post.review', { id: post.id, status: 'published' }, 'admin');
  assert.equal(reviewed.post.status, 'published');
  assert.equal((await call('feed', {}, 'bob')).items[0].id, post.id);
});

test('pending photos are server-owned snapshots and approval publishes a second immutable copy', async () => {
  const copies = [];
  const { call } = fixture({ promoteImages: async (images, postId, stage) => {
    copies.push({ images: structuredClone(images), postId, stage });
    return images.map((entry, index) => ({ ...entry, fileId: `cloud://test-env.bucket/${stage}/${postId}/copy-${index}.jpg` }));
  } });
  const { post } = await call('post.create', payload());
  assert.equal(copies.length, 1);
  assert.equal(copies[0].stage, 'submissions');
  assert.equal(copies[0].images[0].fileId, image('alice').fileId);
  assert.equal(post.images[0].fileId, `cloud://test-env.bucket/submissions/${post.id}/copy-0.jpg`);
  const approved = await call('post.review', { id: post.id, status: 'published' }, 'admin');
  assert.equal(copies.length, 2);
  assert.equal(copies[1].stage, 'published');
  assert.equal(copies[1].images[0].fileId, post.images[0].fileId);
  assert.equal(approved.post.images[0].fileId, `cloud://test-env.bucket/published/${post.id}/copy-0.jpg`);
  assert.equal((await call('detail', { id: post.id }, 'bob')).post.images[0].fileId, approved.post.images[0].fileId);
  const second = await call('post.create', payload());
  await call('post.review', { id: second.post.id, status: 'rejected' }, 'admin');
  assert.equal(copies.length, 3, 'rejecting a snapshot never creates a public copy');
});

test('image copy failure cannot persist a pending post or approve an existing one', async () => {
  let failingStage = 'submissions';
  const { call } = fixture({ promoteImages: async (images, postId, stage) => {
    if (stage === failingStage) throw new Error('云存储复制失败');
    return images.map((entry, index) => ({ ...entry, fileId: `cloud://test-env.bucket/${stage}/${postId}/copy-${index}.jpg` }));
  } });
  await assert.rejects(() => call('post.create', payload()));
  assert.equal((await call('feed', { mine: true })).items.length, 0);
  assert.equal((await call('my.stats')).posts, 0);
  failingStage = 'published';
  const { post } = await call('post.create', payload());
  await assert.rejects(() => call('post.review', { id: post.id, status: 'published' }, 'admin'));
  const stillPending = (await call('detail', { id: post.id })).post;
  assert.equal(stillPending.status, 'pending');
  assert.equal(stillPending.images[0].fileId, post.images[0].fileId);
  assert.equal((await call('feed', {}, 'bob')).items.length, 0);
});

test('failed approval transaction cleans copied files and preserves the original pending snapshot', async () => {
  const cleaned = [];
  const { call, repository } = fixture({ cleanupFiles: async ids => { cleaned.push(...ids); } });
  const { post } = await call('post.create', payload());
  const originalSet = repository.set.bind(repository);
  repository.set = async (collection, id, value) => {
    if (collection === 'hs_posts' && value.status === 'published') throw new Error('数据库写入失败');
    return originalSet(collection, id, value);
  };
  await assert.rejects(() => call('post.review', { id: post.id, status: 'published' }, 'admin'));
  assert.deepEqual(cleaned, [`cloud://test-env.bucket/published/${post.id}/immutable-0.jpg`]);
  const after = (await call('detail', { id: post.id })).post;
  assert.equal(after.status, 'pending');
  assert.deepEqual(after.images, post.images);
  assert.equal((await call('feed', {}, 'bob')).items.length, 0);
});

test('avatar moderation and snapshot failure preserve public profile; success stores a server-owned path', async () => {
  let rejectAvatar = true;
  const { call } = fixture({ promoteAvatar: async (fileId, openid) => {
    if (rejectAvatar) throw new Error('头像审核或复制失败');
    return `cloud://test-env.bucket/avatars/${openid}/immutable.jpg`;
  } });
  await call('profile.update', { nickname: '原来的昵称' });
  await assert.rejects(() => call('profile.update', { nickname: '新的昵称', avatarFileId: image('alice').fileId }));
  const preserved = (await call('session')).user;
  assert.equal(preserved.nickname, '原来的昵称');
  assert.equal(preserved.avatarUrl, '');
  rejectAvatar = false;
  const updated = await call('profile.update', { nickname: '新的昵称', avatarFileId: image('alice').fileId });
  assert.equal(updated.user.nickname, '新的昵称');
  assert.equal(updated.user.avatarUrl, 'cloud://test-env.bucket/avatars/alice/immutable.jpg');
});

test('likes toggle uniquely and concurrent users cannot lose counter updates', async () => {
  const { call } = fixture();
  const id = await published(call);
  const liked = await call('post.like', { id }, 'bob');
  assert.deepEqual({ liked: liked.liked, likeCount: liked.likeCount }, { liked: true, likeCount: 1 });
  const unliked = await call('post.like', { id }, 'bob');
  assert.deepEqual({ liked: unliked.liked, likeCount: unliked.likeCount }, { liked: false, likeCount: 0 });
  await Promise.all(Array.from({ length: 12 }, (_, i) => call('post.like', { id }, `viewer-${i}`)));
  let detail = await call('detail', { id });
  assert.equal(detail.post.likeCount, 12);
  assert.equal((await call('detail', { id }, 'viewer-0')).post.liked, true);
  await Promise.all(Array.from({ length: 6 }, () => call('post.like', { id }, 'same-viewer')));
  detail = await call('detail', { id });
  assert.equal(detail.post.likeCount, 12);
  assert.equal((await call('detail', { id }, 'same-viewer')).post.liked, false);
});

test('explicit desired like state is idempotent across concurrent retries', async () => {
  const { call } = fixture();
  const id = await published(call);
  const first = await call('post.like', { id, liked: true }, 'bob');
  assert.equal(first.likeCount, 1);
  const retryResults = await Promise.all(Array.from({ length: 10 }, () =>
    call('post.like', { id, liked: true }, 'bob')
  ));
  assert.ok(retryResults.every(result => result.liked && result.likeCount === 1));
  assert.equal((await call('my.stats')).likesReceived, 1);
  await Promise.all(Array.from({ length: 10 }, () =>
    call('post.like', { id, liked: false }, 'bob')
  ));
  assert.equal((await call('detail', { id })).post.likeCount, 0);
  assert.equal((await call('my.stats')).likesReceived, 0);
});

test('comments use server identity and update post counts atomically', async () => {
  const { call } = fixture();
  const id = await published(call);
  await Promise.all(Array.from({ length: 8 }, (_, i) => call('comment.create', {
    postId: id, content: `照片很有氛围 ${i}`, author: { id: 'admin' }
  }, 'bob')));
  const detail = await call('detail', { id });
  assert.equal(detail.post.commentCount, 8);
  assert.equal(detail.comments.length, 8);
  assert.ok(detail.comments.every(comment => comment.author.id === 'bob'));
  assert.equal((await call('my.stats')).commentsReceived, 8);
});

test('only administrator changes homepage music, client privilege flags cannot grant access', async () => {
  const { call } = fixture();
  const music = { enabled: true, title: '山间清晨', artist: '黄水摄影', fileId: 'cloud://test-env.bucket/uploads/admin/morning.mp3' };
  await assert.rejects(() => call('settings.update', { music, isAdmin: true, userId: 'admin' }));
  await call('settings.update', { music }, 'admin');
  assert.deepEqual((await call('settings.get', {}, 'bob')).music, music);
  await call('settings.update', { music: { ...music, enabled: false } }, 'admin');
  assert.equal((await call('session', {}, 'bob')).music.enabled, false);
});

test('another administrator can reuse existing trusted homepage music but cannot select arbitrary uploads', async () => {
  const { call } = fixture({ adminOpenids: ['admin', 'admin-b'] });
  const music = { enabled: true, title: '山间清晨', artist: '黄水摄影', fileId: 'cloud://test-env.bucket/uploads/admin/morning.mp3' };
  await call('settings.update', { music }, 'admin');
  const updatedMusic = { ...music, title: '黄水的早晨', enabled: false };
  await call('settings.update', { music: updatedMusic }, 'admin-b');
  assert.deepEqual((await call('settings.get', {}, 'bob')).music, updatedMusic);
  await assert.rejects(() => call('settings.update', {
    music: { ...music, fileId: 'cloud://test-env.bucket/uploads/admin/untrusted-other.mp3' }
  }, 'admin-b'));
});

test('authors may delete their own work; other users cannot delete or read removed work', async () => {
  const { call } = fixture();
  const id = await published(call);
  await assert.rejects(() => call('post.delete', { id, userId: 'alice', isAdmin: true }, 'bob'));
  assert.equal((await call('post.delete', { id })).deleted, true);
  assert.equal((await call('feed', {}, 'bob')).items.length, 0);
  await assert.rejects(() => call('detail', { id }));
  await assert.rejects(() => call('post.like', { id }, 'bob'));
});

test('invalid submissions and files owned by another account are rejected before publication', async () => {
  const { call } = fixture();
  for (const data of [
    { ...payload(), title: '' },
    { ...payload(), title: 'a'.repeat(61) },
    { ...payload(), images: [] },
    { ...payload(), images: Array.from({ length: 10 }, () => image('alice')) },
    { ...payload(), images: [image('bob')] },
    { ...payload(), images: [{ fileId: 'https://untrusted.invalid/photo.jpg', width: 100, height: 100 }] },
    { ...payload(), category: 'invalid' }
  ]) await assert.rejects(() => call('post.create', data));
  assert.equal((await call('feed', { mine: true })).items.length, 0);
});

test('profile, post and music text limits match the client contract at their boundaries', async () => {
  const { call } = fixture();
  const nickname = '摄'.repeat(24);
  assert.equal((await call('profile.update', { nickname })).user.nickname, nickname);
  await assert.rejects(() => call('profile.update', { nickname: '摄'.repeat(25) }));
  const allowedPost = { ...payload(), title: '光'.repeat(40), location: '山'.repeat(40) };
  assert.equal((await call('post.create', allowedPost)).post.title.length, 40);
  await assert.rejects(() => call('post.create', { ...payload(), title: '光'.repeat(41) }));
  await assert.rejects(() => call('post.create', { ...payload(), location: '山'.repeat(41) }));
  const music = { enabled: true, title: '曲'.repeat(80), artist: '人'.repeat(80), fileId: 'cloud://test-env.bucket/uploads/admin/morning.mp3' };
  assert.equal((await call('settings.update', { music }, 'admin')).music.title.length, 80);
  await assert.rejects(() => call('settings.update', { music: { ...music, title: '曲'.repeat(81) } }, 'admin'));
  await assert.rejects(() => call('settings.update', { music: { ...music, artist: '人'.repeat(81) } }, 'admin'));
});

test('moderation failures fail closed and never persist rejected posts or comments', async () => {
  let rejectContent = false;
  const { call } = fixture({ moderateText: async () => { if (rejectContent) throw new Error('安全审核不可用'); } });
  const id = await published(call);
  rejectContent = true;
  await assert.rejects(() => call('post.create', payload()));
  await assert.rejects(() => call('comment.create', { postId: id, content: '测试评论' }, 'bob'));
  assert.equal((await call('feed', { mine: true })).items.length, 1);
  assert.equal((await call('detail', { id })).post.commentCount, 0);
});

test('failed first submission may create a safe default profile but never a rejected post', async () => {
  const { call, repository } = fixture({ moderateText: async () => { throw new Error('审核服务不可用'); } });
  await assert.rejects(() => call('post.create', payload('new-user'), 'new-user'));
  const users = await repository.query('hs_users');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'new-user');
  assert.equal(users[0].nickname, '摄影爱好者');
  assert.equal((await repository.query('hs_posts')).length, 0);
});

test('filtering and pagination preserve visibility and exclude rejected work', async () => {
  const { call } = fixture();
  const first = await published(call);
  const pending = await call('post.create', { ...payload(), title: '街头光影', category: '街拍' });
  await call('post.review', { id: pending.post.id, status: 'rejected' }, 'admin');
  assert.equal((await call('feed', { category: '山野' }, 'bob')).items[0].id, first);
  assert.equal((await call('feed', { category: '街拍' }, 'bob')).items.length, 0);
  assert.equal((await call('feed', { keyword: '清晨' }, 'bob')).items.length, 1);
  assert.equal((await call('feed', { keyword: '不存在' }, 'bob')).items.length, 0);
  assert.equal((await call('feed', { mine: true })).items.length, 2);
  assert.equal((await call('feed', { mine: true }, 'bob')).items.length, 0);
});

test('feed and comments return complete nonoverlapping pages beyond the 20-item boundary', async () => {
  const { call } = fixture();
  const createdIds = [];
  for (let i = 0; i < 23; i++) createdIds.push(await published(call));
  const first = await call('feed', {}, 'bob');
  assert.equal(first.items.length, 20);
  assert.equal(first.nextCursor, 20);
  const second = await call('feed', { cursor: first.nextCursor }, 'bob');
  assert.equal(second.items.length, 3);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.items, ...second.items].map(post => post.id)), new Set(createdIds));
  const postId = createdIds[0];
  for (let i = 0; i < 23; i++) await call('comment.create', { postId, content: `评论 ${i}` }, 'bob');
  const detail = await call('detail', { id: postId });
  assert.equal(detail.comments.length, 20);
  assert.equal(detail.nextCursor, 20);
  const commentsSecond = await call('comments.list', { postId, cursor: detail.nextCursor });
  assert.equal(commentsSecond.items.length, 3);
  assert.equal(commentsSecond.nextCursor, null);
  assert.equal(new Set([...detail.comments, ...commentsSecond.items].map(comment => comment.id)).size, 23);
  assert.equal(detail.post.commentCount, 23);
});

test('reporting requires an accessible published post and records the real reporter', async () => {
  const { call } = fixture();
  const id = await published(call);
  assert.equal((await call('report.create', { postId: id, reason: '侵犯我的摄影作品版权' }, 'bob')).reported, true);
  await assert.rejects(() => call('report.create', { postId: 'missing', reason: '不存在' }, 'bob'));
});

const pngSignature = () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('storage promotes the downloaded photo bytes to server-owned stage paths', async () => {
  const buffer = pngSignature();
  const uploads = [];
  let sequence = 0;
  const cloud = {
    downloadFile: async () => ({ fileContent: buffer }),
    uploadFile: async request => {
      uploads.push(request);
      return { fileID: `cloud://test-env.bucket/${request.cloudPath}` };
    },
    deleteFile: async () => { throw new Error('No cleanup expected'); }
  };
  const storage = createStorage({ cloud, uuid: () => `snapshot-${++sequence}` });
  const pending = await storage.promoteImages([image('alice')], 'post-1', 'submissions');
  const publishedCopy = await storage.promoteImages(pending, 'post-1', 'published');
  assert.equal(uploads[0].cloudPath, 'submissions/post-1/snapshot-1.png');
  assert.equal(uploads[1].cloudPath, 'published/post-1/snapshot-2.png');
  assert.strictEqual(uploads[0].fileContent, buffer);
  assert.strictEqual(uploads[1].fileContent, buffer);
  assert.equal(pending[0].fileId, 'cloud://test-env.bucket/submissions/post-1/snapshot-1.png');
  assert.equal(publishedCopy[0].fileId, 'cloud://test-env.bucket/published/post-1/snapshot-2.png');
  assert.equal(publishedCopy[0].width, image('alice').width);
});

test('partial photo promotion cleans the first server-owned copy when the next download or upload fails', async () => {
  for (const failure of ['download', 'upload']) {
    const deletions = [];
    let downloads = 0, uploads = 0;
    const cloud = {
      downloadFile: async () => {
        if (++downloads === 2 && failure === 'download') throw new Error('Download unavailable');
        return { fileContent: pngSignature() };
      },
      uploadFile: async request => {
        if (++uploads === 2 && failure === 'upload') throw new Error('Upload unavailable');
        return { fileID: `cloud://test-env.bucket/${request.cloudPath}` };
      },
      deleteFile: async ({ fileList }) => {
        deletions.push(...fileList);
        return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) };
      }
    };
    let sequence = 0;
    const storage = createStorage({ cloud, uuid: () => `snapshot-${++sequence}` });
    await assert.rejects(() => storage.promoteImages([image('alice'), image('alice')], 'post-2', 'published'));
    assert.deepEqual(deletions, ['cloud://test-env.bucket/published/post-2/snapshot-1.png'], failure);
  }
});

test('avatar moderation checks and publishes the exact same downloaded buffer', async () => {
  const buffer = pngSignature();
  const checked = [], uploaded = [];
  const cloud = {
    downloadFile: async () => ({ fileContent: buffer }),
    openapi: { security: { imgSecCheck: async request => {
      checked.push(request);
      return { errCode: 0 };
    } } },
    uploadFile: async request => {
      uploaded.push(request);
      return { fileID: `cloud://test-env.bucket/${request.cloudPath}` };
    }
  };
  const storage = createStorage({ cloud, uuid: () => 'immutable-avatar' });
  const result = await storage.promoteAvatar(image('alice').fileId, 'alice');
  assert.equal(result, 'cloud://test-env.bucket/avatars/alice/immutable-avatar.png');
  assert.equal(checked.length, 1);
  assert.equal(checked[0].media.contentType, 'image/png');
  assert.strictEqual(checked[0].media.value, buffer);
  assert.strictEqual(uploaded[0].fileContent, checked[0].media.value);
});

test('avatar rejection, moderation outage, oversized, empty and invalid files all fail closed without uploading', async () => {
  const cases = [
    { name: 'rejected', buffer: pngSignature(), response: { errCode: 87014 }, code: 'CONTENT_REJECTED', checks: 1 },
    { name: 'review required', buffer: pngSignature(), response: { errCode: 0, result: { suggest: 'review' } }, code: 'CONTENT_REJECTED', checks: 1 },
    { name: 'outage', buffer: pngSignature(), throws: new Error('Moderation unavailable'), code: 'MODERATION_UNAVAILABLE', checks: 1 },
    { name: 'oversized', buffer: Buffer.alloc(MAX_AVATAR_BYTES + 1), code: 'INVALID_FILE', checks: 0 },
    { name: 'empty', buffer: Buffer.alloc(0), code: 'INVALID_FILE', checks: 0 },
    { name: 'invalid magic', buffer: Buffer.from('not an image'), code: 'INVALID_FILE', checks: 0 }
  ];
  for (const scenario of cases) {
    let uploads = 0, checks = 0;
    const cloud = {
      downloadFile: async () => ({ fileContent: scenario.buffer }),
      openapi: { security: { imgSecCheck: async () => {
        checks++;
        if (scenario.throws) throw scenario.throws;
        return scenario.response;
      } } },
      uploadFile: async () => { uploads++; throw new Error('Upload must not happen'); }
    };
    const storage = createStorage({ cloud, uuid: () => 'unused' });
    await assert.rejects(() => storage.promoteAvatar(image('alice').fileId, 'alice'), error => error.code === scenario.code, scenario.name);
    assert.equal(uploads, 0, scenario.name);
    assert.equal(checks, scenario.checks, scenario.name);
  }
});
