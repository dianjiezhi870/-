// 使用前台音频，访客主动播放；退出首页停止，不申请后台音乐权限。
let audio = null
let source = ''
let state = { playing: false, error: '' }
const listeners = new Set()
function emit(patch) { state = Object.assign({}, state, patch); listeners.forEach(fn => fn(state)) }
function subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn) }
function stop() { if (audio) audio.stop(); source = ''; emit({ playing: false }) }
async function toggle(music) {
  if (!music || !music.enabled || !music.fileId) { emit({ error: '主理人还没有设置歌曲', playing: false }); return }
  if (state.playing && source === music.fileId) { audio.pause(); return }
  if (!audio) {
    audio = wx.createInnerAudioContext()
    audio.autoplay = false
    audio.obeyMuteSwitch = true
    audio.onPlay(() => emit({ playing: true, error: '' }))
    audio.onPause(() => emit({ playing: false }))
    audio.onStop(() => emit({ playing: false }))
    audio.onEnded(() => { source = ''; emit({ playing: false }) })
    audio.onError(() => { source = ''; emit({ playing: false, error: '歌曲暂时无法播放，请稍后重试' }) })
  }
  try {
    {
      let url = music.url || music.fileId
      if (music.fileId.startsWith('cloud://')) {
        const r = await wx.cloud.getTempFileURL({ fileList: [music.fileId] })
        if (!r.fileList[0] || r.fileList[0].status) throw new Error('无法读取歌曲')
        url = r.fileList[0].tempFileURL
      }
      if (source !== music.fileId || audio.src !== url) audio.src = url
      source = music.fileId
    }
    audio.play()
  } catch (_) { emit({ playing: false, error: '歌曲暂时无法播放，请稍后重试' }) }
}
module.exports = { toggle, stop, subscribe }
