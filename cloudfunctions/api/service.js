'use strict';
const { randomUUID, createHash } = require('node:crypto');

class DomainError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
const fail = (code, message) => { throw new DomainError(code, message); };
const COLLECTIONS = Object.freeze({ users: 'hs_users', posts: 'hs_posts', likes: 'hs_likes', comments: 'hs_comments', settings: 'hs_settings', reports: 'hs_reports' });
const DEFAULT_MUSIC = Object.freeze({ enabled: false, title: '', artist: '', fileId: '' });
const CATEGORIES = ['山野', '人文', '街拍', '日常'];
const key = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex');
function text(value, name, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail('INVALID_INPUT', `${name}格式不正确`);
  const result = value.trim();
  if ((required && !result) || result.length > max) fail('INVALID_INPUT', `${name}${required ? '不能为空且' : ''}最多${max}字`);
  return result;
}
function file(value, openid, extensions) {
  if (typeof value !== 'string' || value.length > 600 || !value.startsWith('cloud://') || !value.includes(`/uploads/${openid}/`) || !extensions.test(value)) fail('INVALID_FILE', '请使用本人上传的云存储文件');
  const path = value.slice(value.indexOf('/uploads/'));
  if (path.includes('..') || /[?#\\]/.test(value)) fail('INVALID_FILE', '文件路径不正确');
  return value;
}
function offset(value) {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000) fail('INVALID_INPUT', '分页参数不正确');
  return value;
}
function createService({ repository, moderateText, promoteImages, promoteAvatar, cleanupFiles, adminOpenids = [], now = Date.now, id = randomUUID }) {
  if (!repository || [moderateText, promoteImages, promoteAvatar, cleanupFiles].some(fn => typeof fn !== 'function')) throw new Error('Repository, moderation, immutable file promotion, and cleanup are required');
  const adminSet = new Set(adminOpenids.filter(Boolean));
  const admin = (openid) => adminSet.has(openid);
  const requireAdmin = (openid) => { if (!admin(openid)) fail('FORBIDDEN', '仅管理员可以操作'); };
  const userKey = (openid) => key('user', openid);
  async function ensureUser(openid) {
    const uid = userKey(openid);
    return repository.transaction(async tx => {
      let user = await tx.get(COLLECTIONS.users, uid);
      if (!user) {
        user = { id: openid, nickname: '摄影爱好者', avatarUrl: '', stats: { posts: 0, likesReceived: 0, commentsReceived: 0 }, createdAt: now() };
        await tx.set(COLLECTIONS.users, uid, user);
      }
      return user;
    });
  }
  const publicUser = (user, withRole = false) => ({ id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl || '', ...(withRole ? { isAdmin: admin(user.id) } : {}) });
  async function author(openid) {
    const user = await repository.get(COLLECTIONS.users, userKey(openid));
    return user ? publicUser(user) : { id: openid, nickname: '摄影爱好者', avatarUrl: '' };
  }
  function readable(post, openid) {
    if (!post || post.deleted || (post.status !== 'published' && post.authorId !== openid && !admin(openid))) fail('NOT_FOUND', '作品不存在或暂未公开');
    return post;
  }
  async function loadPost(postId, openid) {
    return readable(await repository.get(COLLECTIONS.posts, text(postId, '作品编号', 100, true)), openid);
  }
  async function presentPost(post, openid) {
    const like = await repository.get(COLLECTIONS.likes, key('like', post.id, openid));
    return { id: post.id, title: post.title, content: post.content, images: post.images, category: post.category, location: post.location, author: await author(post.authorId), liked: !!(like && like.active), likeCount: post.likeCount, commentCount: post.commentCount, status: post.status, createdAt: post.createdAt };
  }
  async function presentComment(comment) {
    return { id: comment.id, postId: comment.postId, content: comment.content, author: await author(comment.authorId), createdAt: comment.createdAt };
  }
  async function commentList(postId, cursor, openid) {
    await loadPost(postId, openid);
    const start = offset(cursor);
    const rows = await repository.query(COLLECTIONS.comments, { postId }, { offset: start, limit: 21, sort: [{ field: 'createdAt', direction: 'asc' }, { field: 'id', direction: 'asc' }] });
    return { items: await Promise.all(rows.slice(0, 20).map(presentComment)), nextCursor: rows.length > 20 ? start + 20 : null };
  }
  async function music() {
    const settings = await repository.get(COLLECTIONS.settings, 'home');
    return settings && settings.music ? settings.music : { ...DEFAULT_MUSIC };
  }
  async function adjustStats(tx, openid, deltas) {
    const uid = userKey(openid);
    const user = await tx.get(COLLECTIONS.users, uid);
    if (!user) throw new Error('Author profile is missing');
    const stats = { posts: 0, likesReceived: 0, commentsReceived: 0, ...user.stats };
    for (const [name, delta] of Object.entries(deltas)) stats[name] = Math.max(0, stats[name] + delta);
    await tx.set(COLLECTIONS.users, uid, { ...user, stats });
  }
  async function discard(fileIds) {
    if (!fileIds.length) return;
    try { await cleanupFiles(fileIds); }
    catch (_) { console.error('FILE_CLEANUP_FAILED'); }
  }
  async function handle(action, data = {}, openid) {
    if (typeof openid !== 'string' || !openid || openid.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(openid)) fail('UNAUTHORIZED', '请在微信中登录后使用');
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('INVALID_INPUT', '请求格式不正确');
    if (typeof action !== 'string') fail('INVALID_ACTION', '接口不存在');
    await ensureUser(openid);
    switch (action) {
      case 'session': {
        const user = await repository.get(COLLECTIONS.users, userKey(openid));
        return { user: publicUser(user, true), music: await music() };
      }
      case 'profile.update': {
        const nickname = text(data.nickname, '昵称', 24, true);
        const avatarUrl = data.avatarFileId ? file(data.avatarFileId, openid, /\.(jpg|jpeg|png|webp)$/i) : undefined;
        await moderateText(nickname, openid);
        // Review and retain the same bytes; the client may overwrite its upload.
        const retainedAvatar = avatarUrl ? await promoteAvatar(avatarUrl, openid) : undefined;
        let user;
        try {
          user = await repository.transaction(async tx => {
            const current = await tx.get(COLLECTIONS.users, userKey(openid));
            const updated = { ...current, nickname, ...(retainedAvatar ? { avatarUrl: retainedAvatar } : {}) };
            await tx.set(COLLECTIONS.users, userKey(openid), updated);
            return updated;
          });
        } catch (error) {
          if (retainedAvatar) await discard([retainedAvatar]);
          throw error;
        }
        return { user: publicUser(user, true) };
      }
      case 'feed': {
        const filters = { deleted: false };
        if (data.mine === true) filters.authorId = openid; else filters.status = 'published';
        if (data.category && data.category !== '全部') {
          if (!CATEGORIES.includes(data.category)) fail('INVALID_INPUT', '分类不正确');
          filters.category = data.category;
        }
        const keyword = text(data.keyword, '搜索词', 40);
        const start = offset(data.cursor);
        const sorting = data.sort === 'popular' ? [{ field: 'likeCount', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'desc' }] : [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'desc' }];
        const rows = await repository.query(COLLECTIONS.posts, filters, { offset: start, limit: 21, sort: sorting, search: keyword });
        return { items: await Promise.all(rows.slice(0, 20).map(row => presentPost(row, openid))), nextCursor: rows.length > 20 ? start + 20 : null };
      }
      case 'detail': {
        const post = await loadPost(data.id, openid);
        const comments = await commentList(post.id, 0, openid);
        return { post: await presentPost(post, openid), comments: comments.items, nextCursor: comments.nextCursor };
      }
      case 'comments.list': return commentList(text(data.postId, '作品编号', 100, true), data.cursor, openid);
      case 'post.create': {
        const title = text(data.title, '标题', 40, true);
        const content = text(data.content, '描述', 2000);
        const location = text(data.location, '地点', 40);
        if (!CATEGORIES.includes(data.category)) fail('INVALID_INPUT', '请选择作品分类');
        if (!Array.isArray(data.images) || data.images.length < 1 || data.images.length > 9) fail('INVALID_INPUT', '请上传1至9张照片');
        const images = data.images.map(image => {
          if (!image || typeof image !== 'object') fail('INVALID_INPUT', '图片格式不正确');
          const width = Number(image.width), height = Number(image.height);
          if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 50000 || height > 50000) fail('INVALID_INPUT', '图片尺寸不正确');
          return { fileId: file(image.fileId, openid, /\.(jpg|jpeg|png|webp)$/i), width, height };
        });
        await moderateText([title, content, location].filter(Boolean).join('\n'), openid);
        const postId = id();
        // Freeze uploads before administrators inspect them. A snapshot created
        // by a cloud function cannot be overwritten by an ordinary storage user.
        const retainedImages = await promoteImages(images, postId, 'submissions');
        const post = { id: postId, authorId: openid, title, content, images: retainedImages, category: data.category, location, status: 'pending', deleted: false, likeCount: 0, commentCount: 0, createdAt: now() };
        try {
          await repository.transaction(async tx => {
            await tx.set(COLLECTIONS.posts, post.id, post);
            await adjustStats(tx, openid, { posts: 1 });
          });
        } catch (error) {
          await discard(retainedImages.map(image => image.fileId));
          throw error;
        }
        return { post: await presentPost(post, openid) };
      }
      case 'post.like': {
        const postId = text(data.id, '作品编号', 100, true);
        if (data.liked !== undefined && typeof data.liked !== 'boolean') fail('INVALID_INPUT', '点赞参数不正确');
        return repository.transaction(async tx => {
          const post = readable(await tx.get(COLLECTIONS.posts, postId), openid);
          if (post.status !== 'published') fail('NOT_PUBLISHED', '作品审核通过后可以点赞');
          const likeId = key('like', postId, openid);
          const previous = await tx.get(COLLECTIONS.likes, likeId);
          const wasLiked = !!(previous && previous.active);
          const liked = data.liked === undefined ? !wasLiked : data.liked;
          if (liked === wasLiked) return { liked, likeCount: post.likeCount };
          const delta = liked ? 1 : -1;
          const likeCount = Math.max(0, post.likeCount + delta);
          await tx.set(COLLECTIONS.likes, likeId, { id: likeId, postId, userId: openid, active: liked, updatedAt: now() });
          await tx.set(COLLECTIONS.posts, postId, { ...post, likeCount });
          await adjustStats(tx, post.authorId, { likesReceived: delta });
          return { liked, likeCount };
        });
      }
      case 'comment.create': {
        const postId = text(data.postId, '作品编号', 100, true);
        const content = text(data.content, '评论', 500, true);
        const existing = await loadPost(postId, openid);
        if (existing.status !== 'published') fail('NOT_PUBLISHED', '作品审核通过后可以评论');
        await moderateText(content, openid);
        const comment = { id: id(), postId, content, authorId: openid, createdAt: now() };
        const commentCount = await repository.transaction(async tx => {
          const post = readable(await tx.get(COLLECTIONS.posts, postId), openid);
          if (post.status !== 'published') fail('NOT_PUBLISHED', '作品审核通过后可以评论');
          await tx.set(COLLECTIONS.comments, comment.id, comment);
          await tx.set(COLLECTIONS.posts, postId, { ...post, commentCount: post.commentCount + 1 });
          await adjustStats(tx, post.authorId, { commentsReceived: 1 });
          return post.commentCount + 1;
        });
        return { comment: await presentComment(comment), commentCount };
      }
      case 'post.delete': {
        const postId = text(data.id, '作品编号', 100, true);
        return repository.transaction(async tx => {
          const post = await tx.get(COLLECTIONS.posts, postId);
          if (!post || post.deleted) fail('NOT_FOUND', '作品不存在');
          if (post.authorId !== openid && !admin(openid)) fail('FORBIDDEN', '仅作者或管理员可以删除');
          await tx.set(COLLECTIONS.posts, postId, { ...post, deleted: true, deletedAt: now(), deletedBy: openid });
          await adjustStats(tx, post.authorId, { posts: -1, likesReceived: -post.likeCount, commentsReceived: -post.commentCount });
          return { deleted: true };
        });
      }
      case 'my.stats': {
        const user = await repository.get(COLLECTIONS.users, userKey(openid));
        return { posts: 0, likesReceived: 0, commentsReceived: 0, ...user.stats };
      }
      case 'settings.get': return { music: await music() };
      case 'settings.update': {
        requireAdmin(openid);
        if (!data.music || typeof data.music.enabled !== 'boolean') fail('INVALID_INPUT', '歌曲设置不正确');
        const value = data.music;
        const title = text(value.title, '歌曲名', 80, value.enabled);
        const artist = text(value.artist, '歌手', 80);
        const existingMusic = await music();
        // A different administrator may disable/relabel the configured song.
        // Only a newly supplied file must belong to the current administrator.
        const fileId = value.fileId && value.fileId === existingMusic.fileId ? existingMusic.fileId : value.fileId ? file(value.fileId, openid, /\.(mp3|m4a|aac|wav)$/i) : '';
        if (value.enabled && !fileId) fail('INVALID_INPUT', '请上传歌曲');
        await moderateText([title, artist].filter(Boolean).join('\n'), openid);
        const result = { enabled: value.enabled, title, artist, fileId };
        await repository.set(COLLECTIONS.settings, 'home', { music: result, updatedBy: openid, updatedAt: now() });
        return { music: result };
      }
      case 'moderation.list': {
        requireAdmin(openid);
        const start = offset(data.cursor);
        const rows = await repository.query(COLLECTIONS.posts, { status: 'pending', deleted: false }, { offset: start, limit: 21, sort: [{ field: 'createdAt', direction: 'asc' }, { field: 'id', direction: 'asc' }] });
        return { items: await Promise.all(rows.slice(0, 20).map(row => presentPost(row, openid))), nextCursor: rows.length > 20 ? start + 20 : null };
      }
      case 'post.review': {
        requireAdmin(openid);
        const postId = text(data.id, '作品编号', 100, true);
        if (!['published', 'rejected'].includes(data.status)) fail('INVALID_INPUT', '审核结果不正确');
        const pending = await repository.get(COLLECTIONS.posts, postId);
        if (!pending || pending.deleted) fail('NOT_FOUND', '作品不存在');
        if (pending.status !== 'pending') fail('ALREADY_REVIEWED', '作品已审核，请刷新列表');
        // Network work must stay outside runTransaction: retries should only
        // repeat DB operations, never file copies or moderation side effects.
        const publishedImages = data.status === 'published' ? await promoteImages(pending.images, postId, 'published') : null;
        let post;
        try {
          post = await repository.transaction(async tx => {
            const current = await tx.get(COLLECTIONS.posts, postId);
            if (!current || current.deleted) fail('NOT_FOUND', '作品不存在');
            if (current.status !== 'pending') fail('ALREADY_REVIEWED', '作品已审核，请刷新列表');
            const updated = { ...current, ...(publishedImages ? { images: publishedImages } : {}), status: data.status, reviewedBy: openid, reviewedAt: now() };
            await tx.set(COLLECTIONS.posts, postId, updated);
            return updated;
          });
        } catch (error) {
          if (publishedImages) await discard(publishedImages.map(image => image.fileId));
          throw error;
        }
        if (publishedImages) await discard(pending.images.map(image => image.fileId));
        return { post: await presentPost(post, openid) };
      }
      case 'report.create': {
        const post = await loadPost(data.postId, openid);
        const reason = text(data.reason, '举报原因', 300, true);
        await moderateText(reason, openid);
        const reportId = key('report', post.id, openid);
        await repository.transaction(async tx => {
          const previous = await tx.get(COLLECTIONS.reports, reportId);
          if (!previous) await tx.set(COLLECTIONS.reports, reportId, { id: reportId, postId: post.id, userId: openid, reason, status: 'pending', createdAt: now() });
        });
        return { reported: true };
      }
      default: fail('INVALID_ACTION', '接口不存在');
    }
  }
  return { handle };
}
module.exports = { createService, DomainError, COLLECTIONS, DEFAULT_MUSIC };
