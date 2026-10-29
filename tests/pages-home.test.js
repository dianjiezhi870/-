'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function photo(overrides = {}) {
  return Object.assign({
    id: 'photo-1', title: '山间来信', content: '记录一束光。',
    images: [{ fileId: '/assets/sample-1.jpg', url: '/assets/sample-1.jpg', width: 500, height: 800 }],
    author: { id: 'me', nickname: '小摄', avatarUrl: '' },
    likeCount: 1, commentCount: 0, liked: false, category: '山野',
    status: 'published', createdAt: Date.UTC(2026, 9, 29)
  }, overrides);
}

function makePage(name, overrides = {}) {
  const observations = { calls: [], toasts: [], navigation: [], modals: [], sheets: [], previews: [], stops: 0, unsubscribed: 0 };
  const api = Object.assign({
    isDemo: () => true,
    session: async () => ({ user: { id: 'me', nickname: '小摄', isAdmin: false }, music: { enabled: false, fileId: '' } }),
    resolveImages: async items => items,
    call: async (action, data) => {
      observations.calls.push({ action, data });
      if (action === 'feed') return { items: [photo()], nextCursor: null };
      if (action === 'detail') return { post: photo(), comments: [], nextCursor: null };
      if (action === 'post.like') return { liked: true, likeCount: 2 };
      if (action === 'comment.create') return { comment: { id: 'comment-1', content: data.content, author: { id: 'me', nickname: '小摄' }, createdAt: Date.now() }, commentCount: 1 };
      if (action === 'post.delete') return { deleted: true };
      if (action === 'report.create') return { reported: true };
      throw new Error('Unexpected action: ' + action);
    }
  }, overrides);
  const wx = {
    stopPullDownRefresh() {}, hideKeyboard() {},
    showToast(options) { observations.toasts.push(options); },
    navigateTo(options) { observations.navigation.push(options); },
    switchTab(options) { observations.navigation.push(options); },
    showModal(options) { observations.modals.push(options); },
    showActionSheet(options) { observations.sheets.push(options); },
    previewImage(options) { observations.previews.push(options); }
  };
  const music = {
    subscribe(callback) { callback({ playing: false, error: '' }); return () => { observations.unsubscribed += 1; }; },
    stop() { observations.stops += 1; },
    toggle: async () => {}
  };
  let definition;
  const filename = path.join(__dirname, '../miniprogram/pages', name, 'index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: module => module.endsWith('/music') ? music : api,
    Page: value => { definition = value; }, wx, Set, Date, Number, Object, String, Promise, encodeURIComponent
  }, { filename });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    _requestId: 0, _commentsRequestId: 0,
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const pieces = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        for (let i = 0; i < pieces.length - 1; i += 1) target = target[pieces[i]];
        target[pieces[pieces.length - 1]] = value;
      }
    }
  });
  if (name === 'index') page.onLoad();
  else page.setData({ id: 'photo-1' });
  return { page, api, wx, observations };
}

test('home loads decorated masonry cards and stops at the final feed page', async () => {
  const { page, observations } = makePage('index');
  await page.loadFeed(true);
  assert.equal(page.data.posts.length, 1);
  assert.equal(page.data.posts[0].coverHeight, 490);
  assert.equal(page.data.posts[0].authorName, '小摄');
  assert.equal(page.data.columns[0].items[0].id, 'photo-1');
  assert.equal(page.data.hasMore, false);
  await page.loadFeed(false);
  assert.equal(observations.calls.filter(call => call.action === 'feed').length, 1);
});

test('a stale feed request cannot overwrite newer search results', async () => {
  const earlier = deferred();
  const later = deferred();
  let count = 0;
  const { page } = makePage('index', { call: () => ++count === 1 ? earlier.promise : later.promise });
  const first = page.loadFeed(true);
  page.setData({ keyword: '新的关键词' });
  const second = page.loadFeed(true);
  later.resolve({ items: [photo({ id: 'newer-photo' })], nextCursor: null });
  await second;
  earlier.resolve({ items: [photo()], nextCursor: null });
  await first;
  assert.equal(page.data.posts[0].id, 'newer-photo');
  assert.equal(page.data.loading, false);
});

test('home deduplicates a retried page and uses current filter parameters', async () => {
  const queries = [];
  const { page } = makePage('index', { call: async (action, data) => {
    queries.push(data);
    return data.cursor === 0 ? { items: [photo()], nextCursor: 1 } : { items: [photo(), photo({ id: 'photo-2' })], nextCursor: null };
  } });
  page.setData({ keyword: ' 水 ', category: '山野', sort: 'popular' });
  await page.loadFeed(true);
  await page.loadFeed(false);
  assert.equal(page.data.posts.length, 2);
  assert.equal(queries[0].keyword, '水');
  assert.equal(queries[0].sort, 'popular');
  assert.equal(queries[1].cursor, 1);
});

test('home protects a like mutation against repeated taps', async () => {
  const pending = deferred();
  const { page, api } = makePage('index');
  await page.loadFeed(true);
  let mutations = 0;
  api.call = () => { mutations += 1; return pending.promise; };
  const event = { currentTarget: { dataset: { id: 'photo-1' } } };
  const first = page.onLike(event);
  const second = page.onLike(event);
  pending.resolve({ liked: true, likeCount: 2 });
  await Promise.all([first, second]);
  assert.equal(mutations, 1);
  assert.equal(page.data.posts[0].liked, true);
  assert.equal(page.data.posts[0].likeCount, 2);
});

test('feed failures clear the loading state and expose a useful retry error', async () => {
  const { page } = makePage('index', { call: async () => { throw new Error('网络连接失败'); } });
  await page.loadFeed(true);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '网络连接失败');
});

test('leaving the home page stops its foreground music and unload unsubscribes', () => {
  const { page, observations } = makePage('index');
  page.onHide();
  page.onUnload();
  assert.equal(observations.stops, 1);
  assert.equal(observations.unsubscribed, 1);
});

test('detail loads ownership controls and publishes a trimmed comment', async () => {
  const { page, observations } = makePage('detail');
  await page.loadDetail();
  assert.equal(page.data.canDelete, true);
  assert.equal(page.data.loading, false);
  await page.onSendComment();
  assert.equal(observations.calls.filter(call => call.action === 'comment.create').length, 0);
  page.setData({ commentText: '  这束光很美。  ' });
  await page.onSendComment();
  assert.equal(page.data.comments[0].content, '这束光很美。');
  assert.equal(page.data.post.commentCount, 1);
  assert.equal(page.data.commentText, '');
  assert.equal(page.data.commentBusy, false);
});

test('another author has no delete control, while an administrator does', async () => {
  const { page, api } = makePage('detail', { session: async () => ({ user: { id: 'someone-else', isAdmin: false } }) });
  await page.loadDetail();
  assert.equal(page.data.canDelete, false);
  api.session = async () => ({ user: { id: 'admin', isAdmin: true } });
  await page.loadDetail();
  assert.equal(page.data.canDelete, true);
});

test('detail comment pagination deduplicates an overlapping boundary', async () => {
  const { page, api } = makePage('detail');
  await page.loadDetail();
  page.setData({ nextCursor: 1, comments: [{ id: 'comment-1', content: '已有评论' }] });
  api.call = async () => ({ items: [{ id: 'comment-1' }, { id: 'comment-2', content: '第二条', author: { nickname: '摄友' } }], nextCursor: null });
  await page.loadMoreComments();
  assert.equal(page.data.comments.length, 2);
  assert.equal(page.data.comments[1].authorName, '摄友');
  assert.equal(page.data.nextCursor, null);
  assert.equal(page.data.commentsLoading, false);
});

test('detail previews all photos and applies the confirmed report reason', async () => {
  const { page, observations } = makePage('detail');
  await page.loadDetail();
  page.onPreview({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(observations.previews[0].current, '/assets/sample-1.jpg');
  page.onReport();
  await observations.sheets[0].success({ tapIndex: 0 });
  const report = observations.calls.find(call => call.action === 'report.create');
  assert.equal(report.data.postId, 'photo-1');
  assert.equal(report.data.reason, '侵犯版权');
});

test('deletion requires confirmation and returns to the feed after success', async () => {
  const { page, observations } = makePage('detail');
  await page.loadDetail();
  page.onDelete();
  await observations.modals[0].success({ confirm: false });
  assert.equal(observations.calls.some(call => call.action === 'post.delete'), false);
  page.onDelete();
  await observations.modals[1].success({ confirm: true });
  assert.equal(observations.calls.filter(call => call.action === 'post.delete').length, 1);
  assert.equal(observations.navigation[0].url, '/pages/index/index');
});

test('an unloaded detail page ignores an in-flight fetch result', async () => {
  const pending = deferred();
  const { page } = makePage('detail', { call: () => pending.promise });
  const request = page.loadDetail();
  page.onUnload();
  pending.resolve({ post: photo(), comments: [], nextCursor: null });
  await request;
  assert.equal(page.data.post, null);
});
