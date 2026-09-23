/* SiteFilter 屏蔽显示方式专项测试（v6 起为三档 blockDisplay）
   验证：命中屏蔽规则后，'hide'（完全隐藏）/ 'placeholder'（保留占位，默认）/ 'soft'（灰化遮罩 + 临时放行）
   三档的确定性行为，以及 old→new 的 softBlock 迁移兼容。
   说明：jsdom 对 Shadow DOM 内交互控件的 .click() 激活语义不稳定（附加监听器后会失效），
   因此这里不走 UI 点击，而是直接把 blockDisplay 注入 settings（等价于用户已选定），
   只验证运行时行为；控件本身是否接线由 _smoke.js / _test_options.js 断言。

   重点覆盖「取消屏蔽后卡片能不能恢复可见」—— .cf-placeholder 用的 visibility:hidden
   同样会让 findCards() 的 getBoundingClientRect 判定失效，一旦漏进 clearMarks/resetPassMarks
   的两份类名清单，卡片就会永久不可见（.cf-blocked 曾踩过这个坑，见 content.js:1198）。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = 'C:\\Users\\admin\\Desktop\\site-filter';
const code = require('./_load').contentBundle();

const cardHtml = (c, star) => `<div class="item">
    <a class="movie-box" href="/${c}">
      <div class="photo-frame"><img src="x.jpg" alt="${c}"></div>
      <div class="photo-info">
        <span class="title">Title ${c}</span>
        <a href="/star/99">${star}</a>
      </div>
    </a>
  </div>`;

const BODY = '<div class="container">' + [
  cardHtml('ABC-001', '明星甲'),   // 命中屏蔽
  cardHtml('ABC-002', '明星甲'),   // 命中屏蔽（验证按番号放行互不影响）
  cardHtml('ABC-003', '新人乙'),   // 不命中
].join('') + '</div>';

/* build(blockDisplay, extra)
   blockDisplay 为三档字符串；传入 legacySoftBlock 则写旧字段，走迁移路径。 */
function build(blockDisplay, extra) {
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
    // 注意：不写 schemaVersion ⇒ 等价 v1，会一路迁移到当前版本。
    // blockDisplay 已在 settings 里时，step 6 的 `if (!x.settings.blockDisplay)` 会跳过，
    // 从而原样保留测试注入的档位（这正是我们想要的确定性）。
    settings: {
      enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
      showBall: true, pinHighlight: true, markSeen: true, favBtn: true,
      watchBtn: true, showWhy: true,
      hlColor: '#00e5ff', ball: { right: 24, bottom: 24 }, onboarded: true,
    },
    peeks: extra.peeks || {},
    sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
    rules: [{
      id: 'r1', type: 'actress', value: '明星甲', aliases: [], action: 'block',
      match: 'contains', scope: 'actress', color: '', sites: [], enabled: true,
      hits: 0, createdAt: Date.now(),
    }],
    groups: [], seen: {}, favCodes: {}, discovered: {}, dailyRecs: [], recHistory: [],
  };
  if (blockDisplay != null) store['sf_data_v1'].settings.blockDisplay = blockDisplay;
  if (extra.legacySoftBlock != null) store['sf_data_v1'].settings.softBlock = extra.legacySoftBlock;
  if (extra.noRules) store['sf_data_v1'].rules = [];   // 验证「无屏蔽时揭示按钮不出现」
  // 允许测试注入 settings 覆盖（用于预览模式 / 放行时长场景）
  Object.assign(store['sf_data_v1'].settings, extra.settings || {});
  win.chrome = {
    storage: {
      local: {
        get(k, cb) {
          const o = {};
          if (typeof k === 'string') o[k] = store[k];
          else Object.keys(k).forEach(x => { o[x] = store[k]; });
          cb(o);
        },
        set(o, cb) { Object.assign(store, o); if (cb) cb(); },
      },
      // 捕获 content.js 注册的 storage 变更回调 —— 测试里用它模拟「用户在设置页删了规则」，
      // 这是验证「撤销屏蔽后卡片能否恢复可见」最贴近真实路径的手法。
      onChanged: { addListener(fn) { win.__onChanged = fn; } },
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
function stateOf(el) {
  return {
    soft: el.classList.contains('cf-soft'),
    blocked: el.classList.contains('cf-blocked'),
    placeholder: el.classList.contains('cf-placeholder'),
    peek: el.classList.contains('cf-peek'),
    btn: !!el.querySelector(':scope > .cf-peekbtn'),
  };
}

(async () => {
  /* ================= 阶段一：blockDisplay = 'soft' ================= */
  {
    const { win, store } = build('soft');
    await sleep(600);
    const doc = win.document;
    const host = doc.querySelector('.cf-host');
    const sr = host && host.shadowRoot;

    const a = stateOf(cardOf(doc, 'ABC-001'));
    const b = stateOf(cardOf(doc, 'ABC-002'));
    const c = stateOf(cardOf(doc, 'ABC-003'));

    check('[软] 命中屏蔽的 ABC-001 走软屏蔽（cf-soft）', a.soft);
    check('[软] 命中屏蔽的 ABC-002 走软屏蔽（cf-soft）', b.soft);
    check('[软] 软屏蔽不直接隐藏（不带 cf-blocked）', !a.blocked);
    check('[软] 软屏蔽不挂占位类', !a.placeholder);
    check('[软] 软屏蔽卡片注入「仍然查看」按钮', a.btn);
    check('[软] 未命中规则的 ABC-003 不受影响', !c.soft && !c.blocked && !c.btn);
    check('[软] 统计条出现软屏蔽计数',
      !!(sr && sr.getElementById('stats') && /软/.test(sr.getElementById('stats').textContent)));

    // 点「仍然查看」→ 该番号临时放行
    const c1 = cardOf(doc, 'ABC-001');
    const btn = c1.querySelector(':scope > .cf-peekbtn');
    check('[放行] 「仍然查看」按钮可点击', !!btn);
    if (btn) btn.click();
    await sleep(600);

    const a2 = stateOf(c1);
    check('[放行] 已写入 peeks["ABC-001"]',
      !!(store['sf_data_v1'].peeks && store['sf_data_v1'].peeks['ABC-001']));
    check('[放行] 放行后卡片不再带 cf-soft', !a2.soft);
    check('[放行] 放行后卡片带 cf-peek（标识手动放行）', a2.peek);
    check('[放行] 放行后「仍然查看」按钮已移除', !a2.btn);

    const b2 = stateOf(cardOf(doc, 'ABC-002'));
    check('[放行] 按番号生效：ABC-002 仍为软屏蔽', b2.soft);
    console.log('      peeks =', JSON.stringify(store['sf_data_v1'].peeks || {}));
  }

  /* ================= 阶段二：blockDisplay = 'hide'（完全隐藏） ================= */
  {
    const { win } = build('hide');
    await sleep(600);
    const doc = win.document;
    const a = stateOf(cardOf(doc, 'ABC-001'));
    check('[隐藏] 走 cf-blocked（display:none 完全隐藏）', a.blocked);
    check('[隐藏] 不出现 cf-soft', !a.soft);
    check('[隐藏] 不挂 cf-placeholder（要的就是重排）', !a.placeholder);
    check('[隐藏] 不注入「仍然查看」按钮', !a.btn);
  }

  /* ================= 阶段三：blockDisplay = 'placeholder'（保留占位，v6 默认档） ================= */
  {
    const { win, store } = build('placeholder');
    await sleep(600);
    const doc = win.document;
    const raw = cardOf(doc, 'ABC-001');
    const a = stateOf(raw);
    check('[占位] 仍带 cf-blocked（下游统计 / 调试器读这个类，不能丢）', a.blocked);
    check('[占位] 同时挂 cf-placeholder（把 display:none 换成 visibility:hidden）', a.placeholder);
    check('[占位] 不出现 cf-soft', !a.soft);
    check('[占位] 不注入「仍然查看」按钮', !a.btn);
    // 卡片仍在 DOM 里，网格格数不变（这正是「保留占位」的核心诉求）
    check('[占位] 卡片仍留在 DOM 中（格数不变）', !!raw);
    check('[占位] 三张卡都在（屏蔽不减少卡片数量）', doc.querySelectorAll('.item').length === 3);
    const c = stateOf(cardOf(doc, 'ABC-003'));
    check('[占位] 未命中的 ABC-003 不受影响', !c.blocked && !c.placeholder);

    /* —— 回归守卫：规则撤销后占位卡必须恢复可见 ——
       走真实路径：模拟设置页删掉屏蔽规则 → 触发 storage.onChanged → content.js 重跑 pass。
       .cf-placeholder 必须出现在 clearMarks / resetPassMarks 两份类名清单里，
       漏一个就会留下 visibility:hidden，而 findCards() 用 getBoundingClientRect 判可见，
       卡片会被永久过滤掉（.cf-blocked 曾踩过这个坑，见 content.js:1211 注释）。 */
    check('[占位] 已捕获 storage.onChanged 回调（测试前提）', typeof win.__onChanged === 'function');
    const before = stateOf(cardOf(doc, 'ABC-001'));
    check('[占位] 撤销前确认卡片带 cf-placeholder', before.placeholder);
    // 删掉屏蔽规则后广播变更
    store['sf_data_v1'].rules = [];
    if (win.__onChanged) {
      win.__onChanged({ sf_data_v1: { newValue: store['sf_data_v1'] } }, 'local');
    }
    await sleep(800);
    const after = stateOf(cardOf(doc, 'ABC-001'));
    check('[占位] 撤销后不再带 cf-placeholder（否则永久不可见）', !after.placeholder);
    check('[占位] 撤销后不再带 cf-blocked', !after.blocked);
    check('[占位] 撤销后 ABC-001 仍能被 findCards 找到（未从视野消失）',
      !!cardOf(doc, 'ABC-001'));
    check('[占位] 撤销后三张卡都还在', doc.querySelectorAll('.item').length === 3);
  }

  /* ================= 阶段四：老数据迁移（softBlock → blockDisplay） ================= */
  {
    // 老用户勾过软屏蔽 → 迁移后应保持灰化，不能因为改了默认值就让页面观感突变
    const { win, store } = build(null, { legacySoftBlock: true });
    await sleep(600);
    const a = stateOf(cardOf(win.document, 'ABC-001'));
    check('[迁移] softBlock:true → blockDisplay:soft（保持灰化）',
      store['sf_data_v1'].settings.blockDisplay === 'soft');
    check('[迁移] 旧字段 softBlock 已删除（不留两份真相）',
      !('softBlock' in store['sf_data_v1'].settings));
    check('[迁移] 运行时确实走软屏蔽', a.soft);
  }
  {
    // 老用户没勾软屏蔽 → 迁移后应是「完全隐藏」，而非新装的「保留占位」
    const { win, store } = build(null, { legacySoftBlock: false });
    await sleep(600);
    const a = stateOf(cardOf(win.document, 'ABC-001'));
    check('[迁移] softBlock:false → blockDisplay:hide（保持完全隐藏）',
      store['sf_data_v1'].settings.blockDisplay === 'hide');
    check('[迁移] 旧字段 softBlock 已删除', !('softBlock' in store['sf_data_v1'].settings));
    check('[迁移] 运行时走完全隐藏（不挂占位类）', a.blocked && !a.placeholder);
  }

  /* ================= 阶段五：previewMode = true（规则预览） ================= */
  {
    const { win } = build('hide', { settings: { previewMode: true } });
    await sleep(600);
    const doc = win.document;
    const host = doc.querySelector('.cf-host');
    const sr = host && host.shadowRoot;
    const a = cardOf(doc, 'ABC-001');
    check('[预览] 命中屏蔽的卡片带 cf-preview', a.classList.contains('cf-preview'));
    check('[预览] 预览模式不隐藏卡片（不带 cf-blocked）', !a.classList.contains('cf-blocked'));
    check('[预览] 预览模式不灰化遮罩（不带 cf-soft）', !a.classList.contains('cf-soft'));
    check('[预览] 预览模式不保留占位（不带 cf-placeholder）', !a.classList.contains('cf-placeholder'));
    check('[预览] 预览模式不注入「仍然查看」按钮', !a.querySelector(':scope > .cf-peekbtn'));
    check('[预览] 统计条出现预览计数',
      !!(sr && sr.getElementById('stats') && /预览/.test(sr.getElementById('stats').textContent)));
    const c = cardOf(doc, 'ABC-003');
    check('[预览] 未命中规则的卡片不带 cf-preview', !c.classList.contains('cf-preview'));
  }

  /* ================= 阶段六：放行时长可调（peekHours） ================= */
  {
    // 有效期 1 小时 + 2 小时前的放行记录 → 已过期 → 仍软屏蔽
    const stale = Date.now() - 2 * 3600 * 1000;
    const { win } = build('soft', { settings: { peekHours: 1 }, peeks: { 'ABC-001': stale } });
    await sleep(600);
    const a = cardOf(win.document, 'ABC-001');
    check('[时长] 有效期 1h 时，2h 前的放行已过期 → 仍软屏蔽',
      a.classList.contains('cf-soft') && !a.classList.contains('cf-peek'));
  }
  {
    // 有效期 24 小时 + 2 小时前的放行记录 → 仍在有效期内 → 放行
    const recent = Date.now() - 2 * 3600 * 1000;
    const { win } = build('soft', { settings: { peekHours: 24 }, peeks: { 'ABC-001': recent } });
    await sleep(600);
    const a = cardOf(win.document, 'ABC-001');
    check('[时长] 有效期 24h 时，2h 前的放行仍生效 → 卡片放行',
      !a.classList.contains('cf-soft') && a.classList.contains('cf-peek'));
  }

  /* ================= 阶段七：显示被隐藏（.cf-reveal 临时揭示） ================= */
  {
    const { win } = build('hide');
    await sleep(600);
    const doc = win.document;
    const host = doc.querySelector('.cf-host');
    const sr = host && host.shadowRoot;
    const html = doc.documentElement;
    const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

    const btn = sr && sr.querySelector('[data-act="revealHidden"]');
    check('[揭示] 有屏蔽时出现「显示被隐藏」按钮', !!btn);
    check('[揭示] 初始 <html> 不带 cf-reveal（默认不揭示）', !html.classList.contains('cf-reveal'));
    check('[揭示] 按钮文案含屏蔽计数', !!btn && /显示被隐藏（2）/.test(btn.textContent));

    click(btn);
    check('[揭示] 点击后 <html> 挂上 cf-reveal', html.classList.contains('cf-reveal'));
    check('[揭示] 按钮文案切换为「恢复隐藏」', /恢复隐藏/.test(btn.textContent));
    // 揭示是纯视图态：卡片仍带 cf-blocked（下游统计/调试器读它），可见性交给 CSS 覆写
    check('[揭示] 揭示不改卡片标记（仍带 cf-blocked，交给 CSS 覆写可见性）',
      cardOf(doc, 'ABC-001').classList.contains('cf-blocked'));
    check('[揭示] 揭示不改 stats 计数（屏蔽数仍为 2）', /屏蔽 <b>2<\/b>/.test(sr.getElementById('stats').innerHTML));

    click(btn);
    check('[揭示] 再点一次摘掉 cf-reveal（恢复默认）', !html.classList.contains('cf-reveal'));
    check('[揭示] 按钮文案复原为「显示被隐藏」', /显示被隐藏/.test(btn.textContent));
  }
  {
    // 没有任何屏蔽命中时，按钮应隐藏，避免误导用户「有东西被藏起来了」
    const { win } = build('hide', { noRules: true });
    await sleep(600);
    const sr = win.document.querySelector('.cf-host').shadowRoot;
    const btn = sr.querySelector('[data-act="revealHidden"]');
    check('[揭示] 无屏蔽命中时按钮隐藏（display:none）', !!btn && btn.style.display === 'none');
  }

  console.log(pass ? '\n屏蔽显示方式专项测试全部通过 ✅' : '\n屏蔽显示方式专项测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
