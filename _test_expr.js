/* SiteFilter 条件表达式 专项测试
   覆盖：
   ① 引擎本体（直接 require expr.js）：运算符、优先级、括号、取反、日期补全、错误处理、缓存
   ② 与 content.js 的接线：规则带 expr 时按表达式命中 / 屏蔽；expr 存在时忽略简单字段
   ③ 写坏表达式不崩溃，只记一条错误日志
   注意：引擎只有一份实现（expr.js），设置页测试器与页面跑的是同一份代码 —— 这点也在这里守住。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = 'C:\\Users\\admin\\Desktop\\site-filter';
const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');   // 只读 content.js：源码守卫断言不该被别的文件蒙对
const E = require(path.join(EXT, 'expr.js'));
// bundle 含 expr.js：与浏览器一致，整包注入
const bundle = require('./_load').contentBundle();

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

/* ==================================================================
 * 第一部分：引擎本体（不依赖 DOM）
 * ================================================================== */
console.log('---- 引擎本体 ----');

const ctx = {
  title: 'ssis-001 高清 中文字幕'.toLowerCase(),
  all: 'ssis-001 高清 中文字幕 三上悠亚 巨乳 s1'.toLowerCase(),
  actress: '三上悠亚 | 其他女优'.toLowerCase(),
  tag: '巨乳 | 高清'.toLowerCase(),
  maker: 's1'.toLowerCase(),
  series: '超高级系列'.toLowerCase(),
  director: '导演甲'.toLowerCase(),
  code: 'SSIS-001',
  rating: 4.8,
  date: '2024-06-01',
};

const t = (e, c) => E.test(e, c || ctx);

/* 1. 数值比较 + 逻辑与 */
check('rating >= 4 && date >= 2023-01-01 → 命中', t('rating >= 4 && date >= 2023-01-01'));
check('rating > 5 → 不命中', !t('rating > 5'));
check('rating <= 4.8 → 命中（含等号）', t('rating <= 4.8'));
check('date >= 2025 → 不命中', !t('date >= 2025'));

/* 2. 正则字面量（含 | 和 \d） */
check('title =~ /^(SSIS|STARS)-\\d+/ → 命中（大小写不敏感）', t('title =~ /^(SSIS|STARS)-\\d+/'));
check('title =~ /^(ABC)-\\d+/ → 不命中', !t('title =~ /^(ABC)-\\d+/'));
check('title !~ /ABC/ → 命中（不匹配即真）', t('title !~ /ABC/'));
check('title !~ /SSIS/ → 不命中', !t('title !~ /SSIS/'));

/* 3. 取反 + 括号 + 字段 */
check('!(tag ~ 巨乳) → 不命中', !t('!(tag ~ 巨乳)'));
check('!(tag ~ 不存在) → 命中', t('!(tag ~ 不存在)'));
check('(code =~ /^ABC-/ || maker ~ s1) → 命中（右侧为真）', t('(code =~ /^ABC-/ || maker ~ s1)'));

/* 4. 运算符优先级：&& 高于 || */
check('优先级：先假 || (真 && 假) → 不命中', !t('rating > 9 || (rating > 4 && tag ~ 不存在)'));
check('优先级：先真 || (真 && 假) → 命中', t('rating > 4 || (rating > 9 && tag ~ 不存在)'));

/* 5. 中文运算符与裸词（等价 all ~ 值） */
check('中文运算符：rating >= 4 且 tag ~ 巨乳 → 命中', t('rating >= 4 且 tag ~ 巨乳'));
check('中文运算符：rating >= 9 或 tag ~ 巨乳 → 命中', t('rating >= 9 或 tag ~ 巨乳'));
check('中文取反：非 (tag ~ 不存在) → 命中', t('非 (tag ~ 不存在)'));
check('裸词命中（all）：丝袜不在文本里 → 不命中', !t('丝袜'));
check('裸词命中（all）：高清在文本里 → 命中', t('高清'));

/* 6. = 精确（按分隔符切片）与 != */
check('actress = 三上悠亚 → 命中（切片后相等）', t('actress = 三上悠亚'));
check('actress = 三上 → 不命中（精确不是子串）', !t('actress = 三上'));
check('actress != 三上悠亚 → 不命中', !t('actress != 三上悠亚'));
check('maker != moodyz → 命中', t('maker != moodyz'));

/* 7. 引号值（含空格） */
check('引号值：title ~ "高清 中文字幕" → 命中', t('title ~ "高清 中文字幕"'));
check('引号值：title ~ "高清 字幕" → 不命中', !t('title ~ "高清 字幕"'));

/* 8. 日期补全（只写年 / 年月） */
check('date >= 2023 → 命中', t('date >= 2023'));
check('date <= 2024 → 命中（上限补满，含整年 2024）', t('date <= 2024'));
check('date >= 2025 → 不命中', !t('date >= 2025'));
check('date <= 2023 → 不命中', !t('date <= 2023'));
check('date >= 2024-06 → 命中（同为 6 月，下限补 0）', t('date >= 2024-06'));
check('date <= 2024-06 → 命中（上限补满到 6/31）', t('date <= 2024-06'));
check('date < 2024-06 → 不命中（6/31 上限 → 不早于）', !t('date < 2024-06'));

/* 9. 缺数据的卡片：数值比较不命中 */
check('无评分卡片：rating >= 0 → 不命中', !E.test('rating >= 0', { rating: null, date: null, all: 'x' }));
check('无日期卡片：date >= 1900 → 不命中', !E.test('date >= 1900', { rating: 5, date: '', all: 'x' }));
check('无评分卡片：tag ~ 值 仍可用', E.test('tag ~ 巨乳', { rating: null, tag: '巨乳', all: '巨乳' }));

/* 10. 错误处理：坏表达式不抛异常，只是不命中并给出原因 */
const bad = [
  ['未知字段', 'foo ~ 1'],
  ['缺右括号', '(rating >= 1'],
  ['多余右括号', 'rating >= 1)'],
  ['正则语法错', 'title =~ /([0-9/'],
  ['字段后缺值', 'rating >= '],
  ['数值比较用在文本字段', 'title > 3'],
  ['rating 用了 ~', 'rating ~ 4'],
  ['末尾有多余内容', 'rating >= 1 垃圾词'],
];
bad.forEach(([label, expr]) => {
  let threw = null, hit = null;
  try { hit = E.test(expr, ctx); } catch (e) { threw = e; }
  const c = E.check(expr);
  check('[非法] ' + label + ' 不抛异常', threw === null);
  check('[非法] ' + label + ' 不命中', hit === false);
  check('[非法] ' + label + ' check() 报错并有原因', c.ok === false && !!c.err);
});

check('空表达式 → check 报「为空」', E.check('').ok === false);
check('空表达式 → test 为 false', E.test('', ctx) === false);
check('合法表达式 check() → ok', E.check('rating >= 4').ok === true);

/* 11. 缓存：同一表达式编译结果复用 */
check('缓存：两次 compile 返回同一对象', E.compile('rating >= 4') === E.compile('rating >= 4'));

/* 12. probe() 调试接口（设置页测试器用） */
const p1 = E.probe('rating >= 4', ctx);
check('probe：合法表达式返回 ok + hit', p1.ok === true && p1.hit === true);
const p2 = E.probe('foo ~ 1', ctx);
check('probe：非法表达式返回 ok=false + 原因', p2.ok === false && !!p2.err && p2.hit === false);

/* 13. 单一实现守卫：content.js 里不得再长出第二份解析器 */
check('守卫：content.js 不含自己的词法/语法实现',
  !/function\s+exprTokens|function\s+exprParse\s*\(/.test(code));
check('守卫：content.js 通过 SF_EXPR 引用引擎', /SF_EXPR/.test(code));
check('守卫：options.html 也加载同一份 expr.js',
  /expr\.js/.test(fs.readFileSync(path.join(EXT, 'options.html'), 'utf8')));
check('守卫：manifest 先加载 expr.js 再加载 content.js', (function () {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const js = m.content_scripts[0].js;
  return js.indexOf('expr.js') !== -1 && js.indexOf('expr.js') < js.indexOf('content.js');
})());

/* ==================================================================
 * 第二部分：与 content.js 的接线（jsdom 走真实 content.js）
 * ================================================================== */
console.log('---- 与 content.js 接线 ----');

function card(c, opts) {
  opts = opts || {};
  const links = [];
  if (opts.star) links.push(`<a href="/star/1">${opts.star}</a>`);
  (opts.tags || []).forEach(tg => links.push(`<a href="/genre/${tg}">${tg}</a>`));
  if (opts.maker) links.push(`<a href="/studio/${opts.maker}">${opts.maker}</a>`);
  if (opts.series) links.push(`<a href="/series/${opts.series}">${opts.series}</a>`);
  return `<div class="item">
    <a class="movie-box" href="/${c}">
      <div class="photo-frame"><img src="x.jpg" alt="${c}"></div>
      <div class="photo-info">
        <span class="title">${opts.title || ('Title ' + c)}</span>
        ${links.join('')}
        ${opts.rating != null ? `<span class="rating">${opts.rating}</span>` : ''}
        ${opts.date ? `<span class="date">${opts.date}</span>` : ''}
      </div>
    </a>
  </div>`;
}

const BODY = '<div class="container">' + [
  card('ABC-001', { star: '明星甲', tags: ['巨乳', '高清'], maker: 'S1', series: '超高级', rating: 4.8, date: '2024-06-01' }),
  card('ABC-002', { star: '明星甲', tags: ['丝袜'], maker: 'Moodyz', rating: 2.1, date: '2019-01-01' }),
  card('ABC-003', { star: '新人乙', tags: ['高清', '丝袜'], maker: 'S1', rating: 4.6, date: '2023-03-01' }),
  card('ABC-004', { star: '路人丙', tags: [], rating: null, date: '' }),
].join('') + '</div>';

function build(rules, settings) {
  const dom = new JSDOM(`<!doctype html><html><body>${BODY}</body></html>`, {
    url: 'https://www.javbus.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 220, height: 320, top: 0, left: 0, right: 220, bottom: 320, x: 0, y: 0 };
  };
  const store = {
    sf_data_v1: {
      settings: Object.assign({
        enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
        showBall: true, pinHighlight: false, markSeen: false, favBtn: false,
        watchBtn: false, showWhy: false, blockDisplay: 'hide', previewMode: false,
        firstMatchWins: false, codeSearchBtns: false, keys: {},
        hlColor: '#00e5ff', ball: { right: 24, bottom: 24 }, onboarded: true,
      }, settings || {}),
      peeks: {}, sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
      rules: rules, groups: [], seen: {}, favCodes: {}, discovered: {},
      dailyRecs: [], recHistory: [], cooc: {}, errLog: [],
    },
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
  win.eval(bundle);
  return { win, store };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cardOf = (doc, wanted) => Array.from(doc.querySelectorAll('.item')).find(el => {
  const a = el.querySelector('a[href^="/ABC-"]');
  return a && a.getAttribute('href') === '/' + wanted;
});
const has = (el, cls) => !!(el && el.classList.contains(cls));

const RS = (extra) => Object.assign({
  id: 'r1', type: 'keyword', value: '', aliases: [], action: 'highlight',
  match: 'contains', scope: 'all', color: '#00e5ff', sites: [], enabled: true,
  hits: 0, createdAt: Date.now(), ratingMin: '', dateFrom: '', dateTo: '',
}, extra || {});

(async () => {
  /* 1. 表达式高亮 */
  {
    const { win } = build([RS({ expr: 'rating >= 4 && date >= 2023-01-01' })]);
    await sleep(600);
    const doc = win.document;
    check('[接线] 表达式命中：ABC-001（4.8 / 2024）高亮', has(cardOf(doc, 'ABC-001'), 'cf-hl'));
    check('[接线] 表达式命中：ABC-003（4.6 / 2023-03）高亮', has(cardOf(doc, 'ABC-003'), 'cf-hl'));
    check('[接线] 低分老片 ABC-002 不命中', !has(cardOf(doc, 'ABC-002'), 'cf-hl'));
    check('[接线] 无评分无日期 ABC-004 不命中', !has(cardOf(doc, 'ABC-004'), 'cf-hl'));
  }

  /* 2. 表达式屏蔽 */
  {
    const { win } = build([RS({ action: 'block', expr: 'tag ~ 丝袜' })]);
    await sleep(600);
    const doc = win.document;
    check('[接线] 表达式屏蔽：ABC-002（丝袜）被隐藏', has(cardOf(doc, 'ABC-002'), 'cf-blocked'));
    check('[接线] 表达式屏蔽：ABC-003（丝袜）被隐藏', has(cardOf(doc, 'ABC-003'), 'cf-blocked'));
    check('[接线] 无丝袜的 ABC-001 不受影响', !has(cardOf(doc, 'ABC-001'), 'cf-blocked'));
  }

  /* 3. expr 存在时忽略简单字段（避免两种条件互相打架） */
  {
    // value = 明星甲（会命中 001/002），但 expr 只要「巨乳」→ 只有 001 应当高亮
    const { win } = build([RS({ value: '明星甲', scope: 'all', expr: 'tag ~ 巨乳' })]);
    await sleep(600);
    const doc = win.document;
    check('[接线] 有 expr 时忽略 value：ABC-001 命中', has(cardOf(doc, 'ABC-001'), 'cf-hl'));
    check('[接线] 有 expr 时忽略 value：ABC-002 不被 value 带命中', !has(cardOf(doc, 'ABC-002'), 'cf-hl'));
  }

  /* 4. expr 与 firstMatchWins 配合 */
  {
    const rules = [
      RS({ id: 'r1', action: 'highlight', expr: 'maker ~ S1' }),
      RS({ id: 'r2', action: 'block', expr: 'maker ~ S1' }),
    ];
    const { win } = build(rules, { firstMatchWins: true });
    await sleep(600);
    const doc = win.document;
    const c = cardOf(doc, 'ABC-001');
    check('[接线] 首个命中：expr 高亮在先 → 不隐藏', has(c, 'cf-hl') && !has(c, 'cf-blocked'));
  }
  {
    const rules = [
      RS({ id: 'r1', action: 'block', expr: 'maker ~ S1' }),
      RS({ id: 'r2', action: 'highlight', expr: 'maker ~ S1' }),
    ];
    const { win } = build(rules, { firstMatchWins: true });
    await sleep(600);
    const doc = win.document;
    const c = cardOf(doc, 'ABC-001');
    check('[接线] 首个命中：expr 屏蔽在先 → 隐藏', has(c, 'cf-blocked') && !has(c, 'cf-hl'));
  }

  /* 5. 写坏的表达式：不崩溃、不命中、记错误日志 */
  {
    const { win, store } = build([RS({ expr: '(rating >= 4' })]);
    await sleep(600);
    const doc = win.document;
    check('[容错] 坏表达式不抛异常且不误伤任何卡片',
      !has(cardOf(doc, 'ABC-001'), 'cf-hl') && !has(cardOf(doc, 'ABC-002'), 'cf-blocked') && !has(cardOf(doc, 'ABC-004'), 'cf-hl'));
    // content.js 的错误日志是「攒 5 秒落盘一次」（避免每张卡片都写一次 storage），
    // 所以这里必须等过防抖窗口才能看到持久化结果。等不到 ≠ 没记录。
    await sleep(5200);
    const errs = (store.sf_data_v1 && store.sf_data_v1.errLog) || [];
    check('[容错] 坏表达式写入错误日志（含原因）',
      errs.some(e => /expr/.test(String(e.w)) && /右括号/.test(String(e.m))));
  }

  /* 6. 空 expr 不影响简单模式（向后兼容） */
  {
    const { win } = build([RS({ value: '巨乳', scope: 'all', expr: '' })]);
    await sleep(600);
    const doc = win.document;
    check('[兼容] expr 为空 → 退回关键词匹配：ABC-001 命中', has(cardOf(doc, 'ABC-001'), 'cf-hl'));
  }
  {
    // 完全不写 expr 字段（老数据）
    const r = RS({ value: '巨乳', scope: 'all' });
    delete r.expr;
    const { win } = build([r]);
    await sleep(600);
    const doc = win.document;
    check('[兼容] 老规则（无 expr 字段）依旧生效', has(cardOf(doc, 'ABC-001'), 'cf-hl'));
  }

  console.log(pass ? '\n条件表达式测试全部通过 ✅' : '\n条件表达式测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
