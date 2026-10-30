const store = require('./utils/store');
App({
  onLaunch() {
    try { store.recover(); }
    catch (e) { this.globalData.storageError = true; }
  },
  onShow() {},
  globalData: { storageError: false }
});
