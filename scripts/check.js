// 静态完整性检查；不会将这些检查描述为微信官方编译。
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(f => f.name === 'node_modules' || f.name === '.git' ? [] : f.isDirectory() ? walk(path.join(dir, f.name)) : [path.join(dir, f.name)]) }
const files = walk(root)
let js = 0, json = 0
files.forEach(file => {
  if (file.endsWith('.js')) { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); js++ }
  if (file.endsWith('.json')) { JSON.parse(fs.readFileSync(file, 'utf8')); json++ }
})
const project = require('../project.config.json')
assert.equal(project.appid, 'wx6436c6c484376d9b')
const mini = path.join(root, project.miniprogramRoot)
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json')))
for (const page of app.pages) {
  for (const ext of ['js','json','wxml','wxss']) assert.ok(fs.existsSync(path.join(mini, page+'.'+ext)), `${page}.${ext} missing`)
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(mini, page+'.js'), 'utf8'), { require: () => ({}), Page: p => { definition = p } })
  const template = fs.readFileSync(path.join(mini, page+'.wxml'), 'utf8')
  for (const match of template.matchAll(/wx:(?:if|elif|for)="([^"]*)"/g)) assert.ok(match[1].startsWith('{{') && match[1].endsWith('}}'), `${page}: directive needs data binding braces`)
  for (const match of template.matchAll(/(?:bind|catch)(?::)?[a-z]+="([A-Za-z_$][\w$]*)"/g)) assert.equal(typeof definition[match[1]], 'function', `${page}: unknown event ${match[1]}`)
}
for (const item of app.tabBar.list) {
  assert.ok(app.pages.includes(item.pagePath), 'tab must be registered')
  for (const key of ['iconPath','selectedIconPath']) assert.ok(fs.existsSync(path.join(mini,item[key])), `${item[key]} missing`)
}
for (const file of files.filter(f => f.endsWith('.wxml') || (f.endsWith('.js') && f.includes('/miniprogram/')))) {
  for (const m of fs.readFileSync(file,'utf8').matchAll(/["'](\/assets\/[\w.-]+)["']/g)) assert.ok(fs.existsSync(path.join(mini,m[1])), `${m[1]} referenced by ${file} missing`)
}
const bytes = walk(mini).reduce((n,f) => n+fs.statSync(f).size,0)
assert.ok(bytes < 2 * 1024 * 1024, `main package source exceeds 2MiB: ${bytes}`)
console.log(`Static checks passed: ${js} JS, ${json} JSON, ${app.pages.length} page routes, event handlers, assets; main source ${(bytes/1024/1024).toFixed(2)} MiB.`)
console.log('Use npm run compile for WCC/WCSC validation; current WeChat Developer Tools and device APIs still require final acceptance.')
