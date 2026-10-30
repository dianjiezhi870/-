const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const ROOT=path.resolve(__dirname,'../miniprogram');
const D=require(path.join(ROOT,'utils/date'));
let data,S,failWrite,writeCount,navigation,clipboards,confirmed,modals;
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function freshStore(){const file=require.resolve(path.join(ROOT,'utils/store'));delete require.cache[file];return require(file);}
beforeEach(()=>{
 data=new Map();failWrite=null;writeCount=0;navigation=[];clipboards=[];confirmed=true;modals=[];
 global.wx={
  getStorageSync:k=>clone(data.get(k))||'',
  setStorageSync(k,v){writeCount++;if(failWrite&&failWrite(k,v,writeCount))throw new Error('quota exceeded');data.set(k,clone(v));},
  getStorageInfoSync:()=>({keys:[...data.keys()],currentSize:1,limitSize:10240}),
  removeStorageSync:k=>data.delete(k),
  showToast(){},showModal(o){modals.push(o);if(o.success)o.success({confirm:confirmed,cancel:!confirmed});},
  navigateTo:o=>navigation.push(o.url),navigateBack:()=>navigation.push('back'),switchTab:o=>navigation.push(o.url),
  stopPullDownRefresh(){},enableAlertBeforeUnload(){},disableAlertBeforeUnload(){},setNavigationBarTitle(){},
  setClipboardData(o){clipboards.push(o.data);if(o.success)o.success();}
 };
 global.getCurrentPages=()=>[{},{}];S=freshStore();
});
function entry(date=D.today(),more={}){return {date,title:'今天的小事',content:'走了一段路，拍到了树影。',mood:'calm',weather:'晴天',tags:['散步'],createdAt:1000,updatedAt:2000,...more};}
function bundle(entries,month){return JSON.stringify({format:'shiri-diary',version:1,month:month||entries[0]?.date.slice(0,7)||'2024-01',entries});}
function page(name){const f=require.resolve(path.join(ROOT,'pages',name,name));delete require.cache[f];let definition;global.Page=o=>definition=o;require(f);const p={...definition,data:clone(definition.data),setData(o){Object.assign(this.data,clone(o));}};return p;}
test('validates real Gregorian dates and rejects malformed dates',()=>{
 assert.equal(D.valid('2024-02-29'),true);assert.equal(D.valid('2025-02-29'),false);assert.equal(D.valid('2024-13-01'),false);assert.equal(D.valid('2024-1-01'),false);assert.equal(D.valid('../x'),false);
});
test('day and month calculations cross leap days and year boundaries',()=>{
 assert.equal(D.shift('2024-03-01',-1),'2024-02-29');assert.equal(D.shift('2024-12-31',1),'2025-01-01');assert.equal(D.monthShift('2024-01',-1),'2023-12');assert.equal(D.weekday('2024-01-01'),'星期一');
});
test('calendar has 42 unique Monday-first days and entry markers',()=>{
 const g=D.grid('2024-02','2024-02-29',new Set(['2024-02-29']));assert.equal(g.length,42);assert.equal(new Set(g.map(x=>x.date)).size,42);assert.equal(g[0].date,'2024-01-29');const leap=g.find(x=>x.date==='2024-02-29');assert.ok(leap.selected&&leap.hasEntry&&leap.inMonth);
});
test('unicode character counting ignores whitespace',()=>assert.equal(D.words('今天 ☺\n🌿 '),4));
test('saves reads edits and sorts records; same day remains one entry',()=>{
 S.save(entry('2024-01-02'));S.save(entry('2024-01-01'));S.save(entry('2024-01-02',{content:'修改后的正文'}));assert.equal(S.list().length,2);assert.equal(S.list()[0].date,'2024-01-02');assert.equal(S.get('2024-01-02').content,'修改后的正文');
});
test('returned values cannot mutate the cached records',()=>{S.save(entry());const all=S.list();all[0].content='破坏';all[0].tags.push('另一个');assert.notEqual(S.get(D.today()).content,'破坏');assert.deepEqual(S.get(D.today()).tags,['散步']);});
test('rejects invalid or future dates and blank saved entries',()=>{
 assert.throws(()=>S.save(entry('2025-02-29')));assert.throws(()=>S.save(entry(D.shift(D.today(),1))));assert.throws(()=>S.save(entry(D.today(),{content:' \n '})));assert.equal(S.list().length,0);
});
test('enforces text limits and controlled mood/weather/tags',()=>{
 for(const change of [{title:'a'.repeat(41)},{content:'a'.repeat(6001)},{mood:'unknown'},{weather:'GPS'},{tags:Array(6).fill('a')},{tags:['a'.repeat(11)]},{updatedAt:10}])assert.throws(()=>S.save(entry(D.today(),change)));
});
test('strips arbitrary imported fields and renders content as plain text',()=>{
 const e=S.save(entry(D.today(),{admin:true,html:'<script>bad()</script>',content:'<script>只是文字</script>'}));assert.equal(e.admin,undefined);assert.equal(e.html,undefined);assert.match(e.content,/<script>/);
});
test('drafts persist separately and allow a temporarily blank body',()=>{
 S.save(entry());S.draftSave(entry(D.today(),{content:'',updatedAt:3000}));assert.equal(S.draftGet(D.today()).content,'');assert.notEqual(S.get(D.today()).content,'');S.draftRemove(D.today());assert.equal(S.draftGet(D.today()),null);
});
test('quota failure does not overwrite the prior saved entry',()=>{
 S.save(entry());failWrite=k=>k.startsWith('shiri.v1.entry.');assert.throws(()=>S.save(entry(D.today(),{content:'新文字'})));assert.equal(S.get(D.today()).content,'走了一段路，拍到了树影。');
});
test('statistics include a streak ending yesterday when today is unwritten',()=>{
 const yesterday=D.shift(D.today(),-1);const all=[entry(yesterday),entry(D.shift(yesterday,-1))];assert.equal(D.stats(all).streak,2);all.push(entry(D.today()));assert.equal(D.stats(all).streak,3);assert.equal(D.stats(all).total,3);
});
test('monthly backups exclude other months and all drafts',()=>{
 S.save(entry('2024-01-01'));S.save(entry('2024-02-01'));S.draftSave(entry('2024-01-03'));const b=JSON.parse(S.backup('2024-01'));assert.equal(b.entries.length,1);assert.equal(b.entries[0].date,'2024-01-01');assert.equal(b.version,1);
});
test('rejects malformed incomplete foreign duplicated and mixed-month backups before writing',()=>{
 const invalid=['not json','{}',bundle([entry('2024-01-01'),entry('2024-01-01')]),bundle([entry('2024-02-01')],'2024-01'),bundle([entry('2024-01-01',{content:''})]),'a'.repeat(260001)];
 for(const s of invalid)assert.throws(()=>S.importBackup(s));assert.equal(data.size,0);
});
test('import adds missing days without overwriting existing ones',()=>{
 S.save(entry('2024-01-01',{content:'不能覆盖'}));const result=S.importBackup(bundle([entry('2024-01-01',{content:'覆盖尝试'}),entry('2024-01-02')]));assert.deepEqual(result,{added:1,skipped:1});assert.equal(S.get('2024-01-01').content,'不能覆盖');assert.equal(S.list().length,2);
});
test('failed multi-entry import rolls back only new entries',()=>{
 S.save(entry('2024-01-01'));let newWrites=0;failWrite=k=>k.startsWith('shiri.v1.entry.')&&++newWrites===2;
 assert.throws(()=>S.importBackup(bundle([entry('2024-01-02'),entry('2024-01-03')])));S=freshStore();assert.deepEqual(S.list().map(e=>e.date),['2024-01-01']);assert.equal(data.has('shiri.v1.import'),false);
});
test('an interrupted import is rolled back on the next launch',()=>{
 S.save(entry('2024-01-01'));data.set('shiri.v1.import',[{key:'shiri.v1.entry.2024-01-02',before:null},{key:'shiri.v1.entry.2024-01-03',before:null}]);data.set('shiri.v1.entry.2024-01-02',entry('2024-01-02'));S=freshStore();S.recover();assert.deepEqual(S.list().map(e=>e.date),['2024-01-01']);
});
test('recovery refuses a journal targeting unrelated storage',()=>{data.set('other-data','保留');data.set('shiri.v1.import',[{key:'other-data',before:null}]);assert.throws(()=>S.recover());assert.equal(data.get('other-data'),'保留');});
test('corrupt storage is reported and never silently discarded',()=>{data.set('shiri.v1.entry.2024-01-01',{bad:true});assert.throws(()=>S.list());assert.equal(data.size,1);});
test('delete removes the selected day and draft only',()=>{S.save(entry('2024-01-01'));S.save(entry('2024-01-02'));S.draftSave(entry('2024-01-01'));S.remove('2024-01-01');assert.equal(S.get('2024-01-01'),null);assert.equal(S.draftGet('2024-01-01'),null);assert.equal(S.list().length,1);});
test('clear preserves unrelated settings and does not touch other namespaces',()=>{S.save(entry());S.draftSave(entry());data.set('shiri.notice.hidden',true);data.set('other-app','other');S.clear();assert.equal(S.list().length,0);assert.equal(data.get('other-app'),'other');assert.equal(data.get('shiri.notice.hidden'),true);});
test('home supports pagination date search and mood filtering',()=>{
 for(let i=1;i<=25;i++)S.save(entry('2024-01-'+String(i).padStart(2,'0'),{mood:i===1?'happy':'calm'}));
 const p=page('home');p.onShow();assert.equal(p.data.entries.length,20);p.more();assert.equal(p.data.entries.length,25);p.setData({keyword:'2024-01-01'});p.applyFilter();assert.equal(p.data.entries.length,1);p.setData({keyword:'',filter:'happy'});p.applyFilter();assert.equal(p.data.entries.length,1);p.onUnload();
});
test('editor restores a newer draft and saves one record with its creation time',()=>{
 S.save(entry());S.draftSave(entry(D.today(),{content:'未保存的草稿',createdAt:1000,updatedAt:4000}));const p=page('editor');p.onLoad({date:D.today()});assert.equal(p.data.content,'未保存的草稿');assert.equal(p.data.draftRestored,true);p.save();assert.equal(S.get(D.today()).content,'未保存的草稿');assert.equal(S.get(D.today()).createdAt,1000);assert.equal(S.draftGet(D.today()),null);p.onUnload();
});
test('editor keeps a newer saved entry over a stale draft',()=>{
 S.save(entry(D.today(),{content:'已保存最新版',updatedAt:5000}));S.draftSave(entry(D.today(),{content:'旧草稿',updatedAt:3000}));const p=page('editor');p.onLoad({date:D.today()});assert.equal(p.data.content,'已保存最新版');assert.equal(p.data.draftRestored,false);p.onUnload();
});
test('editing autosaves drafts on hide and rejects blank final saves',()=>{
 const p=page('editor');p.onLoad({date:D.today()});p.edit({currentTarget:{dataset:{field:'content'}},detail:{value:'写到一半'}});p.onHide();assert.equal(S.draftGet(D.today()).content,'写到一半');assert.equal(S.get(D.today()),null);p.setData({content:' '});p.save();assert.equal(S.get(D.today()),null);p.onUnload();
});
test('discarding modifications reloads the saved version',()=>{
 S.save(entry());const p=page('editor');p.onLoad({date:D.today()});p.edit({currentTarget:{dataset:{field:'content'}},detail:{value:'准备丢弃'}});p.flushDraft();p.discard();assert.equal(S.draftGet(D.today()),null);assert.equal(p.data.content,'走了一段路，拍到了树影。');p.onUnload();
});
test('failed final save retains text and does not navigate away',()=>{
 const p=page('editor');p.onLoad({date:D.today()});p.edit({currentTarget:{dataset:{field:'content'}},detail:{value:'空间不足也要保住'}});failWrite=k=>k.startsWith('shiri.v1.entry.');p.save();assert.equal(p.data.content,'空间不足也要保住');assert.equal(navigation.length,0);assert.ok(modals.length);failWrite=null;p.onUnload();
});
test('calendar and detail page load a saved entry',()=>{S.save(entry());const p=page('calendar');p.onShow();assert.equal(p.data.entry.date,D.today());p.open();assert.match(navigation[0],/detail/);const d=page('detail');d.onLoad({date:D.today()});d.onShow();assert.equal(d.data.entry.date,D.today());});
test('canceling a delete preserves the journal',()=>{S.save(entry());confirmed=false;const p=page('detail');p.onLoad({date:D.today()});p.onShow();p.remove();assert.ok(S.get(D.today()));});
test('backup writes to clipboard only after explicit confirmation',()=>{
 S.save(entry());const p=page('backup');p.generate();assert.equal(clipboards.length,0);confirmed=false;p.copy();assert.equal(clipboards.length,0);confirmed=true;p.copy();assert.equal(clipboards.length,1);assert.equal(JSON.parse(clipboards[0]).entries.length,1);
});
test('app configuration is complete and points to the supplied appid',()=>{
 const root=path.resolve(ROOT,'..');const config=JSON.parse(fs.readFileSync(path.join(root,'project.config.json')));assert.equal(config.appid,'wx6436c6c484376d9b');const app=JSON.parse(fs.readFileSync(path.join(ROOT,'app.json')));for(const page of app.pages)for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(ROOT,page+'.'+ext)));for(const tab of app.tabBar.list)for(const k of ['iconPath','selectedIconPath'])assert.ok(fs.existsSync(path.join(ROOT,tab[k])));
});
test('product has no network data transfer location login or public-content sharing APIs',()=>{
 const files=[];function walk(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,d.name);if(d.isDirectory())walk(f);else if(/\.js$/.test(f))files.push(f);}}walk(ROOT);
 const text=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');assert.doesNotMatch(text,/wx\.(request\(|uploadFile\(|downloadFile\(|login\(|getUserProfile\(|getLocation\(|getClipboardData\(|shareFileMessage\(|cloud\.)/);assert.doesNotMatch(text,/onShareAppMessage\s*[:(]/);
});
