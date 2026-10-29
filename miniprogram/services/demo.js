// 仅用于未绑定云环境时的本机演示。真实权限、审核与数据由云函数执行。
const KEY = 'huangshui-demo-v1'
const clone = v => JSON.parse(JSON.stringify(v))
const error = message => { throw new Error(message) }
function initial() {
  const titles = ['把日常泡进一杯咖啡', '今天的温柔，是一只猫', '点火之后，仰望天空', '山水之间，等一场雾', '让时间停在快门里', '星河，是遥远的来信']
  const categories = ['日常', '日常', '人文', '山野', '街拍', '山野']
  const sizes = [[600,400],[451,300],[640,427],[1536,1024],[512,512],[1000,872]]
  const author = { id: 'demo-gallery', nickname: '黄水摄影 · 示例', avatarUrl: '/assets/avatar.png' }
  return {
    user: { id: 'demo-visitor', nickname: '摄影爱好者', avatarUrl: '/assets/avatar.png', isAdmin: false },
    music: { enabled: false, title: '', artist: '', fileId: '' },
    posts: titles.map((title, i) => ({ id: 'sample-' + (i+1), title, content: i===3 ? '青山与水，留一点空白给风。\n\n此图为 AI 生成的视觉示例，不代表黄水实景。' : '这些是本机演示作品，用于体验摄影分享界面。照片来源与许可见项目说明，不是社区真实投稿。\n\n正式连接云开发后，这些示例不会写入线上数据库。', category: categories[i], location: '示例作品', images: [{ fileId: `/assets/sample-${i+1}.jpg`, width:sizes[i][0], height:sizes[i][1] }], author, liked: false, likeCount: [28,56,17,128,42,93][i], commentCount: 0, status:'published', createdAt: Date.now() - i*3600000 })), comments: [], reports: []
  }
}
function read() { return wx.getStorageSync(KEY) || initial() }
function write(db) { wx.setStorageSync(KEY, db) }
function assertAdmin(db) { if (!db.user.isAdmin) error('只有管理员可以执行此操作') }
function visible(db, p) { return p && (p.status === 'published' || p.author.id === db.user.id || db.user.isAdmin) }
function find(db, id) { const p = db.posts.find(p => p.id === id); if (!visible(db, p)) error('作品不存在或暂未公开'); return p }
function text(v, max, label, required = true) { if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim())) error(label + '格式不正确'); return v.trim() }
function page(items, cursor) { const start = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0; return { items: items.slice(start, start+12), nextCursor: start+12 < items.length ? start+12 : null } }
async function call(action, data = {}) {
  const db = read()
  let out
  switch (action) {
    case 'session': out = { user: db.user, music: db.music }; break
    case 'settings.get': out = { music: db.music }; break
    case 'feed': {
      let posts = db.posts.filter(p => data.mine ? p.author.id === db.user.id : p.status === 'published')
      if (data.category && data.category !== '全部') posts = posts.filter(p => p.category === data.category)
      if (data.keyword) posts = posts.filter(p => (p.title+' '+p.content+' '+p.location).includes(data.keyword.trim()))
      posts.sort(data.sort === 'popular' ? (a,b) => b.likeCount-a.likeCount || b.createdAt-a.createdAt : (a,b) => b.createdAt-a.createdAt)
      out = page(posts, data.cursor); break
    }
    case 'detail': {
      const post = find(db, data.id)
      const p = page(db.comments.filter(c => c.postId === post.id), 0)
      out = { post, comments:p.items, nextCursor:p.nextCursor }; break
    }
    case 'comments.list': find(db, data.postId); out = page(db.comments.filter(c => c.postId === data.postId), data.cursor); break
    case 'profile.update': {
      db.user.nickname = text(data.nickname, 24, '昵称')
      if (data.avatarFileId) db.user.avatarUrl = data.avatarFileId
      db.posts.filter(p => p.author.id === db.user.id).forEach(p => { p.author = clone(db.user) })
      out = { user: db.user }; break
    }
    case 'post.create': {
      if (!Array.isArray(data.images) || !data.images.length || data.images.length > 9) error('请选择 1 至 9 张照片')
      if (!['山野','人文','街拍','日常'].includes(data.category)) error('请选择作品分类')
      const post = { id:'local-'+Date.now()+'-'+Math.random().toString(36).slice(2,8), title:text(data.title,40,'标题'), content:text(data.content || '',2000,'正文',false), images:data.images, category:data.category, location:text(data.location || '',40,'地点',false), author:clone(db.user), liked:false, likeCount:0, commentCount:0, status:'pending', createdAt:Date.now() }
      db.posts.unshift(post); out = { post }; break
    }
    case 'post.like': {
      const post = find(db, data.id)
      if (post.status !== 'published') error('审核通过后可以点赞')
      const liked = typeof data.liked === 'boolean' ? data.liked : !post.liked
      if (liked !== post.liked) post.likeCount += liked ? 1 : -1
      post.liked = liked; out = { liked, likeCount:post.likeCount }; break
    }
    case 'comment.create': {
      const post = find(db, data.postId)
      if (post.status !== 'published') error('审核通过后可以评论')
      const comment = { id:'comment-'+Date.now(), postId:post.id, content:text(data.content,500,'评论'), author:clone(db.user), createdAt:Date.now() }
      db.comments.push(comment); post.commentCount++; out = { comment, commentCount:post.commentCount }; break
    }
    case 'post.delete': {
      const post = find(db, data.id)
      if (post.author.id !== db.user.id && !db.user.isAdmin) error('只能删除自己的作品')
      db.posts = db.posts.filter(p => p.id !== post.id); db.comments = db.comments.filter(c => c.postId !== post.id); out = { deleted:true }; break
    }
    case 'my.stats': {
      const posts = db.posts.filter(p => p.author.id === db.user.id)
      out = { posts:posts.length, likesReceived:posts.reduce((n,p) => n+p.likeCount,0), commentsReceived:posts.reduce((n,p) => n+p.commentCount,0) }; break
    }
    case 'settings.update': assertAdmin(db); db.music = clone(data.music); out = { music:db.music }; break
    case 'moderation.list': assertAdmin(db); out = { items:db.posts.filter(p => p.status === 'pending') }; break
    case 'post.review': { assertAdmin(db); const post = find(db,data.id); if (!['published','rejected'].includes(data.status)) error('无效审核结果'); post.status = data.status; out={post}; break }
    case 'report.create': find(db,data.postId); db.reports.push({postId:data.postId,reason:text(data.reason,200,'举报原因')}); out={reported:true}; break
    default: error('暂不支持此操作')
  }
  write(db)
  return clone(out)
}
module.exports = { call, initial }
