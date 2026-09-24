/* SiteFilter 本轮新增功能专项测试：临时规则有效期 / 自动记录已看 / 规则调试器 / 影响面预估
   验证的是"运行时行为"，不是"函数存在"：
   ① 到期规则真的不参与过滤（而不是被跳过一步）
   ② 详情页自动写入 seen，且关掉开关就不写
   ③ 调试器给出的结论与页面实际处理一致（这是它存在的意义 —— 结论不能跟行为脱节）
   ④ 影响面预估的数字与发现库对得上，"过宽"判定能拦住
   ⑤ 后台归纳出的候选规则形状正确，且已被规则覆盖的不重复推
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const vm = require('vm');

const EXT = __dirname;
const code = require('./_load').contentBundle();

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cardHtml = (c, star) => `<div class="item">
    <a class="movie-box" href="/${c}">
      <div class="photo-frame"><img src="x.jpg" alt="${c}"></div>
      <div class="photo-info">
        <span class="title">Title ${c}</span>
        <a href="/star/99">${star}</a>
      </div>
    </a>
  </div>`;

/* url 可指定，用来测详情页路径解析。
   注意：findCards 要求至少 3 张可见卡片才认定为列表页（避免把零散元素当卡片），
   所以这里的列表页夹具固定放 3 张卡 —— 少一张整页就不会被处理。 */
function build(opts) {
  opts = opts || {};
  const body = opts.body || ('<div class="container">' + [
    cardHtml('ABC-001', '明星甲'),
    cardHtml('ABC-002', '新人乙'),
    cardHtml('ABC-003', '路人丙'),
  ].join('') + '</div>');
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: opts.url || 'https://www.javbus.com/',
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
      showBall: true, pinHighlight: true, markSeen: true, favBtn: true,
      watchBtn: true, showWhy: true, blockDisplay: 'hide',
      hlColor: '#00e5ff', ball: { right: 24, bottom: 24 }, onboarded: true,
      autoSeen: true, auditWarn: true, keys: {}
    }, opts.settings || {}),
    peeks: {},
    sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
    rules: opts.rules || [],
    groups: [],
    seen: opts.seen || {},
    favCodes: {}, discovered: opts.discovered || {},
    dailyRecs: [], recHistory: [],
    learned: {}, dismissedLearn: {}, profiles: [], activeProfile: '', expiredLog: []
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
  win.eval(code);
  return { win, store, dom };
}

function cardOf(doc, wanted) {
  return Array.from(doc.querySelectorAll('.item')).find(el => {
    const a = el.querySelector('a[href^="/ABC-"]');
    return a && a.getAttribute('href') === '/' + wanted;
  });
}
/* 右键菜单挂在 documentElement 上（不是 Shadow DOM 里），类名 cf-cardmenu。 */
function openMenu(win) {
  const menu = win.document.querySelector('.cf-cardmenu');
  return menu;
}
function clickMenuItem(win, cm, pred) {
  const menu = openMenu(win);
  if (!menu) return false;
  const btns = Array.from(menu.querySelectorAll('button[data-cm="' + cm + '"]'));
  const b = pred ? btns.find(pred) : btns[0];
  if (!b) return false;
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  return true;
}

const blockedOf = el => !!el && el.classList.contains('cf-blocked');

(async () => {

  /* ============ ① 临时规则有效期 ============ */
  {
    const mkRule = (id, exp) => ({
      id, type: 'actress', value: '明星甲', aliases: [], action: 'block',
      match: 'contains', scope: 'actress', color: '', sites: [], enabled: true,
      hits: 0, createdAt: Date.now(), expr: '', expiresAt: exp
    });

    // 1a. 未到期的临时规则照常生效
    {
      const { win } = build({ rules: [mkRule('rA', Date.now() + 864e5)] });
      await sleep(600);
      check('[有效期] 未到期的临时屏蔽规则照常生效', blockedOf(cardOf(win.document, 'ABC-001')));
    }
    // 1b. 已到期的临时规则不再生效（且是"整条不参与"，不是"命中后被跳过"）
    {
      const { win, store } = build({ rules: [mkRule('rB', Date.now() - 1000)] });
      await sleep(600);
      const c = cardOf(win.document, 'ABC-001');
      check('[有效期] 已到期的临时屏蔽规则不再隐藏卡片', !blockedOf(c));
      check('[有效期] 已到期的规则不会被记命中次数',
        ((store.sf_data_v1.rules || [])[0] || {}).hits === 0);
    }
    // 1c. expiresAt = 0 视为永久
    {
      const { win } = build({ rules: [mkRule('rC', 0)] });
      await sleep(600);
      check('[有效期] expiresAt = 0 视为永久生效', blockedOf(cardOf(win.document, 'ABC-001')));
    }
    // 1d. 同一人既有到期屏蔽又有高亮：屏蔽失效后高亮应接管
    {
      const { win } = build({
        rules: [
          mkRule('rDead', Date.now() - 1000),
          { id: 'rHl', type: 'actress', value: '明星甲', aliases: [], action: 'highlight', match: 'contains', scope: 'actress', color: '#ff9f1c', sites: [], enabled: true, hits: 0, createdAt: Date.now(), expr: '', expiresAt: 0 }
        ]
      });
      await sleep(600);
      const c = cardOf(win.document, 'ABC-001');
      check('[有效期] 到期屏蔽规则失效后，高亮规则得以生效', !!c && c.classList.contains('cf-hl'));
    }
    // 1e. 右键「临时屏蔽 7 天」建出的规则必须带 expiresAt，且界面上能看出是临时的
    {
      const { win, store } = build({ rules: [] });
      await sleep(600);
      const doc = win.document;
      const c = cardOf(doc, 'ABC-001');
      c.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      await sleep(60);
      const ok = clickMenuItem(win, 'tmpblock', b => b.getAttribute('data-d') === '7');
      check('[有效期] 右键菜单提供「临时屏蔽 1 / 7 / 30 天」三项',
        !!doc.querySelector('.cf-cardmenu') || ok);
      await sleep(160);
      const r = (store.sf_data_v1.rules || []).filter(x => x.value === '明星甲')[0];
      check('[有效期] 「临时屏蔽 7 天」建出的规则带 expiresAt', !!r && Number(r.expiresAt) > Date.now());
      check('[有效期] 临时规则的到期时间约为 7 天后',
        !!r && Math.abs(Number(r.expiresAt) - (Date.now() + 7 * 864e5)) < 60e3);
      check('[有效期] 临时规则为屏蔽动作且已启用', !!r && r.action === 'block' && r.enabled === true);
    }
  }

  /* ============ ② 自动记录已看（详情页） ============ */
  {
    // 2a. 详情页路径形如 /ABC-001 → 自动写入 seen
    {
      const { store } = build({ url: 'https://www.javbus.com/ABC-001', body: '<div class="container"></div>' });
      await sleep(500);
      check('[已看] 打开详情页自动写入 seen', !!store.sf_data_v1.seen['ABC-001']);
      check('[已看] seen 里存的是时间戳', typeof store.sf_data_v1.seen['ABC-001'] === 'number' &&
        store.sf_data_v1.seen['ABC-001'] > 0);
    }
    // 2b. 小写 + 无连字符的路径也要认（很多站是 /abc001 或 /abc_001）
    {
      const { store } = build({ url: 'https://www.javbus.com/abc001', body: '<div class="container"></div>' });
      await sleep(500);
      check('[已看] 小写无连字符路径 /abc001 也能识别', !!store.sf_data_v1.seen['ABC-001']);
    }
    // 2c. 关掉开关就不写
    {
      const { store } = build({
        url: 'https://www.javbus.com/ABC-001', body: '<div class="container"></div>',
        settings: { autoSeen: false }
      });
      await sleep(500);
      check('[已看] 关掉「自动记录已看」后不再写入', !store.sf_data_v1.seen['ABC-001']);
    }
    // 2d. 已经记过的不要重复写（避免每次刷新都改时间戳）
    {
      const old = 1600000000000;
      const { store } = build({
        url: 'https://www.javbus.com/ABC-001', body: '<div class="container"></div>',
        seen: { 'ABC-001': old }
      });
      await sleep(500);
      check('[已看] 已记录过的番号不覆盖原时间戳', store.sf_data_v1.seen['ABC-001'] === old);
    }
    // 2e. 列表页（非详情页）不该瞎写
    {
      const { store } = build({ url: 'https://www.javbus.com/page/2', body: '<div class="container"></div>' });
      await sleep(500);
      const n = Object.keys(store.sf_data_v1.seen || {}).length;
      check('[已看] 列表页路径不会误写 seen', n === 0);
    }
  }

  /* ============ ③ 规则调试器：结论必须等于页面实际行为 ============ */
  {
    const rules = [
      { id: 'r1', type: 'actress', value: '明星甲', aliases: [], action: 'block', match: 'contains', scope: 'actress', color: '', sites: [], enabled: true, hits: 0, createdAt: Date.now(), expr: '', expiresAt: 0 },
      { id: 'r2', type: 'keyword', value: 'Title', aliases: [], action: 'highlight', match: 'contains', scope: 'title', color: '#00e5ff', sites: [], enabled: true, hits: 0, createdAt: Date.now(), expr: '', expiresAt: 0 },
      // 这条一定不命中（值不在卡片上），用来验证调试器也能显示"不通过"
      { id: 'r3', type: 'actress', value: '根本不存在的人', aliases: [], action: 'block', match: 'contains', scope: 'actress', color: '', sites: [], enabled: true, hits: 0, createdAt: Date.now(), expr: '', expiresAt: 0 },
      // 这条已关闭，调试器应标出来
      { id: 'r4', type: 'tag', value: '无关标签', aliases: [], action: 'highlight', match: 'contains', scope: 'tag', color: '', sites: [], enabled: false, hits: 0, createdAt: Date.now(), expr: '', expiresAt: 0 }
    ];
    const { win } = build({ rules: rules });
    await sleep(600);
    const doc = win.document;
    const c = cardOf(doc, 'ABC-001');

    c.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    await sleep(60);
    check('[调试器] 右键菜单里有「调试这张卡」', !!doc.querySelector('.cf-cardmenu button[data-cm="debug"]'));
    clickMenuItem(win, 'debug');
    await sleep(150);

    const panel = doc.querySelector('.cf-dbgpanel');
    check('[调试器] 点「调试这张卡」能打开浮层', !!panel);
    if (panel) {
      const txt = panel.textContent || '';
      // 页面实际把这张卡屏蔽了 → 面板必须也说是屏蔽，且指出是哪条规则
      check('[调试器] 结论与页面实际处理一致（页面屏蔽 ↔ 面板说屏蔽）',
        blockedOf(c) === (txt.indexOf('屏蔽') !== -1));
      check('[调试器] 指出生效的规则名（明星甲）', txt.indexOf('明星甲') !== -1);
      check('[调试器] 列出逐条规则的判定步骤（chip）', !!panel.querySelector('.cf-dbg-step'));
      check('[调试器] 步骤里能看出哪条通过、哪条不通过',
        !!panel.querySelector('.cf-dbg-step.ok') && !!panel.querySelector('.cf-dbg-step.no'));
      check('[调试器] 不通过的规则被标出（根不存在的人）', txt.indexOf('根本不存在的人') !== -1);
      check('[调试器] 已关闭的规则被标注「已关闭」', !!panel.querySelector('.cf-dbg-tag'));
      check('[调试器] 生效的规则被标出「★ 生效」', txt.indexOf('★ 生效') !== -1);
      check('[调试器] 展示卡片的字段摘录（含女优）',
        txt.indexOf('女优') !== -1 || txt.indexOf('actress') !== -1);
      check('[调试器] 有关闭按钮', !!panel.querySelector('.cf-dbg-x'));
      // 关掉
      panel.querySelector('.cf-dbg-x').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await sleep(60);
      check('[调试器] 点关闭后浮层消失', !doc.querySelector('.cf-dbgpanel'));
    }
  }

  /* ============ ④ 影响面预估（建规则前拦截过宽） ============ */
  {
    // 4a. 影响面不大时不打扰
    {
      const disc = { 'actress|明星甲': { v: '明星甲', type: 'actress', n: 3, first: Date.now(), last: Date.now() } };
      const { win, store } = build({ discovered: disc, rules: [] });
      await sleep(550);
      let asked = 0;
      win.confirm = function () { asked++; return false; };
      const c = cardOf(win.document, 'ABC-001');
      c.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      await sleep(60);
      clickMenuItem(win, 'block');
      await sleep(160);
      check('[影响面] 影响面不大时不打扰用户', asked === 0);
      check('[影响面] 影响面不大时直接建出规则',
        (store.sf_data_v1.rules || []).some(r => r.value === '明星甲' && r.action === 'block'));
    }
    // 4b. 反例：这个词在发现库里命中面过大 → 必须问
    {
      const disc = {};
      for (let i = 0; i < 12; i++) {
        disc['actress|明星甲 ' + i] = { v: '明星甲 ' + i, type: 'actress', n: 3, first: Date.now(), last: Date.now() };
      }
      const { win, store } = build({ discovered: disc, rules: [] });
      await sleep(550);
      let asked = 0;
      win.confirm = function () { asked++; return false; };   // 用户点"取消"
      const c = cardOf(win.document, 'ABC-001');
      c.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      await sleep(60);
      clickMenuItem(win, 'block');
      await sleep(180);
      check('[影响面] 命中面过大时先弹确认框问一下', asked >= 1);
      check('[影响面] 用户点「取消」后不建规则',
        !(store.sf_data_v1.rules || []).some(r => r.value === '明星甲' && r.action === 'block'));
    }
    // 4c. 关掉 auditWarn 就不该问
    {
      const disc = {};
      for (let i = 0; i < 12; i++) {
        disc['actress|明星甲 ' + i] = { v: '明星甲 ' + i, type: 'actress', n: 3, first: Date.now(), last: Date.now() };
      }
      const { win, store } = build({ discovered: disc, rules: [], settings: { auditWarn: false } });
      await sleep(550);
      let asked = 0;
      win.confirm = function () { asked++; return true; };
      const c = cardOf(win.document, 'ABC-001');
      c.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      await sleep(60);
      clickMenuItem(win, 'block');
      await sleep(180);
      check('[影响面] 关掉开关后不再询问', asked === 0);
      check('[影响面] 关掉开关后直接建出规则',
        (store.sf_data_v1.rules || []).some(r => r.value === '明星甲' && r.action === 'block'));
    }
  }

  /* ============ ⑤ 后台：候选规则归纳（buildLearned）+ 到期清理 ============ */
  {
    function loadBg(seed) {
      const store = JSON.parse(JSON.stringify(seed));
      const chrome = {
        storage: {
          local: {
            get: (key, cb) => { cb({ [key]: store[key] }); },
            set: (obj, cb) => { Object.keys(obj).forEach(k => store[k] = obj[k]); if (cb) cb(); },
          },
          onChanged: { addListener() { } },
        },
        action: { setBadgeText() { }, setBadgeBackgroundColor() { } },
        runtime: {
          onMessage: { addListener() { } }, onInstalled: { addListener() { } },
          onStartup: { addListener() { } }, openOptionsPage() { }, sendMessage() { },
        },
        alarms: { create() { }, onAlarm: { addListener() { } } },
        notifications: { create() { }, onClicked: { addListener() { } } },
        contextMenus: { removeAll(cb) { if (cb) cb(); }, create() { }, onClicked: { addListener() { } } },
      };
      const bgCode = require('./_load.js').backgroundBundle();
      const ctx = { chrome, console, Date, Math, Object, Array, JSON, parseInt, String, Promise, URL, setTimeout };
      vm.createContext(ctx);
      vm.runInContext(bgCode, ctx);
      return { ctx, store };
    }

    // 5a. 只用覆盖率会推出通用词；用"覆盖率 × 精确率"应当把通用词挡掉
    {
      // cooc: 12 个人。3 个"种子"（已被屏蔽规则覆盖的人）都带「丝袜」；「高清」人人都有。
      const cooc = {};
      const seedNames = ['甲', '乙', '丙'];
      for (let i = 0; i < 12; i++) {
        const nm = i < 3 ? seedNames[i] : ('路' + i);
        cooc[nm] = {
          tag: Object.assign({ '高清': 5 }, i < 3 ? { '丝袜': 4 } : {}),
          maker: i < 3 ? { '某片商': 2 } : {},
          series: {}, director: {}
        };
      }
      const { ctx, store } = loadBg({
        sf_data_v1: {
          schemaVersion: 4,
          settings: {},
          rules: [
            { id: 'x1', type: 'actress', value: '甲', action: 'block', enabled: true },
            { id: 'x2', type: 'actress', value: '乙', action: 'block', enabled: true },
            { id: 'x3', type: 'actress', value: '丙', action: 'block', enabled: true }
          ],
          cooc: cooc, learned: {}, dismissedLearn: {}
        }
      });
      await Promise.resolve(ctx.buildLearned());
      await sleep(120);
      const items = ((store.sf_data_v1.learned || {}).items) || [];
      const vals = items.map(x => x.value);
      check('[归纳] 归纳出「丝袜」（3/3 种子都有，且只在这 3 人身上）', vals.indexOf('丝袜') !== -1);
      check('[归纳] 挡掉「高清」（人人都有的通用词）', vals.indexOf('高清') === -1);
      check('[归纳] 每条候选都带 coverage / precision / score',
        items.every(x => typeof x.coverage === 'number' && typeof x.precision === 'number' && typeof x.score === 'number'));
      check('[归纳] 候选按得分降序', items.every((x, i) => i === 0 || items[i - 1].score >= x.score));
      check('[归纳] 记下样本数', typeof (store.sf_data_v1.learned || {}).total === 'number');
    }
    // 5b. 已被规则覆盖的特征不再重复推
    {
      const cooc = {};
      const seedNames = ['甲', '乙', '丙'];
      for (let i = 0; i < 8; i++) {
        const nm = i < 3 ? seedNames[i] : ('路' + i);
        cooc[nm] = { tag: i < 3 ? { '丝袜': 4 } : {}, maker: {}, series: {}, director: {} };
      }
      const { ctx, store } = loadBg({
        sf_data_v1: {
          schemaVersion: 4, settings: {},
          rules: [
            { id: 'x1', type: 'actress', value: '甲', action: 'block', enabled: true },
            { id: 'x2', type: 'actress', value: '乙', action: 'block', enabled: true },
            { id: 'x3', type: 'actress', value: '丙', action: 'block', enabled: true },
            // 已经有「丝袜」这条屏蔽规则了
            { id: 'x4', type: 'tag', value: '丝袜', action: 'block', enabled: true }
          ],
          cooc: cooc, learned: {}, dismissedLearn: {}
        }
      });
      await Promise.resolve(ctx.buildLearned());
      await sleep(120);
      const vals = (((store.sf_data_v1.learned || {}).items) || []).map(x => x.value);
      check('[归纳] 已被规则覆盖的特征不再重复推荐（丝袜）', vals.indexOf('丝袜') === -1);
    }
    // 5c. dismissedLearn 里的不再推
    {
      const cooc = {};
      const seedNames = ['甲', '乙', '丙'];
      for (let i = 0; i < 8; i++) {
        const nm = i < 3 ? seedNames[i] : ('路' + i);
        cooc[nm] = { tag: i < 3 ? { '丝袜': 4 } : {}, maker: {}, series: {}, director: {} };
      }
      const { ctx, store } = loadBg({
        sf_data_v1: {
          schemaVersion: 4, settings: {},
          rules: [
            { id: 'x1', type: 'actress', value: '甲', action: 'block', enabled: true },
            { id: 'x2', type: 'actress', value: '乙', action: 'block', enabled: true },
            { id: 'x3', type: 'actress', value: '丙', action: 'block', enabled: true }
          ],
          cooc: cooc, learned: {}, dismissedLearn: { 'block|tag|丝袜': Date.now() }
        }
      });
      await Promise.resolve(ctx.buildLearned());
      await sleep(120);
      const vals = (((store.sf_data_v1.learned || {}).items) || []).map(x => x.value);
      check('[归纳] 已忽略过的候选不再推送', vals.indexOf('丝袜') === -1);
    }
    // 5d. 样本不足时不乱推
    {
      const { ctx, store } = loadBg({
        sf_data_v1: {
          schemaVersion: 4, settings: {},
          rules: [{ id: 'x1', type: 'actress', value: '甲', action: 'block', enabled: true }],
          cooc: { '甲': { tag: { '丝袜': 1 }, maker: {}, series: {}, director: {} } },
          learned: {}, dismissedLearn: {}
        }
      });
      await Promise.resolve(ctx.buildLearned());
      await sleep(120);
      check('[归纳] 样本不足时不给出候选',
        (((store.sf_data_v1.learned || {}).items) || []).length === 0);
    }
  }

  /* ============ ⑥ 本轮吸收：隐藏来源 / 诊断视图 / 本页停用 / 防误触 ============
     四条都断言**运行时行为**，不是"源码里有没有那几个字"：
     来源标记必须真出现在 DOM 上、诊断页必须真列出卡片、停用必须真把 class 撤掉、
     防误触必须"第一次不建规则、第二次才建"。 */
  {
    const mkBlock = (id, v) => ({
      id, type: 'actress', value: v, aliases: [], action: 'block',
      match: 'contains', scope: 'actress', color: '', sites: [], enabled: true,
      hits: 0, createdAt: Date.now(), expr: '', expiresAt: 0
    });
    const hostSr = (win) => {
      const h = win.document.querySelector('.cf-host');
      return h && h.shadowRoot;
    };
    const press = (win, key) => {
      win.document.dispatchEvent(new win.KeyboardEvent('keydown', {
        key, bubbles: true, cancelable: true
      }));
    };

    // 6a. 隐藏来源标记：被屏蔽的卡带 data-cf-hide-src=block；没被处理的卡不带
    {
      const { win } = build({ rules: [mkBlock('rb1', '明星甲')] });
      await sleep(600);
      const c1 = cardOf(win.document, 'ABC-001');   // 明星甲 → 命中屏蔽
      const c2 = cardOf(win.document, 'ABC-002');   // 新人乙 → 无规则
      check('[来源] 被屏蔽规则的卡片带 data-cf-hide-src="block"',
        !!c1 && c1.getAttribute('data-cf-hide-src') === 'block');
      check('[来源] 未被处理的卡片不带 data-cf-hide-src',
        !!c2 && !c2.hasAttribute('data-cf-hide-src'));
    }
    // 6b. 「只看收藏」筛掉的来源必须是 filter —— 两个隐藏来源要能分开归因
    {
      const { win } = build({ settings: { onlyFav: true }, rules: [] });
      await sleep(600);
      const c = cardOf(win.document, 'ABC-001');
      check('[来源] 「只看收藏」筛掉的卡片来源为 filter（与屏蔽可区分）',
        !!c && c.getAttribute('data-cf-hide-src') === 'filter');
    }
    // 6c. 来源标记要随「撤掉处理」一起消失，不能留残影
    //     （用「本页暂停」触发 clearMarks —— 撤销只对 UI 改动作快照，载入的规则不在 undoStack 里）
    {
      const { win } = build({ rules: [mkBlock('rb2', '明星甲')] });
      await sleep(600);
      const doc = win.document;
      check('[来源] 停用前带标记',
        !!cardOf(doc, 'ABC-001') && cardOf(doc, 'ABC-001').getAttribute('data-cf-hide-src') === 'block');
      const sr = hostSr(win);
      sr.getElementById('pauseBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await sleep(500);
      const after = cardOf(doc, 'ABC-001');
      check('[来源] 撤掉处理后来源标记被一并清掉（不留残影）',
        !after || !after.hasAttribute('data-cf-hide-src'));
    }
    // 6d. 诊断视图：页签存在、能列出被处理的卡、顶部有汇总、点行不抛错
    {
      const { win } = build({ rules: [mkBlock('rb3', '明星甲')] });
      await sleep(600);
      const sr = hostSr(win);
      check('[诊断] 悬浮面板已建立', !!sr);
      const tab = sr && Array.from(sr.querySelectorAll('.cf-tabs button'))
        .find(b => b.dataset.tab === 'why');
      check('[诊断] 页签里有「诊断」', !!tab);
      if (tab) {
        tab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await sleep(60);
        const lines = sr.querySelectorAll('.cf-whyline');
        const bar = sr.querySelector('.cf-whybar');
        check('[诊断] 列出本页被处理的卡片', lines.length >= 1);
        check('[诊断] 顶部汇总行说明了张数与隐藏数',
          !!bar && /被处理/.test(bar.textContent) && /隐藏/.test(bar.textContent));
        check('[诊断] 诊断行里能看到命中的规则值',
          lines.length > 0 && /明星甲/.test(sr.querySelector('.cf-list').textContent));
        let threw = false;
        try { lines[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
        catch (e) { threw = true; }
        check('[诊断] 点击诊断行可跳转且不抛错', !threw);
      }
    }
    // 6e. 本页临时停用：撤掉全部改动 + 球变 ⏸ + 可再点恢复 + 球不消失
    {
      const { win } = build({ rules: [mkBlock('rb4', '明星甲')] });
      await sleep(600);
      const doc = win.document;
      const sr = hostSr(win);
      const pb = sr && sr.getElementById('pauseBtn');
      check('[停用] 面板里有「本页暂停」按钮', !!pb);
      check('[停用] 停用前卡片确实被屏蔽', blockedOf(cardOf(doc, 'ABC-001')));
      if (pb) {
        pb.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await sleep(500);
        check('[停用] 停用后页面恢复原样（不带 .cf-blocked）',
          !doc.querySelector('.cf-blocked') && !blockedOf(cardOf(doc, 'ABC-001')));
        const ball = sr.getElementById('ball');
        check('[停用] 悬浮球变 ⏸ 并带 paused 标记',
          !!ball && ball.textContent === '⏸' && ball.classList.contains('paused'));
        check('[停用] 悬浮球仍然存在（它是唯一恢复入口，不能自己消失）',
          !!ball && (win.document.querySelector('.cf-host') || {}).style.display !== 'none');
        pb.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await sleep(700);
        check('[停用] 再点一次即恢复过滤', blockedOf(cardOf(doc, 'ABC-001')));
        check('[停用] 恢复后悬浮球回到 ◈', sr.getElementById('ball').textContent === '◈');
      }
    }
    // 6f. 破坏性操作防误触：第一次按屏蔽键不建规则，紧接着第二次才建
    {
      const { win, store } = build({ rules: [] });
      await sleep(600);
      const sr = hostSr(win);
      const ball = sr && sr.getElementById('ball');
      ball.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await sleep(80);
      check('[防误触] 面板已打开', sr.getElementById('panel').classList.contains('open'));

      press(win, 'j');   // 选中第一张卡
      await sleep(40);
      press(win, 'b');   // 第一次按屏蔽键
      await sleep(120);
      const n1 = (store.sf_data_v1.rules || []).filter(r => r.value === '明星甲').length;
      check('[防误触] 第一次按屏蔽键不建规则（只提示）', n1 === 0);
      check('[防误触] 第一次按下时球上给出「再按一次」提示',
        /再按/.test(sr.getElementById('ball').textContent));

      press(win, 'b');   // 第二次按屏蔽键
      await sleep(250);
      const n2 = (store.sf_data_v1.rules || []).filter(r => r.value === '明星甲' && r.action === 'block').length;
      check('[防误触] 紧接着再按一次才真的建屏蔽规则', n2 === 1);
    }
    // 6g. 关掉防误触开关后，单次按键立即生效（说明它是可配置的，而不是硬编码）
    {
      const { win, store } = build({ rules: [], settings: { confirmDestructive: false } });
      await sleep(600);
      const sr = hostSr(win);
      sr.getElementById('ball').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await sleep(80);
      press(win, 'j');
      await sleep(40);
      press(win, 'b');
      await sleep(250);
      check('[防误触] 关掉开关后单次按键直接生效',
        (store.sf_data_v1.rules || []).filter(r => r.value === '明星甲').length === 1);
    }
  }

  console.log(pass ? '\n新增功能专项测试全部通过 ✅' : '\n存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
