const config = require('./config')

App({
  globalData: { user: null, cloudReady: false, config },
  onLaunch() {
    if (config.cloudEnv) {
      if (!wx.cloud) {
        wx.showModal({ title: '微信版本过低', content: '请更新微信后重试。', showCancel: false })
        return
      }
      wx.cloud.init({ env: config.cloudEnv, traceUser: true })
      this.globalData.cloudReady = true
    }
  },
  onError() {
    // 不记录用户内容、OPENID 或云调用响应，避免日志泄露。
  }
})
