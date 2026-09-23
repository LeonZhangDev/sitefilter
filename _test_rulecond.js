/* SiteFilter 规则条件 / 优先级 专项测试
   覆盖：
   ① 评分下限条件（ratingMin）
   ② 发行日期区间条件（dateFrom / dateTo）
   ③ 纯条件规则（只填评分/日期，无关键词）
   ④ firstMatchWins：按规则顺序、首个命中生效
   ⑤ 关闭 firstMatchWins 时退回「屏蔽 > 收藏 > 高亮」
   说明：jsdom 走真实 content.js，规则直接注入 storage（等价于用户在设置页建好规则）。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = 'C:\\Users\\admin\\Desktop\\site-filter';
const code = require('./_load').contentBundle();

/* 每张卡片可带评分/日期；用 item 的 class 标出评分与日期元素 */
function card(c, star, opts) {
  opts = opts || {};
  return `<div class="item">
    <a class="movie-box" href="/${c}">
      <div class="photo-frame"><img src="x.jpg" alt="${c}"></div>
      <div class="photo-info">
        <span class="title">Title ${c}</span>
        ${star ? `<a href="/star/99">${star}</a>` : ''}
        ${opts.rating != null ? `<span class="rating">${opts.rating}</span>` : ''}
        ${opts.date ? `<span class="date">${opts.date}</span>` : ''}
      </div>
    </a>
  </div>`;
}

const BODY = '<div class="container">' + [
  card('ABC-001', '明星甲', { rating: 4.8, date: '2024-06-01' }),  // 高分 + 新
  card('ABC-002', '明星甲', { rating: 2.1, date: '2019-01-01' }),  // 低分 + 旧
  card('ABC-003', '新人乙', { rating: 4.6, date: '2023-03-01' }),  // 高分 + 中
  card('ABC-004', '新人乙', { rating: 0, date: '' }),              // 无评分无日期
].join('') + '</div>';

function build(rules, settings, extra) {
  extra = extra || {};
  const dom = new JSDOM(`<!doctype html><html><body>${BODY}</body></html>`, {
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
    settings: Object.assign({
      enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
      showBall: true, pinHighlight: true, markSeen: false, favBtn: false,
      watchBtn: false, showWhy: false, blockDisplay: 'hide', previewMode: false,
      firstMatchWins: false, codeSearchBtns: true,
      hlColor: '#00e5ff', ball: { right: 24, bottom: 24 }, onboarded: true,
    }, settings || {}),
    peeks: {}, sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
    rules: rules, groups: [], seen: {}, favCodes: {}, discovered: {},
    dailyRecs: [], recHistory: [], cooc: extra.cooc || {},
  };
  win.chrome = {
    storage: {
      local: {
        get(k, cb) {
          const o = {};
          if (typeof k === 'string') o[k] = store[k];
          else Object.keys(k).forEach(x => { o[x] = store[x]; });
          cb(o);
        },
        set(o, cb) { Object.assign(store, o); if (cb) cb(); },
      },
      onChanged: { addListener() { } },
    },
    runtime: { sendMessage() { return Promise.resolve(); }, onMessage: { addListener() { } } },
  };
  // 与真实 content script 一致：按 manifest 声明的顺序整体注入（见 _load.js）
  win.eval(code);
  return { win, store };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

function cardOf(doc, wanted) {
  return Array.from(doc.querySelectorAll('.item')).find(el => {
    const a = el.querySelector('a[href^="/ABC-"]');
    return a && a.getAttribute('href') === '/' + wanted;
  });
}
const has = (el, cls) => !!(el && el.classList.contains(cls));

/* 默认 scope: 'all'（整卡文本）——女优名出现在女优区，不在标题里，
   用 'title' 会匹配不到，导致断言假通过/假失败。 */
const RS = (v, extra) => Object.assign({
  id: 'r_' + v, type: 'keyword', value: v, aliases: [], action: 'highlight',
  match: 'contains', scope: 'all', color: '#00e5ff', sites: [], enabled: true,
  hits: 0, createdAt: Date.now(), ratingMin: '', dateFrom: '', dateTo: '',
}, extra || {});

(async () => {
  /* ============ ① 评分下限条件 ============ */
  {
    const { win } = build([RS('', { ratingMin: 4.5 })]);
    await sleep(600);
    const doc = win.document;
    check('[评分] 4.8 分命中（≥4.5）→ 高亮', has(cardOf(doc, 'ABC-001'), 'cf-hl'));
    check('[评分] 2.1 分不命中（<4.5）→ 无标记', !has(cardOf(doc, 'ABC-002'), 'cf-hl'));
    check('[评分] 4.6 分命中（≥4.5）→ 高亮', has(cardOf(doc, 'ABC-003'), 'cf-hl'));
    check('[评分] 无评分卡片不命中 → 无标记', !has(cardOf(doc, 'ABC-004'), 'cf-hl'));
  }

  /* ============ ② 发行日期区间 ============ */
  {
    const { win } = build([RS('', { dateFrom: '2023-01-01', dateTo: '2024-12-31' })]);
    await sleep(600);
    const doc = win.document;
    check('[日期] 2024-06 在区间内 → 高亮', has(cardOf(doc, 'ABC-001'), 'cf-hl'));
    check('[日期] 2019-01 早于下限 → 无标记', !has(cardOf(doc, 'ABC-002'), 'cf-hl'));
    check('[日期] 2023-03 在区间内 → 高亮', has(cardOf(doc, 'ABC-003'), 'cf-hl'));
    check('[日期] 无日期卡片不命中 → 无标记', !has(cardOf(doc, 'ABC-004'), 'cf-hl'));
  }
  {
    // 只设下限
    const { win } = build([RS('', { dateFrom: '2023-06-01' })]);
    await sleep(600);
    const doc = win.document;
    check('[日期] 仅下限：2023-03 早于下限 → 无标记', !has(cardOf(doc, 'ABC-003'), 'cf-hl'));
    check('[日期] 仅下限：2024-06 符合 → 高亮', has(cardOf(doc, 'ABC-001'), 'cf-hl'));
  }
  {
    // 只设上限
    const { win } = build([RS('', { dateTo: '2020-01-01' })]);
    await sleep(600);
    const doc = win.document;
    check('[日期] 仅上限：2019-01 符合 → 高亮', has(cardOf(doc, 'ABC-002'), 'cf-hl'));
    check('[日期] 仅上限：2024-06 晚于上限 → 无标记', !has(cardOf(doc, 'ABC-001'), 'cf-hl'));
  }

  /* ============ ③ 条件 + 关键词 是 AND 关系 ============ */
  {
    // 关键词「明星甲」只命中 ABC-001/002；再叠加评分≥4 → 只剩 ABC-001
    const { win } = build([RS('明星甲', { ratingMin: 4 })]);
    await sleep(600);
    const doc = win.document;
    check('[AND] 明星甲 + 评分≥4：ABC-001 命中', has(cardOf(doc, 'ABC-001'), 'cf-hl'));
    check('[AND] 明星甲 + 评分≥4：ABC-002 因低分被排除', !has(cardOf(doc, 'ABC-002'), 'cf-hl'));
    check('[AND] 新人乙 不命中关键词 → 无标记', !has(cardOf(doc, 'ABC-003'), 'cf-hl'));
  }

  /* ============ ④ firstMatchWins：首个命中生效 ============ */
  {
    // 顺序：先 高亮(明星甲) → 后 屏蔽(明星甲)。
    // 开启 firstMatchWins 时，第一条命中的是「高亮」，所以应当高亮而不是屏蔽。
    const rules = [
      RS('明星甲', { action: 'highlight' }),
      { id: 'r2', type: 'keyword', value: '明星甲', aliases: [], action: 'block', match: 'contains', scope: 'all', color: '', sites: [], enabled: true, hits: 0, createdAt: Date.now() },
    ];
    const { win } = build(rules, { firstMatchWins: true, pinHighlight: false });
    await sleep(600);
    const doc = win.document;
    const c = cardOf(doc, 'ABC-001');
    check('[首个生效] 先高亮后屏蔽 → 走高亮（不隐藏）', has(c, 'cf-hl') && !has(c, 'cf-blocked'));
  }
  {
    // 顺序颠倒：先 屏蔽 → 后 高亮。首个命中是「屏蔽」，应当隐藏。
    const rules = [
      { id: 'r1', type: 'keyword', value: '明星甲', aliases: [], action: 'block', match: 'contains', scope: 'all', color: '', sites: [], enabled: true, hits: 0, createdAt: Date.now() },
      RS('明星甲', { action: 'highlight' }),
    ];
    const { win } = build(rules, { firstMatchWins: true, pinHighlight: false });
    await sleep(600);
    const doc = win.document;
    const c = cardOf(doc, 'ABC-001');
    check('[首个生效] 先屏蔽后高亮 → 走屏蔽（隐藏）', has(c, 'cf-blocked') && !has(c, 'cf-hl'));
  }
  {
    // 首个命中的是「收藏」
    const rules = [
      RS('明星甲', { action: 'favorite' }),
      { id: 'r2', type: 'keyword', value: '明星甲', aliases: [], action: 'block', match: 'contains', scope: 'all', color: '', sites: [], enabled: true, hits: 0, createdAt: Date.now() },
    ];
    const { win } = build(rules, { firstMatchWins: true });
    await sleep(600);
    const doc = win.document;
    const c = cardOf(doc, 'ABC-001');
    check('[首个生效] 先收藏后屏蔽 → 走收藏（金星描边、不隐藏）', has(c, 'cf-fav') && !has(c, 'cf-blocked'));
  }

  /* ============ ⑤ 关闭 firstMatchWins：退回 屏蔽 > 收藏 > 高亮 ============ */
  {
    // 同一条规则表：先高亮后屏蔽。关闭开关后，屏蔽应当胜出。
    const rules = [
      RS('明星甲', { action: 'highlight' }),
      { id: 'r2', type: 'keyword', value: '明星甲', aliases: [], action: 'block', match: 'contains', scope: 'all', color: '', sites: [], enabled: true, hits: 0, createdAt: Date.now() },
    ];
    const { win } = build(rules, { firstMatchWins: false, pinHighlight: false });
    await sleep(600);
    const doc = win.document;
    const c = cardOf(doc, 'ABC-001');
    check('[回退] 关闭「首个生效」后屏蔽优先于高亮', has(c, 'cf-blocked') && !has(c, 'cf-hl'));
  }
  {
    // 收藏 + 高亮同时命中 → 两者都生效（收藏优先标记，高亮仍可置顶）
    const rules = [
      RS('明星甲', { action: 'favorite' }),
      RS('明星甲', { action: 'highlight' }),
    ];
    const { win } = build(rules, { firstMatchWins: false, pinHighlight: false });
    await sleep(600);
    const doc = win.document;
    const c = cardOf(doc, 'ABC-001');
    check('[回退] 收藏 + 高亮可同时生效', has(c, 'cf-fav') && has(c, 'cf-hl'));
  }

  console.log(pass ? '\n规则条件 / 优先级测试全部通过 ✅' : '\n规则条件 / 优先级测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
