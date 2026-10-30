const S=require('../../utils/store');const D=require('../../utils/date');
Page({
  data:{month:'',monthLabel:'',selected:'',selectedLabel:'',cells:[],weekdays:['一','二','三','四','五','六','日'],entry:null,monthCount:0,nextDisabled:true,future:false,error:'',maxMonth:''},
  onShow(){const now=D.today();if(!this.data.month)this.setData({month:now.slice(0,7),selected:now});this.reload();},
  reload(){try{const all=S.list();const m=this.data.month;const sel=this.data.selected;this.setData({cells:D.grid(m,sel,new Set(all.map(e=>e.date))),monthLabel:m.slice(0,4)+'年 '+Number(m.slice(5))+'月',maxMonth:D.today().slice(0,7),monthCount:all.filter(e=>e.date.slice(0,7)===m).length,nextDisabled:m>=D.today().slice(0,7),future:sel>D.today(),selectedLabel:D.pretty(sel)+' · '+D.weekday(sel),entry:all.find(e=>e.date===sel)?S.display(all.find(e=>e.date===sel)):null,error:''});}catch(e){this.setData({error:'记录暂时无法读取，请重启后再试。'});}},
  move(e){const step=Number(e.currentTarget.dataset.step);const month=D.monthShift(this.data.month,step);if(month>D.today().slice(0,7)||month<'1900-01')return;this.setData({month,selected:month===D.today().slice(0,7)?D.today():month+'-01'});this.reload();},
  pickMonth(e){const m=e.detail.value;if(m>D.today().slice(0,7)||m<'1900-01')return;this.setData({month:m,selected:m+'-01'});this.reload();},
  select(e){const date=e.currentTarget.dataset.date;this.setData({selected:date,month:date.slice(0,7)});this.reload();},
  today(){this.setData({selected:D.today(),month:D.today().slice(0,7)});this.reload();},
  open(){if(this.data.future)return;wx.navigateTo({url:'/pages/'+(this.data.entry?'detail/detail':'editor/editor')+'?date='+this.data.selected});}
});
