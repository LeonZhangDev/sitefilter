/* SiteFilter 导入测试：jsdom 模拟 javbus 个人收藏页，验证 collectPageFavorites + importCollection */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = __dirname;
const code = require('./_load').contentBundle();

// 模拟 javbus 个人收藏页：女优/片商/系列/导演 链接 + 番号（href 与图片 alt）
const body = `
<div class="container">
  <div class="item">
    <a href="/star/1"><img src="a1.jpg">女优A</a>
    <a href="/ABC-100/">详情卡片</a>
  </div>
  <a href="/studio/5">片商X</a>
  <a href="/series/9">系列Y</a>
  <a href="/director/3">导演Z</a>
  <a href="/star/2"><img src="a2.jpg">女优B</a>
  <img src="b.jpg" alt="ABC-200">
</div>`;

const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
  url: 'https://www.javbus.com/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;
win.Element.prototype.getBoundingClientRect = function () {
  return { width: 220, height: 320, top: 0, left: 0, right: 220, bottom: 320, x: 0, y: 0 };
};

const store = {};
store['sf_data_v1'] = {
  settings: { enabled: true, sfw: false, onlyFav: false, boss: false, showBall: true, pinHighlight: true, markSeen: true, favBtn: true, hlColor: '#00e5ff', ball: { right: 24, bottom: 24 } },
  sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
  rules: [
    // 女优A 已在收藏夹（favorite），导入时应跳过
    { id: 'r0', type: 'actress', value: '女优A', aliases: [], action: 'favorite', match: 'contains', scope: 'actress', color: '', sites: [], enabled: true, hits: 0 },
  ],
  groups: [],
  seen: {},
  favCodes: {},
  discovered: {},
  dailyRecs: {},
  recHistory: [],
};
win.chrome = {
  storage: {
    local: {
      get(k, cb) { const o = {}; if (typeof k === 'string') o[k] = store[k]; else Object.keys(k).forEach(x => o[x] = store[x]); cb(o); },
      set(o, cb) { Object.assign(store, o); if (cb) cb(); },
    },
    onChanged: { addListener() { } },
  },
  runtime: { sendMessage() { return Promise.resolve(); }, onMessage: { addListener() { } } },
};

// 与真实 content script 一致：按 manifest 声明的顺序整体注入（见 _load.js）
win.eval(code);

setTimeout(() => {
  const doc = win.document;
  const host = doc.querySelector('.cf-host');
  const sr = host && host.shadowRoot;
  const importBtn = sr && sr.getElementById('importColl');

  let pass = true;
  const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

  check('悬浮球已注入', !!sr);
  check('导入按钮存在', !!importBtn);
  check('导入按钮在监管站点可见', importBtn && importBtn.style.display !== 'none');

  // 触发导入
  if (importBtn) importBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  setTimeout(() => {
    const rules = store['sf_data_v1'].rules || [];
    const favCodes = store['sf_data_v1'].favCodes || {};
    const actFav = rules.filter(r => r.type === 'actress' && r.action === 'favorite');
    const makerFav = rules.filter(r => r.type === 'maker' && r.action === 'favorite');
    const seriesFav = rules.filter(r => r.type === 'series' && r.action === 'favorite');
    const dirFav = rules.filter(r => r.type === 'director' && r.action === 'favorite');

    const actNames = actFav.map(r => r.value);
    check('女优A 已在收藏→跳过（不重复加入）', actFav.filter(r => r.value === '女优A').length === 1);
    check('女优B 被导入收藏', actNames.indexOf('女优B') !== -1);
    check('片商X 被导入收藏', makerFav.some(r => r.value === '片商X'));
    check('系列Y 被导入收藏', seriesFav.some(r => r.value === '系列Y'));
    check('导演Z 被导入收藏', dirFav.some(r => r.value === '导演Z'));
    check('番号 ABC-100 导入收藏夹', !!favCodes['ABC-100']);
    check('番号 ABC-200（图片 alt）导入收藏夹', !!favCodes['ABC-200']);

    console.log(pass ? '\n导入测试全部通过 ✅' : '\n导入测试存在失败 ❌');
    process.exit(pass ? 0 : 1);
  }, 150);
}, 500);
