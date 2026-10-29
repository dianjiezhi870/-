const config = require('../config')
const demo = require('./demo')
let pendingSession = null

function isDemo() { return !config.cloudEnv }
function app() { return getApp() }
async function call(action, data = {}) {
  let result
  if (isDemo()) result = await demo.call(action, data)
  else {
    if (!app().globalData.cloudReady) throw new Error('云开发未初始化，请更新微信后重试')
    let response
    try {
      response = await wx.cloud.callFunction({ name: config.cloudFunction, data: { action, data } })
    } catch (_) {
      throw new Error('服务暂时不可用，请检查网络或云函数部署后重试')
    }
    const envelope = response.result
    if (!envelope || !envelope.ok) {
      const error = new Error(envelope && envelope.error ? envelope.error.message : '服务返回异常，请重试')
      error.code = envelope && envelope.error ? envelope.error.code : 'SERVICE_ERROR'
      throw error
    }
    result = envelope.data
  }
  // 在同一个入口解析云文件 URL，页面不必持有永久公开照片地址。
  result = await resolveResult(result)
  if (result && result.user && (action === 'session' || action === 'profile.update')) app().globalData.user = result.user
  return result
}
async function session() {
  if (!pendingSession) pendingSession = call('session').finally(() => { pendingSession = null })
  return pendingSession
}
async function resolveImages(items) { return resolveResult(items) }
async function resolveResult(value) {
  const ids = new Set()
  function collect(v) {
    if (!v || typeof v !== 'object') return
    if (typeof v.fileId === 'string' && v.fileId.startsWith('cloud://')) ids.add(v.fileId)
    if (typeof v.avatarUrl === 'string' && v.avatarUrl.startsWith('cloud://')) ids.add(v.avatarUrl)
    Object.keys(v).forEach(k => collect(v[k]))
  }
  collect(value)
  const urls = {}
  if (ids.size && !isDemo()) {
    const list = [...ids]
    for (let i = 0; i < list.length; i += 50) {
      const response = await wx.cloud.getTempFileURL({ fileList: list.slice(i, i + 50) })
      response.fileList.forEach(f => { if (!f.status && f.tempFileURL) urls[f.fileID] = f.tempFileURL })
    }
  }
  function resolve(v) {
    if (Array.isArray(v)) return v.map(resolve)
    if (!v || typeof v !== 'object') return v
    const result = {}
    Object.keys(v).forEach(k => { result[k] = resolve(v[k]) })
    if (v.fileId) result.url = urls[v.fileId] || (v.fileId.startsWith('cloud://') ? '' : v.fileId)
    if (v.avatarUrl) result.avatarUrl = urls[v.avatarUrl] || (v.avatarUrl.startsWith('cloud://') ? '/assets/avatar.png' : v.avatarUrl)
    return result
  }
  return resolve(value)
}
async function upload(filePath, kind, originalName) {
  if (!['photos', 'avatars', 'music'].includes(kind)) throw new Error('不支持的文件类型')
  if (isDemo()) {
    // 保存临时文件，重启开发工具仍可查看演示投稿。
    return new Promise((resolve, reject) => wx.saveFile({ tempFilePath: filePath, success: r => resolve(r.savedFilePath), fail: () => reject(new Error('保存本机演示文件失败，请检查存储空间')) }))
  }
  const { user } = await session()
  let ext = ((originalName || filePath).split('.').pop() || '').toLowerCase()
  if (kind !== 'music') {
    // 微信临时文件路径可能没有扩展名，以实际图片格式决定云端后缀。
    const image = await new Promise((resolve, reject) => wx.getImageInfo({ src: filePath, success: resolve, fail: () => reject(new Error('照片读取失败，请重新选择')) }))
    ext = String(image.type || '').toLowerCase()
  }
  const allowed = kind === 'music' ? ['mp3', 'm4a'] : ['jpg', 'jpeg', 'png', 'webp']
  if (!allowed.includes(ext)) throw new Error(kind === 'music' ? '请选择 MP3 或 M4A 文件' : '请选择 JPG、PNG 或 WebP 图片')
  const cloudPath = `uploads/${user.id}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}.${ext}`
  const response = await wx.cloud.uploadFile({ cloudPath, filePath })
  return response.fileID
}
async function removeUploads(fileIds) {
  const ids = fileIds.filter(Boolean)
  if (!ids.length) return
  if (isDemo()) {
    await Promise.all(ids.filter(x => !x.startsWith('/assets/')).map(filePath => new Promise(resolve => wx.removeSavedFile({ filePath, complete: resolve }))))
    return
  }
  await wx.cloud.deleteFile({ fileList: ids })
}
module.exports = { call, session, resolveImages, isDemo, upload, removeUploads }
