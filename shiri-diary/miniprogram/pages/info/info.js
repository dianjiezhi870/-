const C=require('../../config');
Page({data:{type:'privacy',title:'隐私说明',config:C},onLoad(o){const type=['privacy','terms','about'].includes(o.type)?o.type:'privacy';const title={privacy:'隐私说明',terms:'使用说明',about:'关于拾日手记'}[type];this.setData({type,title});wx.setNavigationBarTitle({title});}});
