'use strict';
const { randomUUID } = require('node:crypto');
const { DomainError } = require('./service');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_BYTES = 1024 * 1024;

// Uploaded sources stay writable by their creator. Only server-owned immutable
// snapshots may be retained in public posts or profiles.
function createStorage({ cloud, uuid = randomUUID }) {
  async function cleanupFiles(fileIds) {
    if (!fileIds.length) return;
    const response = await cloud.deleteFile({ fileList: fileIds });
    if (!response || !Array.isArray(response.fileList) || response.fileList.some(item => item.status !== 0)) throw new Error('File cleanup failed');
  }
  async function discard(ids) {
    try { await cleanupFiles(ids); }
    catch (_) { console.error('FILE_CLEANUP_FAILED'); }
  }
  async function download(fileId, maxBytes) {
    const result = await cloud.downloadFile({ fileID: fileId });
    const buffer = result && result.fileContent;
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) throw new DomainError('INVALID_FILE', maxBytes === MAX_AVATAR_BYTES ? '头像须小于1MB，请重新选择' : '单张照片须小于10MB');
    return buffer;
  }
  function imageType(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', ext: 'png' };
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
    throw new DomainError('INVALID_FILE', '请选择 JPG、PNG 或 WebP 图片');
  }
  async function upload(buffer, cloudPath) {
    const result = await cloud.uploadFile({ cloudPath, fileContent: buffer });
    if (!result || typeof result.fileID !== 'string' || !result.fileID.startsWith('cloud://')) throw new Error('Server file upload failed');
    return result.fileID;
  }
  async function promoteImages(images, postId, stage) {
    if (!['submissions', 'published'].includes(stage) || !/^[a-zA-Z0-9_-]{1,100}$/.test(postId)) throw new Error('Invalid snapshot destination');
    const retained = [];
    try {
      // Sequential downloads keep peak buffer use bounded for a nine-photo post.
      for (const image of images) {
        const buffer = await download(image.fileId, MAX_IMAGE_BYTES);
        const type = imageType(buffer);
        const fileId = await upload(buffer, `${stage}/${postId}/${uuid()}.${type.ext}`);
        retained.push({ ...image, fileId });
      }
      return retained;
    } catch (error) {
      await discard(retained.map(image => image.fileId));
      throw error;
    }
  }
  async function promoteAvatar(fileId, openid) {
    const buffer = await download(fileId, MAX_AVATAR_BYTES);
    const type = imageType(buffer);
    try {
      // wx-server-sdk's media converter expects {contentType, value: Buffer}.
      // Check and publish the exact same buffer to avoid upload overwrite races.
      const response = await cloud.openapi.security.imgSecCheck({ media: { contentType: type.mime, value: buffer } });
      const code = response && (response.errCode !== undefined ? response.errCode : response.errcode);
      if (code !== 0 || (response.result && response.result.suggest !== 'pass')) throw new DomainError('CONTENT_REJECTED', '头像未通过内容检查，请重新选择');
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error.errCode === 87014 || error.errcode === 87014) throw new DomainError('CONTENT_REJECTED', '头像未通过内容检查，请重新选择');
      // Some accounts cannot call the legacy synchronous image check. Do not
      // silently publish avatars; users can still save a nickname without one.
      throw new DomainError('MODERATION_UNAVAILABLE', '头像检查暂时不可用，可先仅修改昵称');
    }
    return upload(buffer, `avatars/${openid}/${uuid()}.${type.ext}`);
  }
  return { promoteImages, promoteAvatar, cleanupFiles };
}
module.exports = { createStorage, MAX_IMAGE_BYTES, MAX_AVATAR_BYTES };
