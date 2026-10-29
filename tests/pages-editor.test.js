const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function makePage(name, overrides = {}) {
  let definition
  const calls = []
  const storage = {}
  const api = {
    isDemo: () => false,
    session: async () => ({ user: { id: 'user-1', nickname: '小黄', isAdmin: false }, music: {} }),
    call: async (action, data) => { calls.push([action, data]); return {} },
    upload: async (filePath, kind) => {
      calls.push(['upload', { filePath, kind }])
      return 'cloud://environment/uploads/user-1/test.jpg'
    },
    removeUploads: async ids => { calls.push(['cleanup', ids]) },
    resolveImages: async items => items,
    ...overrides
  }
  const wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: key => { delete storage[key] },
    showToast: options => { calls.push(['toast', options]) },
    showModal: options => { calls.push(['modal', options]); options.success({ confirm: true }) },
    switchTab: options => { calls.push(['tab', options]) },
    navigateTo: options => { calls.push(['navigate', options]) },
    setClipboardData: options => { calls.push(['copy', options]) },
    stopPullDownRefresh: () => {},
    previewImage: () => {}
  }
  const scriptPath = path.join(__dirname, '../miniprogram/pages', name, 'index.js')
  vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), {
    require: moduleName => {
      assert.equal(moduleName, '../../services/api')
      return api
    },
    Page: page => { definition = page },
    wx,
    console,
    Promise,
    Set,
    Date,
    Number,
    encodeURIComponent
  }, { filename: scriptPath })
  definition.data = JSON.parse(JSON.stringify(definition.data))
  definition.setData = updates => Object.assign(definition.data, updates)
  return { page: definition, calls, api, wx, storage }
}

test('publish requires photos, uploads a valid post, clears draft and opens my gallery', async () => {
  const { page, calls, storage } = makePage('publish', {
    call: async (action, data) => { calls.push([action, data]); return { post: { id: 'new-post' } } }
  })
  page.onLoad()
  await page.onShow()
  await page.submit()
  assert.equal(calls.filter(call => call[0] === 'post.create').length, 0)
  page.setData({ title: '山中云海', content: '清晨的第一道光', images: [{ path: '/tmp/photo.jpg', width: 1200, height: 800 }] })
  page.saveDraft()
  assert.ok(storage[page.draftKey()])
  await page.submit()
  const publish = calls.find(call => call[0] === 'post.create')
  assert.equal(publish[1].images.length, 1)
  assert.equal(publish[1].category, '山野')
  assert.equal(page.data.images.length, 0)
  assert.equal(storage[page.draftKey()], undefined)
  assert.ok(calls.some(call => call[0] === 'tab' && call[1].url === '/pages/profile/index'))
})

test('failed photo batch cleans up uploaded files and retains editable form', async () => {
  let uploadIndex = 0
  const { page, calls } = makePage('publish', {
    upload: async () => {
      if (uploadIndex++) throw new Error('上传中断')
      return 'cloud://environment/uploads/user-1/first.jpg'
    }
  })
  page.onLoad()
  await page.onShow()
  page.setData({ title: '光影', images: [{ path: 'a.jpg', width: 1, height: 1 }, { path: 'b.jpg', width: 1, height: 1 }] })
  await page.submit()
  assert.ok(calls.some(call => call[0] === 'cleanup'))
  assert.equal(calls.filter(call => call[0] === 'post.create').length, 0)
  assert.equal(page.data.images.length, 2)
  assert.equal(page.data.submitting, false)
  assert.equal(page.data.error, '上传中断')
})

test('ambiguous publish failure preserves uploaded photos that may already belong to a saved post', async () => {
  const { page, calls } = makePage('publish', {
    call: async () => { throw new Error('网络超时') }
  })
  page.onLoad()
  await page.onShow()
  page.setData({ title: '山间', images: [{ path: 'a.jpg', width: 1, height: 1 }] })
  await page.submit()
  assert.equal(calls.filter(call => call[0] === 'cleanup').length, 0)
  assert.equal(page.data.images.length, 1)
  assert.equal(page.data.submitting, false)
})

test('ordinary user cannot load admin queue, save music or trigger review', async () => {
  const { page, calls } = makePage('admin')
  await page.refresh()
  assert.equal(page.data.authorized, false)
  await page.saveMusic()
  await page.reviewPost({ currentTarget: { dataset: { id: 'other-post', status: 'published' } } })
  assert.equal(calls.length, 0)
})

test('administrator saves music and explicitly confirms a publication review', async () => {
  const { page, calls } = makePage('admin', {
    session: async () => ({ user: { id: 'administrator', isAdmin: true }, music: { enabled: false } }),
    call: async (action, data) => {
      calls.push([action, data])
      if (action === 'moderation.list') return { items: [] }
      if (action === 'settings.update') return { music: data.music }
      return { post: { id: 'post-1' } }
    }
  })
  await page.refresh()
  assert.equal(page.data.authorized, true)
  page.setData({ musicEnabled: true, musicTitle: '山间', musicFileId: 'cloud://environment/music', musicDirty: true })
  await page.saveMusic()
  assert.ok(calls.some(call => call[0] === 'settings.update' && call[1].music.enabled))
  await page.reviewPost({ currentTarget: { dataset: { id: 'post-1', status: 'published' } } })
  const confirmIndex = calls.findIndex(call => call[0] === 'modal')
  const reviewIndex = calls.findIndex(call => call[0] === 'post.review')
  assert.ok(confirmIndex >= 0 && reviewIndex > confirmIndex)
  assert.equal(page.data.reviewingId, '')
  assert.equal(page.data.musicDirty, false)
})

test('cancelled moderation confirmation does not mutate a post', async () => {
  const { page, calls, wx } = makePage('admin', {
    session: async () => ({ user: { id: 'administrator', isAdmin: true }, music: {} }),
    call: async action => { calls.push([action]); return { items: [] } }
  })
  await page.refresh()
  wx.showModal = options => options.success({ confirm: false })
  await page.reviewPost({ currentTarget: { dataset: { id: 'post-1', status: 'rejected' } } })
  assert.equal(calls.filter(call => call[0] === 'post.review').length, 0)
  assert.equal(page.data.reviewingId, '')
})

test('my gallery shows moderation status, stats and persists a nickname update', async () => {
  const { page, calls } = makePage('profile', {
    call: async (action, data) => {
      calls.push([action, data])
      if (action === 'my.stats') return { posts: 1, likesReceived: 2, commentsReceived: 3 }
      if (action === 'feed') return { items: [{ id: 'post-1', images: [{ url: '/photo.jpg' }], status: 'pending' }], nextCursor: null }
      if (action === 'profile.update') return { user: { id: 'user-1', nickname: data.nickname, isAdmin: false } }
    }
  })
  await page.refresh()
  assert.equal(page.data.items[0].statusText, '审核中')
  assert.equal(page.data.stats.likesReceived, 2)
  assert.equal(page.data.hasMore, false)
  page.openEditor()
  page.setData({ nickname: '新昵称' })
  await page.saveProfile()
  assert.ok(calls.some(call => call[0] === 'profile.update' && call[1].nickname === '新昵称'))
})
