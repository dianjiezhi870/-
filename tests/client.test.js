const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
function load(name, globals) {
  const module = { exports:{} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/services',name+'.js'),'utf8'), { module, exports:module.exports, ...globals }, {filename:name+'.js'})
  return module.exports
}
test('demo publishing remains private, persists locally, and never grants administrator rights', async () => {
  const store = new Map()
  const demo = load('demo', {wx:{getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v)}})
  const {user} = await demo.call('session')
  assert.equal(user.isAdmin,false)
  const {post} = await demo.call('post.create',{title:'新照片',content:'你好',images:[{fileId:'/local.jpg',width:800,height:600}],category:'山野',location:''})
  assert.equal(post.status,'pending')
  const publicFeed = await demo.call('feed')
  assert.equal(publicFeed.items.some(p=>p.id===post.id),false)
  assert.equal((await demo.call('feed',{mine:true})).items[0].id,post.id)
  await assert.rejects(demo.call('settings.update',{music:{enabled:true}}),/管理员/)
  assert.equal(store.size,1)
})
test('cloud adapter surfaces permission errors and resolves nested cloud image and avatar URLs', async () => {
  const app={globalData:{cloudReady:true}}
  const wx={cloud:{callFunction:async({data})=>({result:data.action==='bad'?{ok:false,error:{code:'FORBIDDEN',message:'没有权限'}}:{ok:true,data:{items:[{images:[{fileId:'cloud://env/photo.jpg'}],author:{avatarUrl:'cloud://env/avatar.jpg'}}]}}}),getTempFileURL:async({fileList})=>({fileList:fileList.map(fileID=>({fileID,status:0,tempFileURL:'https://signed/'+fileID.split('/').pop()}))})}}
  const api=load('api',{wx,getApp:()=>app,require:n=>n==='../config'?{cloudEnv:'real',cloudFunction:'api'}:{}})
  const data=await api.call('feed')
  assert.equal(data.items[0].images[0].url,'https://signed/photo.jpg')
  assert.equal(data.items[0].author.avatarUrl,'https://signed/avatar.jpg')
  await assert.rejects(api.call('bad'),e=>e.code==='FORBIDDEN'&&e.message==='没有权限')
})
test('upload handles WeChat temporary paths without extensions and preserves the audio filename type', async () => {
  const paths=[]
  const wx={getImageInfo:({success})=>success({type:'jpeg'}),cloud:{callFunction:async()=>({result:{ok:true,data:{user:{id:'openid'},music:{}}}}),uploadFile:async({cloudPath})=>{paths.push(cloudPath);return {fileID:'cloud://env/'+cloudPath}}}}
  const api=load('api',{wx,getApp:()=>({globalData:{cloudReady:true}}),require:n=>n==='../config'?{cloudEnv:'real',cloudFunction:'api'}:{}})
  await api.upload('wxfile://tmp_no_extension','photos')
  await api.upload('wxfile://tmp_another','music','my-song.MP3')
  assert.match(paths[0],/^uploads\/openid\/photos-.+\.jpeg$/)
  assert.match(paths[1],/^uploads\/openid\/music-.+\.mp3$/)
  await assert.rejects(api.upload('wxfile://tmp','music','bad.exe'),/MP3/)
})
test('music refreshes expired signed URLs for the same cloud song, pauses and stops on demand', async () => {
  const handlers={},played=[]
  const audio={src:'',onPlay:f=>handlers.play=f,onPause:f=>handlers.pause=f,onStop:f=>handlers.stop=f,onEnded:f=>handlers.end=f,onError:f=>handlers.error=f,play(){played.push(this.src);handlers.play()},pause(){handlers.pause()},stop(){handlers.stop()}}
  let version=0
  const wx={createInnerAudioContext:()=>audio,cloud:{getTempFileURL:async()=>({fileList:[{status:0,tempFileURL:'https://music/'+(++version)}]})}}
  const music=load('music',{wx})
  const states=[]
  const unsubscribe=music.subscribe(s=>states.push(s))
  const song={enabled:true,fileId:'cloud://env/song.mp3',url:'https://music/expired'}
  await music.toggle(song)
  assert.equal(played[0],'https://music/1')
  await music.toggle(song)
  assert.equal(states.at(-1).playing,false)
  music.stop()
  await music.toggle(song)
  assert.equal(played[1],'https://music/2')
  handlers.error()
  assert.match(states.at(-1).error,/无法播放/)
  unsubscribe()
})
