const api = require('../../services/api')
const CATEGORIES = ['山野', '人文', '街拍', '日常']
const MAX_IMAGE_SIZE = 10 * 1024 * 1024

function invoke(name, options) {
  return new Promise((resolve, reject) => wx[name](Object.assign({}, options, { success: resolve, fail: reject })))
}

Page({
  data: {
    categories: CATEGORIES,
    category: '山野',
    title: '',
    content: '',
    location: '',
    images: [],
    submitting: false,
    choosing: false,
    progress: '',
    ready: false,
    error: '',
    demo: false
  },

  onLoad() {
    this._draftLoaded = false
  },

  async onShow() {
    if (this.data.submitting) return
    try {
      const result = await api.session()
      this._userId = result.user.id
      this.setData({ ready: true, error: '', demo: api.isDemo() })
      if (!this._draftLoaded) {
        this._draftLoaded = true
        const draft = wx.getStorageSync(this.draftKey())
        if (draft && typeof draft === 'object') {
          this.setData({
            title: typeof draft.title === 'string' ? draft.title.slice(0, 40) : '',
            content: typeof draft.content === 'string' ? draft.content.slice(0, 2000) : '',
            location: typeof draft.location === 'string' ? draft.location.slice(0, 40) : '',
            category: CATEGORIES.includes(draft.category) ? draft.category : '山野',
            images: Array.isArray(draft.images) ? draft.images.slice(0, 9) : []
          })
        }
      }
    } catch (error) {
      this.setData({ ready: false, error: error.message || '暂时无法连接，请重试' })
    }
  },

  draftKey() {
    return 'huangshui_publish_draft_' + (this._userId || 'local')
  },

  saveDraft() {
    try {
      const { title, content, category, location, images } = this.data
      wx.setStorageSync(this.draftKey(), { title, content, category, location, images })
    } catch (_) {
      // Storage can be full; the current in-memory form remains editable.
    }
  },

  inputField(event) {
    if (this.data.submitting) return
    const field = event.currentTarget.dataset.field
    if (!['title', 'content', 'location'].includes(field)) return
    this.setData({ [field]: event.detail.value })
    this.saveDraft()
  },

  selectCategory(event) {
    if (this.data.submitting) return
    const category = event.currentTarget.dataset.category
    if (CATEGORIES.includes(category)) {
      this.setData({ category })
      this.saveDraft()
    }
  },

  async chooseImages() {
    if (this.data.submitting || this.data.choosing || this.data.images.length >= 9) return
    this.setData({ choosing: true })
    try {
      const result = await invoke('chooseMedia', {
        count: 9 - this.data.images.length,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })
      const chosen = []
      for (const file of result.tempFiles || []) {
        if (file.size > MAX_IMAGE_SIZE) throw new Error('单张照片不能超过 10MB，请压缩后再试')
        const info = await invoke('getImageInfo', { src: file.tempFilePath })
        if (!['jpeg', 'jpg', 'png', 'webp'].includes(String(info.type).toLowerCase())) {
          throw new Error('请选择 JPG、PNG 或 WebP 格式的照片')
        }
        if (!info.width || !info.height) throw new Error('照片读取失败，请重新选择')
        chosen.push({ path: file.tempFilePath, width: info.width, height: info.height, size: file.size })
      }
      this.setData({ images: this.data.images.concat(chosen).slice(0, 9) })
      this.saveDraft()
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) wx.showToast({ title: error.message || '选择照片失败', icon: 'none' })
    } finally {
      this.setData({ choosing: false })
    }
  },

  removeImage(event) {
    if (this.data.submitting) return
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index)) return
    const images = this.data.images.filter((_, i) => i !== index)
    this.setData({ images })
    this.saveDraft()
  },

  previewImage(event) {
    wx.previewImage({ current: event.currentTarget.dataset.path, urls: this.data.images.map(image => image.path) })
  },

  async submit() {
    if (this.data.submitting || !this.data.ready || this.data.choosing) return
    const title = this.data.title.trim()
    const content = this.data.content.trim()
    const location = this.data.location.trim()
    if (!this.data.images.length) return wx.showToast({ title: '先添加一张摄影作品吧', icon: 'none' })
    if (!title) return wx.showToast({ title: '请为作品写一个标题', icon: 'none' })
    if (title.length > 40 || content.length > 2000 || location.length > 40) {
      return wx.showToast({ title: '文字超出长度限制', icon: 'none' })
    }
    this.setData({ submitting: true, progress: '正在准备照片…', error: '' })
    const uploaded = []
    let allUploaded = false
    try {
      const images = []
      for (let i = 0; i < this.data.images.length; i += 1) {
        const image = this.data.images[i]
        this.setData({ progress: '上传照片 ' + (i + 1) + ' / ' + this.data.images.length })
        const fileId = await api.upload(image.path, 'photos')
        uploaded.push(fileId)
        images.push({ fileId, width: image.width, height: image.height })
      }
      allUploaded = true
      this.setData({ progress: '正在提交作品…' })
      await api.call('post.create', { title, content, category: this.data.category, location, images })
      wx.removeStorageSync(this.draftKey())
      this.setData({ title: '', content: '', location: '', images: [], category: '山野' })
      await invoke('showModal', { title: '作品已提交', content: '审核通过后，大家就能看到你的摄影作品了。你可以在「我的」查看审核状态。', showCancel: false, confirmText: '查看我的' })
      wx.switchTab({ url: '/pages/profile/index' })
    } catch (error) {
      // A timed-out publish request may already have committed. Never delete files
      // after an ambiguous server result; only clean up an incomplete upload batch.
      if (!allUploaded && uploaded.length && api.removeUploads) {
        try { await api.removeUploads(uploaded) } catch (_) {}
      }
      this.setData({ error: error.message || '提交失败，草稿已保留，请稍后重试' })
    } finally {
      this.setData({ submitting: false, progress: '' })
    }
  }
})
