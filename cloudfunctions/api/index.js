'use strict';
const cloud = require('wx-server-sdk');
const { createService, DomainError } = require('./service');
const { createRepository } = require('./repository');
const { createStorage } = require('./storage');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const service = createService({
  repository: createRepository(db),
  ...createStorage({ cloud }),
  adminOpenids: (process.env.ADMIN_OPENIDS || '').split(',').map(value => value.trim()).filter(Boolean),
  async moderateText(content, openid) {
    if (!content) return;
    try {
      const response = await cloud.openapi.security.msgSecCheck({ openid, scene: 2, version: 2, content });
      if (!response || !response.result || response.result.suggest !== 'pass') {
        throw new DomainError('CONTENT_REJECTED', '文字未通过内容检查，请修改后重试');
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error.errCode === 87014 || error.errcode === 87014) throw new DomainError('CONTENT_REJECTED', '文字未通过内容检查，请修改后重试');
      // Never bypass moderation on a timeout, missing permission, or upstream failure.
      throw new DomainError('MODERATION_UNAVAILABLE', '内容检查暂时不可用，请稍后重试');
    }
  }
});
exports.main = async event => {
  const { OPENID, APPID } = cloud.getWXContext();
  if (APPID && APPID !== 'wx6436c6c484376d9b') return { ok: false, error: { code: 'UNAUTHORIZED', message: '小程序身份不匹配' } };
  try {
    const input = event && typeof event === 'object' ? event : {};
    const data = await service.handle(input.action, input.data, OPENID);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: { code: error.code, message: error.message } };
    // Log only non-sensitive diagnosis metadata; do not log event payloads or IDs.
    console.error('API_FAILURE', error && error.name, error && error.errCode);
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } };
  }
};
