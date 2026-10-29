const api = require('../../services/api')

function invoke(name, options) {
  return new Promise((resolve, reject) => wx[name](Object.assign({}, options, { success: resolve, fail: reject })))
}

Page({
  data: {
    loading: true,
    authorized: false,
    error: '',
    listError: '',
    saving: false,
    choosingMusic: false,
    reviewingId: '',
    demo: false,
    items: [],
    musicEnabled: false,
    musicTitle: '',
    musicArtist: '',
    musicFileId: '',
    selectedMusicName: '',
    selectedMusicPath: '',
    musicDirty: false
  },

  onLoad() {
    this.refresh()
  },

  onUnload() {
    this._generation = (this._generation || 0) + 1
  },

  async onPullDownRefresh() {
    try { await this.refresh() } finally { wx.stopPullDownRefresh() }
  },

  async refresh() {
    const generation = (this._generation || 0) + 1
    this._generation = generation
    this.setData({ loading: true, error: '', listError: '', demo: api.isDemo() })
    try {
      const session = await api.session()
      if (generation !== this._generation) return
      if (!session.user.isAdmin) {
        this.setData({ authorized: false, items: [], error: '只有管理员可以设置首页音乐和审核作品。' })
        return
      }
      this.setData({ authorized: true })
      if (!this.data.musicDirty) {
        const music = session.music || {}
        this.setData({ musicEnabled: !!music.enabled, musicTitle: music.title || '', musicArtist: music.artist || '', musicFileId: music.fileId || '' })
      }
      await this.loadQueue(generation)
    } catch (error) {
      if (generation === this._generation) this.setData({ error: error.message || '暂时无法加载管理空间' })
    } finally {
      if (generation === this._generation) this.setData({ loading: false })
    }
  },

  async loadQueue(generation) {
    const requestGeneration = generation === undefined ? this._generation : generation
    try {
      const result = await api.call('moderation.list', {})
      const items = await api.resolveImages(result.items || [])
      if (requestGeneration !== this._generation) return
      this.setData({ items: items.map(item => Object.assign({}, item, { dateText: this.formatDate(item.createdAt) })), listError: '' })
    } catch (error) {
      if (requestGeneration === this._generation) this.setData({ listError: error.message || '待审作品暂时加载失败' })
    }
  },

  formatDate(timestamp) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''
    return (date.getMonth() + 1) + '月' + date.getDate() + '日'
  },

  changeMusicEnabled(event) {
    if (!this.data.saving) this.setData({ musicEnabled: event.detail.value, musicDirty: true })
  },

  changeMusicField(event) {
    if (this.data.saving) return
    const field = event.currentTarget.dataset.field
    if (['musicTitle', 'musicArtist'].includes(field)) this.setData({ [field]: event.detail.value, musicDirty: true })
  },

  async chooseMusic() {
    if (!this.data.authorized || this.data.saving || this.data.choosingMusic) return
    this.setData({ choosingMusic: true })
    try {
      const result = await invoke('chooseMessageFile', { count: 1, type: 'file', extension: ['mp3', 'm4a'] })
      const file = result.tempFiles && result.tempFiles[0]
      if (!file) return
      if (!/\.(mp3|m4a)$/i.test(file.name || '')) throw new Error('请选择 MP3 或 M4A 音频')
      if (file.size > 20 * 1024 * 1024) throw new Error('音频不能超过 20MB')
      this.setData({ selectedMusicPath: file.path, selectedMusicName: file.name, musicDirty: true })
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) wx.showToast({ title: error.message || '选择音频失败', icon: 'none' })
    } finally {
      this.setData({ choosingMusic: false })
    }
  },

  async saveMusic() {
    if (!this.data.authorized || this.data.saving || this.data.choosingMusic) return
    const title = this.data.musicTitle.trim()
    const artist = this.data.musicArtist.trim()
    if (this.data.musicEnabled && !this.data.selectedMusicPath && !this.data.musicFileId) return wx.showToast({ title: '请先选择一首音乐', icon: 'none' })
    if (this.data.musicEnabled && !title) return wx.showToast({ title: '请填写音乐名称', icon: 'none' })
    if (title.length > 80 || artist.length > 80) return wx.showToast({ title: '音乐信息不能超过 80 个字', icon: 'none' })
    this.setData({ saving: true })
    try {
      let fileId = this.data.musicFileId
      if (this.data.selectedMusicPath) fileId = await api.upload(this.data.selectedMusicPath, 'music', this.data.selectedMusicName)
      const response = await api.call('settings.update', { music: { enabled: this.data.musicEnabled, title, artist, fileId } })
      const music = response.music
      this.setData({ musicFileId: music.fileId || '', musicEnabled: !!music.enabled, musicTitle: music.title || '', musicArtist: music.artist || '', selectedMusicName: '', selectedMusicPath: '', musicDirty: false })
      wx.showToast({ title: '首页音乐已更新', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  previewPhoto(event) {
    const post = this.data.items.find(item => item.id === event.currentTarget.dataset.id)
    if (post) wx.previewImage({ current: event.currentTarget.dataset.url, urls: post.images.map(image => image.url) })
  },

  async reviewPost(event) {
    if (!this.data.authorized || this.data.reviewingId) return
    const id = event.currentTarget.dataset.id
    const status = event.currentTarget.dataset.status
    if (!['published', 'rejected'].includes(status)) return
    this.setData({ reviewingId: id })
    try {
      const answer = await invoke('showModal', {
        title: status === 'published' ? '确认公开这组作品？' : '确认拒绝这组作品？',
        content: status === 'published' ? '请确认所有照片、标题及正文适合公开展示，且没有泄露他人隐私。通过后所有用户可见。' : '拒绝后作者可以在「我的」看到未通过状态。',
        confirmText: status === 'published' ? '审核通过' : '确认拒绝',
        confirmColor: status === 'published' ? '#237f7b' : '#aa7054'
      })
      if (!answer.confirm) return
      await api.call('post.review', { id, status })
      this.setData({ items: this.data.items.filter(item => item.id !== id) })
      wx.showToast({ title: status === 'published' ? '作品已公开' : '已拒绝作品', icon: 'success' })
      await this.loadQueue()
    } catch (error) {
      wx.showToast({ title: error.message || '审核失败，请重试', icon: 'none' })
    } finally {
      this.setData({ reviewingId: '' })
    }
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/index' })
  }
})
