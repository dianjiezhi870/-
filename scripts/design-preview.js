#!/usr/bin/env node
'use strict';
// Static browser rendering of the real home-page WXML/WXSS with local demo data.
// This is a design aid, not a WeChat screenshot, simulator, or functional test.
// Optional dependency: Playwright + Chromium available to this Node process.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) { throw new Error('Optional Playwright dependency is unavailable. Install it outside the checkout or provide NODE_PATH, then run again.'); }
  const root = path.resolve(__dirname, '..');
  const mini = path.join(root, 'miniprogram');
  const context = vm.createContext({ require: () => ({}), Page: page => { context.pageDefinition = page; }, Set });
  vm.runInContext(fs.readFileSync(path.join(mini, 'pages/index/index.js'), 'utf8'), context);
  const demo = require('../miniprogram/services/demo').initial();
  const posts = demo.posts.map(post => context.decorate({ ...post, images: post.images.map(image => ({ ...image, url: image.fileId })) }));
  const data = { ...context.pageDefinition.data, posts, columns: context.columnsFor(posts), demo: true, loading: false, hasMore: false };
  const wxml = fs.readFileSync(path.join(mini, 'pages/index/index.wxml'), 'utf8');
  const wxss = [path.join(mini, 'app.wxss'), path.join(mini, 'pages/index/index.wxss')].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
  const width = 390;
  const css = wxss.replace(/([\d.]+)rpx/g, (_, number) => (Number(number) * width / 750) + 'px')
    .replace(/(^|[\s,>+~])page(?=[\s,{:.#])/g, '$1body')
    .replace(/(^|[\s,>+~])view(?=[\s,{:.#])/g, '$1div')
    .replace(/(^|[\s,>+~])text(?=[\s,{:.#])/g, '$1span')
    .replace(/(^|[\s,>+~])image(?=[\s,{:.#])/g, '$1img');
  const mapping = { view: 'div', text: 'span', image: 'img', 'scroll-view': 'div' };
  const source = wxml.replace(/<(\/?)(view|text|image|scroll-view)(\s|\/?>)/g, (_, end, tag, rest) => '<' + end + mapping[tag] + rest);
  const nativeTabs = app.tabBar.list.map((item, i) => `<div><img src="/${i === 0 ? item.selectedIconPath : item.iconPath}"/><span style="color:${i === 0 ? app.tabBar.selectedColor : app.tabBar.color}">${item.text}</span></div>`).join('');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}
html,body{margin:0;width:390px;overflow-x:hidden}body{padding-bottom:64px}input{border:0;outline:0;background:transparent;font-family:inherit}button{border:0;font-family:inherit}img{object-fit:cover}.preview-caption{background:#183b36;color:#e2f0e9;padding:9px 15px;font:11px/1.5 sans-serif;letter-spacing:.3px}.preview-tabs{position:fixed;bottom:0;left:0;width:390px;height:62px;background:white;border-top:1px solid #e5eeea;display:flex;z-index:20;align-items:center}.preview-tabs>div{width:33.333%;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;line-height:1.2}.preview-tabs img{width:25px;height:25px}.category-scroll{overflow-x:auto;scrollbar-width:none}
</style><body><div class="preview-caption">浏览器静态设计预览 · 非微信运行截图</div><main id="content"></main><nav class="preview-tabs">${nativeTabs}</nav><template id="wxml">${source}</template></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
    const decoded = decodeURIComponent(req.url.split('?')[0]);
    if (!decoded.startsWith('/assets/') || decoded.includes('..')) { res.writeHead(404); res.end(); return; }
    const file = path.join(mini, decoded);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', file.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let browser;
  try {
    const executablePath = process.env.HS_CHROMIUM_PATH || (fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : '/usr/bin/chromium');
    browser = await chromium.launch({ headless: true, ...(fs.existsSync(executablePath) ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width, height: 980 }, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(({ data, ratio }) => {
      const evaluate = (expression, scope) => Function('scope', 'with(scope){return (' + expression.replace(/^{{|}}$/g, '') + ')}')(scope);
      const interpolate = (text, scope) => text.replace(/{{([\s\S]*?)}}/g, (_, expression) => {
        const value = evaluate(expression, scope);
        return value === undefined || value === null ? '' : String(value);
      });
      function children(parent, scope) {
        const fragment = document.createDocumentFragment();
        let conditionMatched = false;
        let hasCondition = false;
        for (const source of parent.childNodes) {
          if (source.nodeType === Node.TEXT_NODE) {
            fragment.append(document.createTextNode(interpolate(source.textContent, scope)));
            continue;
          }
          if (source.nodeType !== Node.ELEMENT_NODE) continue;
          if (source.hasAttribute('wx:if')) {
            conditionMatched = Boolean(evaluate(source.getAttribute('wx:if'), scope)); hasCondition = true;
            if (!conditionMatched) continue;
          } else if (source.hasAttribute('wx:else')) {
            if (hasCondition && conditionMatched) continue;
            conditionMatched = true;
          } else { conditionMatched = false; hasCondition = false; }
          fragment.append(element(source, scope));
        }
        return fragment;
      }
      function element(source, scope) {
        if (source.hasAttribute('wx:for')) {
          const fragment = document.createDocumentFragment();
          const list = evaluate(source.getAttribute('wx:for'), scope);
          const clone = source.cloneNode(true); clone.removeAttribute('wx:for');
          const name = source.getAttribute('wx:for-item') || 'item';
          const index = source.getAttribute('wx:for-index') || 'index';
          Array.from(list || []).forEach((value, i) => fragment.append(element(clone, { ...scope, [name]: value, [index]: i })));
          return fragment;
        }
        const node = document.createElement(source.tagName.toLowerCase());
        for (const attr of source.attributes) {
          if (/^(wx:|bind|catch|data-)/.test(attr.name)) continue;
          let value = interpolate(attr.value, scope);
          if (attr.name === 'style') value = value.replace(/([\d.]+)rpx/g, (_, number) => Number(number) * ratio + 'px');
          if (attr.name === 'mode') { node.style.objectFit = value === 'aspectFit' ? 'contain' : 'cover'; continue; }
          node.setAttribute(attr.name, value);
        }
        node.append(children(source, scope));
        return node;
      }
      const template = document.getElementById('wxml');
      document.getElementById('content').append(children(template.content, data));
      template.remove();
    }, { data, ratio: width / 750 });
    await page.evaluate(() => Promise.all(Array.from(document.images).map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = image.onerror = resolve; }))));
    const result = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      missingImages: Array.from(document.images).filter(image => !image.naturalWidth).map(image => image.getAttribute('src')),
      cards: document.querySelectorAll('.photo-card').length,
      overflowingElements: Array.from(document.querySelectorAll('body *')).filter(element => element.getBoundingClientRect().right > window.innerWidth + 1 && !element.closest('.category-scroll')).map(element => element.className).slice(0, 10)
    }));
    const out = path.join(root, 'docs/home-design-preview.png');
    await page.screenshot({ path: out, fullPage: false });
    console.log(JSON.stringify({ file: out, ...result }, null, 2));
    if (result.scrollWidth > width || result.missingImages.length || result.cards !== demo.posts.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
