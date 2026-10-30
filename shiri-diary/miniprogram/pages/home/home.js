const S=require('../../utils/store');const D=require('../../utils/date');
Page({
  data:{today:'',day:'',monthLabel:'',weekday:'',stats:{total:0,streak:0,words:0},entries:[],keyword:'',filter:'',moods:S.MOODS,notice:true,error:'',hasToday:false,limit:20,totalMatches:0},
  onShow(){this.refresh();},
  onUnload(){clearTimeout(this._searchTimer);},
  onPullDownRefresh(){try{this.refresh(true);}finally{wx.stopPullDownRefresh();}},
  refresh(force){
    const date=D.today();this.setData({today:date,day:Number(date.slice(8)),monthLabel:date.slice(0,4)+' / '+date.slice(5,7),weekday:D.weekday(date)});
    try{this._all=S.list(force);this.setData({stats:D.stats(this._all),hasToday:this._all.some(e=>e.date===date),notice:!wx.getStorageSync('shiri.notice.hidden'),error:''});this.applyFilter();}
    catch(e){this.setData({error:'本机记录读取失败，请先重启小程序。不要清理缓存，以免丢失记录。',entries:[]});}
  },
  applyFilter(){const q=this.data.keyword.trim().toLowerCase();const f=this.data.filter;
    const result=(this._all||[]).filter(e=>(!f||e.mood===f)&&(!q||[e.date,e.title,e.content,e.tags.join(' ')].join(' ').toLowerCase().includes(q)));
    this.setData({entries:result.slice(0,this.data.limit).map(S.display),totalMatches:result.length});
  },
  search(e){this.setData({keyword:e.detail.value,limit:20});clearTimeout(this._searchTimer);this._searchTimer=setTimeout(()=>this.applyFilter(),160);},
  filter(e){this.setData({filter:e.currentTarget.dataset.id,limit:20});this.applyFilter();},
  more(){this.setData({limit:this.data.limit+20});this.applyFilter();},
  write(){wx.navigateTo({url:'/pages/editor/editor?date='+D.today()});},
  open(e){wx.navigateTo({url:'/pages/detail/detail?date='+e.currentTarget.dataset.date});},
  dismiss(){try{wx.setStorageSync('shiri.notice.hidden',true);this.setData({notice:false});}catch(e){wx.showToast({title:'暂时无法保存设置',icon:'none'});}}
});
