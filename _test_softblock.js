/* SiteFilter 软屏蔽专项测试
   验证：命中屏蔽规则时「灰化模糊 + 仍然查看临时放行」的确定性行为。
   说明：jsdom 对 Shadow DOM 内复选框的 .click() 激活语义不稳定（附加监听器后会失效），
   因此这里不走 UI 勾选，而是直接把 softBlock 注入 settings（等价于用户已勾选），
   只验证软屏蔽的运行时行为；开关本身是否接线由 _smoke.js 断言。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = 'C:\\Users\\admin\\Desktop\\site-filter';
const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');

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

function build(softBlock, extra) {
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
    settings: {
      enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
      showBall: true, pinHighlight: true, markSeen: true, favBtn: true,
      watchBtn: true, showWhy: true, softBlock: !!softBlock,
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
  // 允许测试注入 settings 覆盖（用于预览模式 / 放行时长场景）
  Object.assign(store['sf_data_v1'].settings, extra.settings || {});
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
  // 与真实 content script 一致：先加载共享的表达式引擎，再加载 content.js
  win.eval(fs.readFileSync(path.join(EXT, 'expr.js'), 'utf8'));
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
    peek: el.classList.contains('cf-peek'),
    btn: !!el.querySelector(':scope > .cf-peekbtn'),
  };
}

(async () => {
  /* ================= 阶段一：softBlock = true ================= */
  {
    const { win, store } = build(true);
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

  /* ================= 阶段二：softBlock = false（对照） ================= */
  {
    const { win } = build(false);
    await sleep(600);
    const doc = win.document;
    const a = stateOf(cardOf(doc, 'ABC-001'));
    check('[硬] 关闭软屏蔽后走 cf-blocked（完全隐藏）', a.blocked);
    check('[硬] 关闭软屏蔽后不出现 cf-soft', !a.soft);
    check('[硬] 关闭软屏蔽后不注入「仍然查看」按钮', !a.btn);
  }

  /* ================= 阶段三：previewMode = true（规则预览） ================= */
  {
    const { win } = build(false, { settings: { previewMode: true } });
    await sleep(600);
    const doc = win.document;
    const host = doc.querySelector('.cf-host');
    const sr = host && host.shadowRoot;
    const a = cardOf(doc, 'ABC-001');
    check('[预览] 命中屏蔽的卡片带 cf-preview', a.classList.contains('cf-preview'));
    check('[预览] 预览模式不隐藏卡片（不带 cf-blocked）', !a.classList.contains('cf-blocked'));
    check('[预览] 预览模式不灰化遮罩（不带 cf-soft）', !a.classList.contains('cf-soft'));
    check('[预览] 预览模式不注入「仍然查看」按钮', !a.querySelector(':scope > .cf-peekbtn'));
    check('[预览] 统计条出现预览计数',
      !!(sr && sr.getElementById('stats') && /预览/.test(sr.getElementById('stats').textContent)));
    const c = cardOf(doc, 'ABC-003');
    check('[预览] 未命中规则的卡片不带 cf-preview', !c.classList.contains('cf-preview'));
  }

  /* ================= 阶段四：放行时长可调（peekHours） ================= */
  {
    // 有效期 1 小时 + 2 小时前的放行记录 → 已过期 → 仍软屏蔽
    const stale = Date.now() - 2 * 3600 * 1000;
    const { win } = build(true, { settings: { peekHours: 1 }, peeks: { 'ABC-001': stale } });
    await sleep(600);
    const a = cardOf(win.document, 'ABC-001');
    check('[时长] 有效期 1h 时，2h 前的放行已过期 → 仍软屏蔽',
      a.classList.contains('cf-soft') && !a.classList.contains('cf-peek'));
  }
  {
    // 有效期 24 小时 + 2 小时前的放行记录 → 仍在有效期内 → 放行
    const recent = Date.now() - 2 * 3600 * 1000;
    const { win } = build(true, { settings: { peekHours: 24 }, peeks: { 'ABC-001': recent } });
    await sleep(600);
    const a = cardOf(win.document, 'ABC-001');
    check('[时长] 有效期 24h 时，2h 前的放行仍生效 → 卡片放行',
      !a.classList.contains('cf-soft') && a.classList.contains('cf-peek'));
  }

  console.log(pass ? '\n软屏蔽专项测试全部通过 ✅' : '\n软屏蔽专项测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
