const D=require('./date');
const PREFIX='shiri.v1.entry.', DRAFT='shiri.v1.draft.', JOURNAL='shiri.v1.import';
const MOODS=[{id:'happy',label:'开心',symbol:'☺'},{id:'calm',label:'平静',symbol:'◡'},{id:'full',label:'充实',symbol:'✧'},{id:'tired',label:'疲惫',symbol:'☾'},{id:'low',label:'低落',symbol:'☁'}];
const WEATHERS=['晴天','多云','下雨','下雪'];
let cache=null;
function validate(value, draft) {
  if(!value || typeof value!=='object' || !D.valid(value.date) || value.date>D.today()) throw new Error('记录日期无效');
  if(typeof value.title!=='string'||value.title.length>40||typeof value.content!=='string'||value.content.length>6000) throw new Error('标题或正文格式不正确');
  if(!draft&&!value.content.trim()) throw new Error('日记正文不能为空');
  if(!MOODS.some(m=>m.id===value.mood)||!WEATHERS.includes(value.weather)) throw new Error('心情或天气格式不正确');
  if(!Array.isArray(value.tags)||value.tags.length>5||value.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>10)) throw new Error('标签格式不正确');
  if(!Number.isFinite(value.createdAt)||!Number.isFinite(value.updatedAt)||value.createdAt<0||value.updatedAt<value.createdAt||value.updatedAt>4102444800000) throw new Error('记录时间无效');
  return {date:value.date,title:value.title,content:value.content,mood:value.mood,weather:value.weather,tags:[...new Set(value.tags)],createdAt:value.createdAt,updatedAt:value.updatedAt};
}
function recover() {
  const log=wx.getStorageSync(JOURNAL);
  if(!log)return;
  if(!Array.isArray(log)||log.some(x=>!x||typeof x.key!=='string'||!x.key.startsWith(PREFIX)||x.before!==null)) throw new Error('备份恢复记录异常，请勿清理缓存');
  log.forEach(x=>wx.removeStorageSync(x.key));
  wx.removeStorageSync(JOURNAL);cache=null;
}
function list(force) {
  if(cache&&!force)return cache.map(e=>({...e,tags:e.tags.slice()}));
  recover(); const keys=wx.getStorageInfoSync().keys;
  const result=keys.filter(k=>k.startsWith(PREFIX)).map(k=>{
    const e=validate(wx.getStorageSync(k));
    if(k!==PREFIX+e.date)throw new Error('本机记录索引异常');
    return e;
  });
  cache=result.sort((a,b)=>b.date.localeCompare(a.date));
  return list();
}
function get(date){ if(!D.valid(date))throw new Error('日期无效');return list().find(e=>e.date===date)||null; }
function save(value) {
  const e=validate(value); recover();
  wx.setStorageSync(PREFIX+e.date,e);cache=null;return e;
}
function remove(date) {if(!D.valid(date))throw new Error('日期无效');recover();wx.removeStorageSync(DRAFT+date);wx.removeStorageSync(PREFIX+date);cache=null;}
function draftGet(date) {if(!D.valid(date))return null; const e=wx.getStorageSync(DRAFT+date); return e?validate(e,true):null;}
function draftSave(e) {const value=validate(e,true);wx.setStorageSync(DRAFT+value.date,value);}
function draftRemove(date) {if(D.valid(date))wx.removeStorageSync(DRAFT+date);}
function clear() {recover();try{wx.getStorageInfoSync().keys.filter(k=>k.startsWith(PREFIX)||k.startsWith(DRAFT)).forEach(k=>wx.removeStorageSync(k));}finally{cache=null;}}
function mood(id){return MOODS.find(m=>m.id===id)||MOODS[1];}
function display(e){return {...e,moodLabel:mood(e.mood).label,moodSymbol:mood(e.mood).symbol,day:Number(e.date.slice(8)),month:Number(e.date.slice(5,7)),weekday:D.weekday(e.date),wordCount:D.words(e.content),preview:e.content.replace(/\s+/g,' ').slice(0,110)};}
function backup(month) {
  if(!/^\d{4}-\d{2}$/.test(month))throw new Error('备份月份无效');
  return JSON.stringify({format:'shiri-diary',version:1,month,exportedAt:Date.now(),entries:list().filter(e=>e.date.slice(0,7)===month)},null,2);
}
function parseBackup(text) {
  if(typeof text!=='string'||text.length>260000)throw new Error('备份过大，请使用按月备份');
  let v; try{v=JSON.parse(text);}catch(e){throw new Error('不是完整的备份文本，请重新粘贴');}
  if(!v||v.format!=='shiri-diary'||v.version!==1||!/^\d{4}-\d{2}$/.test(v.month)||!Array.isArray(v.entries)||v.entries.length>31)throw new Error('不是支持的拾日手记按月备份');
  const entries=v.entries.map(e=>validate(e));const seen=new Set();
  entries.forEach(e=>{if(e.date.slice(0,7)!==v.month||seen.has(e.date))throw new Error('备份日期重复或与月份不一致');seen.add(e.date);});
  return entries;
}
function importBackup(text) {
  const incoming=parseBackup(text);recover();const existing=new Set(list().map(e=>e.date));
  const additions=incoming.filter(e=>!existing.has(e.date));
  if(!additions.length)return {added:0,skipped:incoming.length};
  // Only add missing dates. The journal rolls back an interrupted import on next launch.
  wx.setStorageSync(JOURNAL,additions.map(e=>({key:PREFIX+e.date,before:null})));
  try {
    additions.forEach(e=>wx.setStorageSync(PREFIX+e.date,e));
    wx.removeStorageSync(JOURNAL);cache=null;
    return {added:additions.length,skipped:incoming.length-additions.length};
  }catch(error){cache=null;try{recover();}catch(e){throw new Error('导入中断。空间恢复后重启小程序可继续回滚，请勿清理缓存');}throw new Error('空间不足或写入失败，已撤销本次导入，原日记保持不变');}
}
module.exports={MOODS,WEATHERS,recover,list,get,save,remove,draftGet,draftSave,draftRemove,clear,display,backup,parseBackup,importBackup};
