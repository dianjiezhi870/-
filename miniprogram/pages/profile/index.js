const api = require('../../services/api')
const STATUS_LABELS = { pending: '审核中', published: '已公开', rejected: '未通过' }

function decorate(items) {
  return items.map(item => Object.assign({}, item, {
    statusText: STATUS_LABELS[item.status] || '审核中',
    cover: item.images && item.images[0] ? item.images[0].url : ''
  }))
}

Page({
  data: {
    user: null,
    stats: { posts: 0, likesReceived: 0, commentsReceived: 0 },
    items: [],
    cursor: 0,
    hasMore: true,
    loading: false,
    loadingMore: false,
    saving: false,
    editing: false,
    nickname: '',
    avatarPath: '',
    error: '',
    statsError: '',
    demo: false
  },

  onShow() {
    this.refresh()
  },

  onUnload() {
    this._generation = (this._generation || 0) + 1
  },

  async onPullDownRefresh() {
    try { await this.refresh() } finally { wx.stopPullDownRefresh() }
  },

  onReachBottom() {
    this.loadMore()
  },

  async refresh() {
    const generation = (this._generation || 0) + 1
    this._generation = generation
    this.setData({ loading: true, loadingMore: false, error: '', statsError: '', demo: api.isDemo() })
    try {
      const session = await api.session()
      if (generation !== this._generation) return
      this.setData({ user: session.user })
      const results = await Promise.allSettled([
        api.call('my.stats', {}),
        api.call('feed', { mine: true, category: '全部', sort: 'latest', cursor: 0 })
      ])
      if (generation !== this._generation) return
      if (results[0].status === 'fulfilled') {
        this.setData({ stats: results[0].value })
      } else {
        this.setData({ statsError: '统计暂时不可用' })
      }
      if (results[1].status === 'rejected') throw results[1].reason
      const response = results[1].value
      const items = decorate(await api.resolveImages(response.items || []))
      if (generation !== this._generation) return
      this.setData({ items, cursor: response.nextCursor, hasMore: response.nextCursor !== null })
    } catch (error) {
      if (generation === this._generation) this.setData({ error: error.message || '作品暂时加载失败，请重试' })
    } finally {
      if (generation === this._generation) this.setData({ loading: false })
    }
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore || this.data.error) return
    const generation = this._generation
    this.setData({ loadingMore: true })
    try {
      const response = await api.call('feed', { mine: true, category: '全部', sort: 'latest', cursor: this.data.cursor })
      const items = decorate(await api.resolveImages(response.items || []))
      if (generation !== this._generation) return
      const known = new Set(this.data.items.map(item => item.id))
      this.setData({ items: this.data.items.concat(items.filter(item => !known.has(item.id))), cursor: response.nextCursor, hasMore: response.nextCursor !== null })
    } catch (error) {
      if (generation === this._generation) wx.showToast({ title: error.message || '加载失败，请稍后重试', icon: 'none' })
    } finally {
      if (generation === this._generation) this.setData({ loadingMore: false })
    }
  },

  openEditor() {
    if (!this.data.user || this.data.saving) return
    this.setData({ editing: true, nickname: this.data.user.nickname, avatarPath: '', error: '' })
  },

  closeEditor() {
    if (this.data.saving) return
    this.setData({ editing: false, avatarPath: '' })
  },

  chooseAvatar(event) {
    if (!this.data.saving) this.setData({ avatarPath: event.detail.avatarUrl })
  },

  changeNickname(event) {
    if (!this.data.saving) this.setData({ nickname: event.detail.value })
  },

  async saveProfile() {
    if (this.data.saving) return
    const nickname = this.data.nickname.trim()
    if (!nickname || nickname.length > 24) return wx.showToast({ title: '昵称需为 1 至 24 个字', icon: 'none' })
    this.setData({ saving: true })
    let uploaded = ''
    try {
      const payload = { nickname }
      if (this.data.avatarPath) {
        uploaded = await api.upload(this.data.avatarPath, 'avatars')
        payload.avatarFileId = uploaded
      }
      const result = await api.call('profile.update', payload)
      this.setData({ user: result.user, editing: false, avatarPath: '' })
      wx.showToast({ title: '资料已保存', icon: 'success' })
      this.refresh()
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  copyUserId() {
    if (this.data.user) wx.setClipboardData({ data: this.data.user.id })
  },

  goAdmin() {
    if (this.data.user && this.data.user.isAdmin) wx.navigateTo({ url: '/pages/admin/index' })
  },

  openPost(event) {
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) })
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/index' })
  }
})
