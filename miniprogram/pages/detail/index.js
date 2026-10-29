const api = require('../../services/api');

function dateText(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return date.getFullYear() + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + String(date.getDate()).padStart(2, '0');
}
function decorateComment(comment) {
  return Object.assign({}, comment, {
    authorName: comment.author && comment.author.nickname || '摄影爱好者',
    authorAvatar: comment.author && comment.author.avatarUrl || '',
    dateText: dateText(comment.createdAt)
  });
}

Page({
  data: {
    id: '', post: null, comments: [], nextCursor: null,
    loading: true, error: '', demo: false, user: null,
    currentImage: 0, swiperHeight: 720, createdText: '',
    commentText: '', commentFocus: false, commentBusy: false,
    likeBusy: false, deleteBusy: false, commentsLoading: false,
    commentsError: '', canDelete: false
  },
  onLoad(options) {
    this._destroyed = false;
    this._requestId = 0;
    this._commentsRequestId = 0;
    this.setData({ id: options.id || '', demo: api.isDemo() });
    if (!this.data.id) { this.setData({ loading: false, error: '作品链接无效' }); return; }
    this.loadDetail();
  },
  onUnload() { this._destroyed = true; this._requestId += 1; this._commentsRequestId += 1; },
  async loadDetail() {
    const requestId = ++this._requestId;
    this._commentsRequestId += 1;
    this.setData({ loading: true, error: '', commentsError: '' });
    try {
      const results = await Promise.all([api.call('detail', { id: this.data.id }), api.session()]);
      const resolved = await api.resolveImages([results[0].post]);
      if (requestId !== this._requestId) return;
      const post = resolved[0];
      const cover = (post.images || [])[0] || {};
      const user = results[1].user;
      this.setData({
        post, user, comments: (results[0].comments || []).map(decorateComment),
        nextCursor: results[0].nextCursor, createdText: dateText(post.createdAt),
        currentImage: 0,
        swiperHeight: cover.width && cover.height ? Math.round(Math.max(480, Math.min(920, 750 * cover.height / cover.width))) : 720,
        canDelete: Boolean(user && (user.isAdmin || post.author && post.author.id === user.id))
      });
    } catch (error) {
      if (requestId === this._requestId) this.setData({ error: error.message || '作品加载失败，请重试' });
    } finally {
      if (requestId === this._requestId) this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },
  onPullDownRefresh() { this.loadDetail(); },
  onRetry() { this.loadDetail(); },
  onSwiperChange(event) { this.setData({ currentImage: event.detail.current }); },
  onPreview(event) {
    const images = this.data.post && this.data.post.images || [];
    const urls = images.map(image => image.url || image.fileId).filter(Boolean);
    if (!urls.length) return;
    wx.previewImage({ current: urls[Number(event.currentTarget.dataset.index)] || urls[0], urls });
  },
  onImageError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.post || !this.data.post.images[index]) return;
    const path = 'post.images[' + index + '].url';
    this.setData({ [path]: '/assets/sample-1.jpg' });
  },
  async onLike() {
    if (this.data.likeBusy || !this.data.post) return;
    this.setData({ likeBusy: true });
    try {
      const result = await api.call('post.like', { id: this.data.id, liked: !this.data.post.liked });
      if (this._destroyed) return;
      this.setData({ 'post.liked': result.liked, 'post.likeCount': result.likeCount });
    } catch (error) { if (!this._destroyed) wx.showToast({ title: error.message || '点赞失败，请重试', icon: 'none' }); }
    finally { if (!this._destroyed) this.setData({ likeBusy: false }); }
  },
  onCommentInput(event) { this.setData({ commentText: event.detail.value }); },
  onFocusComment() { this.setData({ commentFocus: true }); },
  onCommentBlur() { this.setData({ commentFocus: false }); },
  async onSendComment() {
    if (this.data.commentBusy) return;
    const content = this.data.commentText.trim();
    if (!content) { wx.showToast({ title: '先写下你的感受吧', icon: 'none' }); return; }
    this.setData({ commentBusy: true });
    try {
      const result = await api.call('comment.create', { postId: this.data.id, content });
      if (this._destroyed) return;
      const comment = decorateComment(result.comment);
      const comments = [comment].concat(this.data.comments.filter(item => item.id !== comment.id));
      this.setData({ comments, commentText: '', commentFocus: false, 'post.commentCount': result.commentCount });
      wx.hideKeyboard();
      wx.showToast({ title: '评论已发布', icon: 'success' });
    } catch (error) { if (!this._destroyed) wx.showToast({ title: error.message || '评论发布失败', icon: 'none' }); }
    finally { if (!this._destroyed) this.setData({ commentBusy: false }); }
  },
  async loadMoreComments() {
    if (this.data.commentsLoading || this.data.nextCursor === null || this.data.nextCursor === undefined || !this.data.post) return;
    const requestId = ++this._commentsRequestId;
    this.setData({ commentsLoading: true, commentsError: '' });
    try {
      const result = await api.call('comments.list', { postId: this.data.id, cursor: this.data.nextCursor });
      if (requestId !== this._commentsRequestId) return;
      const ids = new Set(this.data.comments.map(comment => comment.id));
      this.setData({
        comments: this.data.comments.concat((result.items || []).filter(comment => !ids.has(comment.id)).map(decorateComment)),
        nextCursor: result.nextCursor
      });
    } catch (error) {
      if (requestId === this._commentsRequestId) this.setData({ commentsError: error.message || '评论加载失败' });
    } finally {
      if (requestId === this._commentsRequestId) this.setData({ commentsLoading: false });
    }
  },
  onReachBottom() { this.loadMoreComments(); },
  onReport() {
    if (this._reportBusy) return;
    const reasons = ['侵犯版权', '不当内容', '广告或垃圾信息', '其他'];
    wx.showActionSheet({
      itemList: reasons,
      success: async result => {
        this._reportBusy = true;
        try {
          await api.call('report.create', { postId: this.data.id, reason: reasons[result.tapIndex] });
          wx.showToast({ title: '已提交，感谢你的反馈', icon: 'none' });
        } catch (error) { wx.showToast({ title: error.message || '提交失败，请重试', icon: 'none' }); }
        finally { this._reportBusy = false; }
      }
    });
  },
  onDelete() {
    if (!this.data.canDelete || this.data.deleteBusy) return;
    wx.showModal({
      title: '删除这组作品？', content: '作品及其评论将被删除，操作无法撤销。', confirmText: '删除作品', confirmColor: '#a6564c',
      success: async result => {
        if (!result.confirm || this.data.deleteBusy) return;
        this.setData({ deleteBusy: true });
        try {
          await api.call('post.delete', { id: this.data.id });
          wx.showToast({ title: '作品已删除', icon: 'success' });
          wx.switchTab({ url: '/pages/index/index' });
        } catch (error) { wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' }); }
        finally { this.setData({ deleteBusy: false }); }
      }
    });
  },
  onShareAppMessage() {
    const post = this.data.post;
    const image = post && post.images && post.images[0];
    return { title: post ? post.title + ' · 黄水摄影' : '黄水摄影', path: '/pages/detail/index?id=' + encodeURIComponent(this.data.id), imageUrl: image && (image.url || image.fileId) || '' };
  },
  onShareTimeline() { return { title: this.data.post ? this.data.post.title : '黄水摄影', query: 'id=' + encodeURIComponent(this.data.id) }; }
});
