/* SiteFilter 写回完整性 专项测试
 *
 * 为什么单独一个套件：这个项目反复被同一类 bug 咬 —— 「整体写回时丢字段」。
 * content.js 里所有写入都是「读出整库 → 改几个字段 → 写回整库」，
 * 只要读出来的对象不完整（或读的契约理解错了），写回就会把没在默认列表里的
 * 字段悄悄冲掉：曾经丢过 watchlist / cooc / similarRecs / recFeedbackDaily / peeks，
 * 这次又发现 cfGet 的回调契约与 7 个调用点不一致，导致每日统计一落盘就把整库换掉
 * （连 errLog 一起消失，schemaVersion 也被抹掉）。
 *
 * 所以这里不测"某个功能好不好用"，而是测一条不变量：
 *     ****任何一次写入之后，它没打算改的字段都必须原样还在。****
 *
 * 覆盖 4 条真实写入路径：
 *   ① 交互写入：点卡片 ♥ → saveState（同步、立即落盘）
 *   ② 每日统计：3s 空闲后 flushStats 落盘
 *   ③ 共同浏览：6s 后 bumpCooc 落盘
 *   ④ 错误日志：5s 攒批后 persistErr 落盘（种子里放一条写坏的表达式规则来触发）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = __dirname;
const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');   // 只读 content.js：源码守卫断言不该被别的文件蒙对
const bundle = require('./_load').contentBundle();

/* 种子数据：故意塞进两个"不在 saveState 默认列表里"的字段
   —— recSettings（真实字段，历史上就是它最容易被冲掉）和 __sentinel（哨兵，任何写回都不该动它）。 */
const SEED_KEYS = [
  'settings', 'sites', 'rules', 'seen', 'favCodes', 'discovered', 'groups', 'statsLog',
  'dailyRecs', 'recHistory', 'recFeedback', 'recFeedbackDaily', 'watchlist', 'cooc',
  'similarRecs', 'peeks', 'errLog',
  // v8 新增的两个番号级标记：必须进这份名单，否则"被写丢"这件事不会被任何断言看见
  'codeMarks', 'dropped',
  'recSettings', '__sentinel',
];

function seedData() {
  return {
    schemaVersion: 2,
    settings: {
      enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
      showBall: true, pinHighlight: true, markSeen: true, favBtn: true, watchBtn: true,
      showWhy: false, previewMode: false, firstMatchWins: false,
      // v6：softBlock 由三档 blockDisplay 取代。这里显式写 'hide'（等价旧 softBlock:false），
      // 不让测试隐性依赖 step 6 迁移 —— 迁移本身有 _test_softblock.js 阶段四专门覆盖。
      blockDisplay: 'hide',
      codeSearchBtns: false, probeLinks: false, hlColor: '#00e5ff', keys: {},
      ball: { right: 24, bottom: 24 }, onboarded: true,
    },
    sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
    rules: [
      { id: 'r1', type: 'actress', value: '三上悠亚', aliases: [], action: 'block', match: 'contains', scope: 'actress', enabled: true, hits: 0 },
      // 故意写坏的表达式：用来触发 logErr → persistErr 这条写入路径
      { id: 'r2', type: 'keyword', value: '', expr: '(rating >= 4', aliases: [], action: 'highlight', match: 'contains', scope: 'all', enabled: true, hits: 0 },
    ],
    groups: [], seen: {}, favCodes: {}, discovered: {},
    statsLog: {}, dailyRecs: {}, recHistory: [], recFeedback: {}, recFeedbackDaily: {},
    watchlist: { 'ABC-900': { t: '早就加好的待看', at: 1 } },
    cooc: { '三上悠亚': { n: 2, w: { 'ABC-001': 1 } } },
    similarRecs: { '三上悠亚': { at: 1, parts: ['巨乳'] } },
    peeks: { 'ABC-800': Date.now() },
    errLog: [{ t: 1, w: 'old', m: '历史日志不该被冲掉', s: 'javbus.com' }],
    codeMarks: { 'ABC-700': { r: 5, note: '早就打过分的', at: 1 } },   // v8：影片级评分/备注
    dropped: { 'ABC-701': 1 },                                          // v8：「弃」标记
    recSettings: { enabled: true, max: 12, newMax: 6 },   // ← 不在 saveState 默认列表里
    __sentinel: 'keep-me',                                 // ← 任何写回都不该动它
  };
}

const BODY = '<div class="container">' + ['ABC-001', 'ABC-002', 'ABC-003'].map(c =>
  `<div class="item"><a class="movie-box" href="/${c}">
     <div class="photo-frame"><img src="x.jpg" alt="${c}"></div>
     <div class="photo-info"><span class="title">Title ${c}</span><a href="/star/1">明星甲</a><a href="/genre/1">高清</a>
     <span class="rating">4.8</span><span class="date">2024-06-01</span></div>
   </a></div>`).join('') + '</div>';

const dom = new JSDOM(`<!doctype html><html><body>${BODY}</body></html>`, {
  url: 'https://www.javbus.com/', runScripts: 'outside-only', pretendToBeVisual: true,
});
const win = dom.window;
win.Element.prototype.getBoundingClientRect = function () {
  return { width: 220, height: 320, top: 0, left: 0, right: 220, bottom: 320, x: 0, y: 0 };
};
const store = { sf_data_v1: seedData() };
win.chrome = {
  storage: {
    local: {
      get(k, cb) { const o = {}; if (typeof k === 'string') o[k] = store[k]; else Object.keys(k).forEach(x => o[x] = store[x]); cb(o); },
      set(o, cb) { Object.assign(store, o); if (cb) cb(); },
    },
    sync: {
      get(k, cb) { const o = {}; o[k] = store[k]; cb(o); },
      set(o, cb) { Object.assign(store, o); if (cb) cb(); },
    },
    onChanged: { addListener() { } },
  },
  runtime: { sendMessage() { return Promise.resolve(); }, onMessage: { addListener() { } } },
};
win.eval(bundle);

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 每次写入后都必须成立：21 个字段一个不少
function assertIntact(label) {
  const d = store.sf_data_v1 || {};
  const missing = SEED_KEYS.filter(k => !(k in d));
  check('[写回] ' + label + '：字段无丢失（缺失：' + (missing.join(',') || '无') + '）', missing.length === 0);
  check('[写回] ' + label + '：recSettings 未被冲掉', !!(d.recSettings && d.recSettings.max === 12));
  check('[写回] ' + label + '：哨兵字段原样保留', d.__sentinel === 'keep-me');
}

(async () => {
  await sleep(700);

  check('[起始] 初始字段齐全', SEED_KEYS.every(k => k in store.sf_data_v1));

  /* ① 交互写入：点卡片上的 ♥ → saveState 立即落盘 */
  const fav = win.document.querySelector('.item .cf-favbtn');
  check('[起始] 卡片 ♥ 按钮已注入（可点）', !!fav);
  if (fav) fav.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  check('[路径①] ♥ 收藏确实写入了 favCodes', Object.keys(store.sf_data_v1.favCodes || {}).length === 1);
  assertIntact('路径① 交互写入');

  /* ② 每日统计：3s 空闲后落盘（曾经这条路径会把整库换成只含 statsLog 的对象） */
  await sleep(3400);
  const day = (function () { const t = new Date(); return t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate(); })();
  check('[路径②] 统计快照已写入 statsLog', !!(store.sf_data_v1.statsLog && store.sf_data_v1.statsLog[day]));
  assertIntact('路径② 统计落盘');

  /* ④ 错误日志：5s 攒批后落盘（种子里的坏表达式已触发 logErr） */
  await sleep(2200);
  const errs = store.sf_data_v1.errLog || [];
  check('[路径④] 新增错误日志已落盘', errs.some(e => /expr/.test(String(e.w))));
  check('[路径④] 历史日志没被覆盖', errs.some(e => e.m === '历史日志不该被冲掉'));
  assertIntact('路径④ 错误日志落盘');

  /* ③ 共同浏览：6s 后落盘 */
  await sleep(2200);
  check('[路径③] 共同浏览数据仍在（未被空对象覆盖）', !!(store.sf_data_v1.cooc && store.sf_data_v1.cooc['三上悠亚']));
  assertIntact('路径③ 共同浏览落盘');

  /* 其它不该被冲掉的既有数据 */
  check('[保留] 已加的待看还在', !!(store.sf_data_v1.watchlist && store.sf_data_v1.watchlist['ABC-900']));
  check('[保留] 相似推荐缓存还在', !!(store.sf_data_v1.similarRecs && store.sf_data_v1.similarRecs['三上悠亚']));
  check('[保留] 放行记录还在', !!(store.sf_data_v1.peeks && store.sf_data_v1.peeks['ABC-800']));
  check('[保留] 影片评分/备注还在（v8 新字段）',
    !!(store.sf_data_v1.codeMarks && store.sf_data_v1.codeMarks['ABC-700'] &&
       store.sf_data_v1.codeMarks['ABC-700'].r === 5));
  check('[保留] 「弃」标记还在（v8 新字段）', !!(store.sf_data_v1.dropped && store.sf_data_v1.dropped['ABC-701']));

  /* 源码守卫：不许再出现「cfGet 回调里二次解包 DATA_KEY」的写法 */
  check('守卫：content.js 里已无 o[DATA_KEY] 二次解包',
    !/var\s+d\s*=\s*o\[DATA_KEY\]/.test(code) && !/\},\s*o\[DATA_KEY\]/.test(code));
  check('守卫：cfGet 的契约已写明（回调直接给数据对象）',
    /cb 收到的是\*\*数据对象本身\*\*/.test(code));

  console.log(pass ? '\n写回完整性测试全部通过 ✅' : '\n写回完整性测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
