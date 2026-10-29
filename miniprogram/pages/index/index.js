const api = require('../../services/api');
const music = require('../../services/music');

function decorate(post) {
  const cover = (post.images || [])[0] || {};
  const ratio = cover.width && cover.height ? cover.height / cover.width : 1.28;
  return Object.assign({}, post, {
    coverUrl: cover.url || cover.fileId || '/assets/sample-1.jpg',
    coverHeight: Math.round(Math.max(250, Math.min(490, 333 * ratio))),
    authorName: post.author && post.author.nickname || '摄影爱好者',
    authorAvatar: post.author && post.author.avatarUrl || '',
    likeText: post.likeCount > 999 ? (post.likeCount / 1000).toFixed(1) + 'k' : String(post.likeCount || 0)
  });
}

function columnsFor(posts) {
  const columns = [[], []];
  const heights = [0, 0];
  posts.forEach(post => {
    const target = heights[0] <= heights[1] ? 0 : 1;
    columns[target].push(post);
    heights[target] += post.coverHeight + 154;
  });
  return columns.map((items, index) => ({ id: 'column-' + index, items }));
}

Page({
  data: {
    categories: ['全部', '山野', '人文', '街拍', '日常'],
    category: '全部', keyword: '', sort: 'latest',
    columns: [{ id: 'column-0', items: [] }, { id: 'column-1', items: [] }], posts: [], loading: false, refreshing: false,
    error: '', nextCursor: 0, hasMore: true, demo: false,
    music: { enabled: false, title: '', artist: '', fileId: '' },
    playing: false, musicError: '', musicBusy: false
  },
  onLoad() {
    this._destroyed = false;
    this._requestId = 0;
    this._liking = new Set();
    this._unsubscribe = music.subscribe(state => this.setData({ playing: state.playing, musicError: state.error || '' }));
  },
  onShow() {
    this.setData({ demo: api.isDemo() });
    this.loadSession();
    this.loadFeed(true);
  },
  onUnload() {
    this._destroyed = true;
    this._requestId += 1;
    if (this._unsubscribe) this._unsubscribe();
  },
  onHide() { music.stop(); },
  async loadSession() {
    try {
      const result = await api.session();
      if (this._destroyed) return;
      this.setData({ music: result.music || this.data.music });
    } catch (error) {
      if (this._destroyed) return;
      this.setData({ musicError: error.message || '暂时无法获取音乐设置' });
    }
  },
  async loadFeed(reset) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const requestId = ++this._requestId;
    const cursor = reset ? 0 : this.data.nextCursor;
    this.setData({ loading: true, refreshing: Boolean(reset && this.data.posts.length), error: '' });
    try {
      const result = await api.call('feed', {
        category: this.data.category, keyword: this.data.keyword.trim(),
        cursor, sort: this.data.sort, mine: false
      });
      const resolved = await api.resolveImages(result.items || []);
      if (requestId !== this._requestId) return;
      const incoming = resolved.map(decorate);
      const previous = reset ? [] : this.data.posts;
      const ids = new Set(previous.map(post => post.id));
      const posts = previous.concat(incoming.filter(post => !ids.has(post.id)));
      this.setData({ posts, columns: columnsFor(posts), nextCursor: result.nextCursor, hasMore: result.nextCursor !== null && result.nextCursor !== undefined });
    } catch (error) {
      if (requestId === this._requestId) this.setData({ error: error.message || '作品加载失败，请稍后重试' });
    } finally {
      if (requestId === this._requestId) this.setData({ loading: false, refreshing: false });
      wx.stopPullDownRefresh();
    }
  },
  onPullDownRefresh() { this.loadSession(); this.loadFeed(true); },
  onReachBottom() { this.loadFeed(false); },
  onKeywordInput(event) { this.setData({ keyword: event.detail.value }); },
  onSearch() { this.setData({ posts: [], columns: columnsFor([]) }); this.loadFeed(true); },
  onClearSearch() { this.setData({ keyword: '', posts: [], columns: columnsFor([]) }); this.loadFeed(true); },
  onCategory(event) {
    if (event.currentTarget.dataset.category === this.data.category) return;
    this.setData({ category: event.currentTarget.dataset.category, posts: [], columns: columnsFor([]) });
    this.loadFeed(true);
  },
  onSort(event) {
    if (event.currentTarget.dataset.sort === this.data.sort) return;
    this.setData({ sort: event.currentTarget.dataset.sort, posts: [], columns: columnsFor([]) });
    this.loadFeed(true);
  },
  onRetry() { this.loadFeed(this.data.posts.length === 0); },
  onOpenPost(event) { wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  async onLike(event) {
    const id = event.currentTarget.dataset.id;
    if (this._liking.has(id)) return;
    this._liking.add(id);
    try {
      const current = this.data.posts.find(post => post.id === id);
      if (!current) return;
      const result = await api.call('post.like', { id, liked: !current.liked });
      if (this._destroyed) return;
      const posts = this.data.posts.map(post => post.id === id ? decorate(Object.assign({}, post, result)) : post);
      this.setData({ posts, columns: columnsFor(posts) });
    } catch (error) { if (!this._destroyed) wx.showToast({ title: error.message || '点赞失败，请重试', icon: 'none' }); }
    finally { this._liking.delete(id); }
  },
  onCoverError(event) {
    const id = event.currentTarget.dataset.id;
    const posts = this.data.posts.map(post => post.id === id ? Object.assign({}, post, { coverUrl: '/assets/sample-1.jpg' }) : post);
    this.setData({ posts, columns: columnsFor(posts) });
  },
  async onToggleMusic() {
    if (this.data.musicBusy) return;
    if (!this.data.music.enabled || !this.data.music.fileId) {
      wx.showToast({ title: '管理员还没有设置首页音乐', icon: 'none' });
      return;
    }
    this.setData({ musicBusy: true });
    try { await music.toggle(this.data.music); }
    catch (error) { wx.showToast({ title: error.message || '音乐暂时无法播放', icon: 'none' }); }
    finally { this.setData({ musicBusy: false }); }
  },
  onPublish() { wx.switchTab({ url: '/pages/publish/index' }); },
  onShareAppMessage() { return { title: '黄水摄影 · 让每一次看见，都被记住', path: '/pages/index/index' }; },
  onShareTimeline() { return { title: '黄水摄影 · 让每一次看见，都被记住' }; }
});
