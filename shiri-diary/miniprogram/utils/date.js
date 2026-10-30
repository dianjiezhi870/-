const pad = n => String(n).padStart(2, '0');
function key(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function today() { return key(new Date()); }
function parse(s) { const a = String(s).split('-').map(Number); return new Date(a[0], a[1]-1, a[2], 12); }
function valid(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '1900-01-01' && s <= '2100-12-31' && key(parse(s)) === s; }
function shift(s, days) { const d=parse(s); d.setDate(d.getDate()+days); return key(d); }
function monthShift(s, step) { const a=s.split('-').map(Number); const d=new Date(a[0],a[1]-1+step,1,12); return key(d).slice(0,7); }
function weekday(s) { return '星期' + '日一二三四五六'[parse(s).getDay()]; }
function pretty(s) { const a=s.split('-'); return Number(a[0])+'年'+Number(a[1])+'月'+Number(a[2])+'日'; }
function grid(month, selected, dates) {
  const first=month+'-01'; const offset=(parse(first).getDay()+6)%7;
  const start=shift(first,-offset); const now=today();
  return Array.from({length:42},(_,i)=>{ const date=shift(start,i); return { date, day:Number(date.slice(8)), inMonth:date.slice(0,7)===month, today:date===now, selected:date===selected, hasEntry:dates.has(date), future:date>now }; });
}
function words(s) { return Array.from(String(s || '').replace(/\s/g,'')).length; }
function stats(entries) {
  const dates=new Set(entries.map(e=>e.date)); const now=today();
  let d=dates.has(now)?now:shift(now,-1), streak=0;
  while(dates.has(d)){streak++;d=shift(d,-1);}
  return { total:entries.length, streak, words:entries.reduce((n,e)=>n+words(e.content),0), month:entries.filter(e=>e.date.slice(0,7)===now.slice(0,7)).length };
}
module.exports={pad,key,today,parse,valid,shift,monthShift,weekday,pretty,grid,words,stats};
