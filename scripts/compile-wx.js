#!/usr/bin/env node
// 微信维护的 miniprogram-compiler 封装 WCC/WCSC；本地编译，不上传、不发布。
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const compiler = require('miniprogram-compiler')
const root = path.resolve(__dirname, '../miniprogram')
const pages = require('../miniprogram/app.json').pages
const wxml = compiler.wxmlToJs(root)
const wxss = compiler.wxssToJs(root)
assert.ok(wxml.length && wxss.length)
const context = vm.createContext({ window:{}, console })
const gwx = vm.runInContext('(function(global){'+wxml+'})({})',context)
function definition(page) {
  let result
  vm.runInNewContext(fs.readFileSync(path.join(root,page+'.js'),'utf8'), {require:()=>({}),Page:p=>{result=p}})
  return result
}
function render(page, data) { const tree = gwx(page+'.wxml')(data); assert.equal(tree.tag,'wx-page'); return tree }
function count(tree, className) {
  if (!tree || typeof tree !== 'object') return 0
  const classes = String(tree.attr && tree.attr.class || '').split(/\s+/)
  return (classes.includes(className)?1:0) + (tree.children || []).reduce((n,v)=>n+count(v,className),0)
}
for (const page of pages) render(page, definition(page).data)
const example = require('../miniprogram/services/demo').initial().posts[0]
example.images[0].url = example.images[0].fileId
const home = definition('pages/index/index').data
const card = {...example,coverUrl:example.images[0].url,coverHeight:300}
let tree = render('pages/index/index', {...home,posts:[card],columns:[{id:'column-0',items:[card]},{id:'column-1',items:[]}]})
assert.equal(count(tree,'photo-card'),1)
tree = render('pages/index/index',{...home,loading:false})
assert.equal(count(tree,'empty-state'),1)
tree = render('pages/publish/index',{...definition('pages/publish/index').data,ready:true,images:[{path:'/a.jpg'},{path:'/b.jpg'}]})
assert.equal(count(tree,'photo-tile'),2)
assert.equal(count(tree,'category-pill'),4)
assert.equal(count(tree,'demo-note'),0)
tree = render('pages/profile/index',{...definition('pages/profile/index').data,user:{id:'user',nickname:'摄影爱好者',isAdmin:false},items:[example]})
assert.equal(count(tree,'my-post'),1)
assert.equal(count(tree,'admin-row'),0)
assert.equal(count(tree,'editor-card'),0)
tree = render('pages/detail/index',{...definition('pages/detail/index').data,loading:false,post:example,comments:[{id:'c',content:'真美',authorName:'读者'}]})
assert.equal(count(tree,'detail-image'),1)
assert.equal(count(tree,'comment-item'),1)
tree = render('pages/admin/index',{...definition('pages/admin/index').data,loading:false,authorized:false})
assert.equal(count(tree,'music-card'),0)
tree = render('pages/admin/index',{...definition('pages/admin/index').data,loading:false,authorized:true,items:[example]})
assert.equal(count(tree,'music-card'),1)
assert.equal(count(tree,'review-card'),1)
console.log(`WCC/WCSC passed: ${pages.length} WXML pages, app + page WXSS; rendered empty/populated lists, editor and administrator visibility.`)
console.log('These local template checks do not replace current WeChat Developer Tools and real-device validation.')
