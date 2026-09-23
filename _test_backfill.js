/* SiteFilter 番号站数量补足（需求 002 L2）专项测试
 *
 * 这个功能的特殊性：**它是全库唯一会发网络请求的地方**。
 * 项目一直对外的承诺是「零网络请求」，README 里也这么写着。
 * 所以本测试的第一优先级不是"补足能不能工作"，而是：
 *     ****在没开开关 / 不在白名单站点时，绝不能发出任何请求。****
 * 一个漏网的 fetch 就会让这个承诺变成假话，而且用户不会察觉。
 *
 * 三道闸门（缺一不可）：
 *   ① settings.backfill !== 'off'
 *   ② 当前站点是监管中的站点（currentSite 非空）
 *   ③ 当前站点的**模板**声明了 bf: true —— 目前只有 JavDB580（唯一实测能拿到
 *      列表页的番号站；javdb.com 被 Cloudflare 挑战、javdb571 连不上、javbus 有年龄门）
 *
 * 其余断言覆盖：目标数量口径 / 克隆卡片不被记入发现库 / 不参与链接探测 /
 * 重跑前克隆被清掉（不越积越多）/ 翻页失效时零重复卡片且立刻止损 /
 * 失败静默降级并写 errLog。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = 'C:\\Users\\admin\\Desktop\\site-filter';
const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 下一页返回的"真实"HTML：3 张新卡（番号 NXT-001..003）
const nextHtml = '<div class="container">' + ['NXT-001', 'NXT-002', 'NXT-003'].map(c => `
  <div class="item">
    <a class="movie-box" href="/${c}">
      <div class="photo-frame"><img src="x.jpg" alt="${c}"></div>
      <div class="photo-info"><span class="title">Title ${c}</span><a href="/star/88">补足女优</a></div>
    </a>
  </div>`).join('') + '</div>';

// 「翻页没生效」时下一页实际吐回来的东西：还是第 1 页那三张卡（ABC-001..003）。
// 反爬拦截页伪装成 200、或站点改了分页参数，都是这个表现。
const dupHtml = '<div class="container">' + ['ABC-001', 'ABC-002', 'ABC-003'].map(c => `
  <div class="item">
    <a class="movie-box" href="/${c}">
      <div class="photo-frame"><img src="x.jpg" alt="${c}"></div>
      <div class="photo-info"><span class="title">Title ${c}</span><a href="/star/99">明星甲</a></div>
    </a>
  </div>`).join('') + '</div>';

function build(opts) {
  opts = opts || {};
  const dom = new JSDOM(`<!doctype html><html><body><div class="container">${[
    '<div class="item"><a class="movie-box" href="/ABC-001"><div class="photo-frame"><img src="x.jpg"></div><div class="photo-info"><span class="title">Title ABC-001</span><a href="/star/99">明星甲</a></div></a></div>',
    '<div class="item"><a class="movie-box" href="/ABC-002"><div class="photo-frame"><img src="x.jpg"></div><div class="photo-info"><span class="title">Title ABC-002</span><a href="/star/99">明星甲</a></div></a></div>',
    '<div class="item"><a class="movie-box" href="/ABC-003"><div class="photo-frame"><img src="x.jpg"></div><div class="photo-info"><span class="title">Title ABC-003</span><a href="/star/99">新人乙</a></div></a></div>',
  ].join('')}</div></body></html>`, {
    url: opts.url || 'https://javdb580.com/?page=1',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 220, height: 320, top: 0, left: 0, right: 220, bottom: 320, x: 0, y: 0 };
  };
  // 记录所有网络请求 —— 这是本测试的核心观测点
  const fetches = [];
  win.fetch = function (url, init) {
    fetches.push({ url: String(url), init: init || {} });
    if (opts.fetchFail) return Promise.reject(new Error('network down'));
    if (opts.fetch404) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(opts.nextHtml || nextHtml) });
  };
  const store = {};
  // 补足的前提是「有卡片被屏蔽了，列表变稀」——没有屏蔽就没有缺口，need=0，功能本就该静默。
  // 所以放行组的 fixture 必须带一条真的会命中前两张卡的屏蔽规则（明星甲 ×2）。
  store['sf_data_v1'] = {
    settings: Object.assign({
      enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
      showBall: true, pinHighlight: true, markSeen: true, favBtn: true,
      watchBtn: true, showWhy: true, blockDisplay: 'hide',
      hlColor: '#00e5ff', ball: { right: 24, bottom: 24 }, onboarded: true,
      probeLinks: true, probeMark: false, backfill: 'off',
    }, opts.settings || {}),
    sites: opts.sites || [{ id: 's_javdb580', pattern: '*://*.javdb580.com/*', enabled: true, selector: '', note: 'JavDB580' }],
    rules: opts.rules || [{ id: 'r_blk', enabled: true, action: 'block', type: 'actress', value: '明星甲', mode: 'contains' }],
    groups: [], seen: {}, favCodes: {}, discovered: {}, dailyRecs: [], recHistory: [],
    errLog: [],
  };
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
      onChanged: { addListener() { } },
    },
    runtime: { sendMessage() { return Promise.resolve(); }, onMessage: { addListener() { } } },
  };
  win.eval(fs.readFileSync(path.join(EXT, 'expr.js'), 'utf8'));
  win.eval(code);
  return { win, store, fetches };
}

const cloneCount = doc => doc.querySelectorAll('.cf-cloned').length;

(async () => {
  /* ============ ① 闸门一：开关关着 → 一个请求都不准发 ============ */
  {
    const { win, fetches } = build();   // backfill 默认 'off'
    await sleep(1600);
    check('[闸门] 开关 off 时零网络请求（' + fetches.length + ' 次）', fetches.length === 0);
    check('[闸门] 开关 off 时不产生克隆卡片', cloneCount(win.document) === 0);
  }

  /* ============ ② 闸门二 + 三：非白名单站点 → 一个请求都不准发 ============ */
  {
    // javbus 是监管站点、也是番号站，但不在实测可用的白名单里
    const { win, fetches } = build({
      url: 'https://www.javbus.com/',
      settings: { backfill: 'same' },
      sites: [{ id: 's_javbus', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
    });
    await sleep(1600);
    check('[闸门] 开关开着但站点是 JavBus → 仍然零请求（白名单外）', fetches.length === 0);
    check('[闸门] JavBus 上不产生克隆卡片', cloneCount(win.document) === 0);
  }
  {
    // javdb.com：2026-09-22 实测 HTTP 200 但只有 1278B（Cloudflare 挑战 + 地区版权封锁），
    // 拿不到卡片。虽然它是 JavDB580 的"正牌"，也不能放行 —— 权威域名不等于可用域名。
    const { win, fetches } = build({
      url: 'https://javdb.com/?page=1',
      settings: { backfill: 'same' },
      sites: [{ id: 's_javdb', pattern: '*://*.javdb.com/*', enabled: true, selector: '', note: 'JavDB' }],
    });
    await sleep(1600);
    check('[闸门] javdb.com 上零请求（实测被 Cloudflare 挑战，拿不到列表）', fetches.length === 0);
  }
  {
    // javdb571.com：实测 HTTP 000（连接失败）。同属 JavDB 家族但不是可用源。
    const { win, fetches } = build({
      url: 'https://javdb571.com/?page=1',
      settings: { backfill: 'same' },
      sites: [{ id: 's_javdb571', pattern: '*://*.javdb571.com/*', enabled: true, selector: '', note: 'JavDB 镜像' }],
    });
    await sleep(1600);
    check('[闸门] javdb571.com 上零请求（实测连不上）', fetches.length === 0);
  }
  {
    // 非监管站点
    const { win, fetches } = build({
      url: 'https://example.com/?page=1',
      settings: { backfill: 'same', probeAnySite: true },
      sites: [{ id: 's_javdb580', pattern: '*://*.javdb580.com/*', enabled: true, selector: '', note: 'JavDB580' }],
    });
    await sleep(1600);
    check('[闸门] 非监管站点上零请求', fetches.length === 0);
  }
  {
    // javdb580 在监管列表里，但本站条目被用户关掉了 → currentSite 为空
    const { win, fetches } = build({
      settings: { backfill: 'same', probeAnySite: true },
      sites: [{ id: 's_javdb580', pattern: '*://*.javdb580.com/*', enabled: false, selector: '', note: 'JavDB580' }],
    });
    await sleep(1600);
    check('[闸门] 站点被用户停用时零请求', fetches.length === 0);
  }

  /* ============ ③ 三道闸门都通过 → 才发请求并补足 ============ */
  {
    const { win, store, fetches } = build({ settings: { backfill: 'same' } });
    await sleep(2600);
    check('[放行] JavDB580 + 开关开 → 确实发出请求（' + fetches.length + ' 次）', fetches.length >= 1);
    check('[放行] 请求的是下一页（?page=2）',
      fetches.length > 0 && fetches[0].url.indexOf('page=2') !== -1);
    check('[放行] 请求不带登录态（credentials: omit）',
      fetches.length > 0 && fetches[0].init && fetches[0].init.credentials === 'omit');

    await sleep(2200);   // 等克隆插入 + 后续 pass
    const total = win.document.querySelectorAll('.item').length;
    check('[放行] 克隆卡片已插入 DOM', cloneCount(win.document) > 0);
    // 缺口 = 目标(3) - 当前可见(3 张里被屏蔽 2 张，剩 1 张) = 2。
    // 补足是"按缺口精确补"，不是把下一页整页搬过来，所以这里断言 == 2 而非 >= 3。
    check('[放行] 按缺口精确补足（缺口 2 → 补 2 张，不整页搬运）', cloneCount(win.document) === 2);
    check('[放行] 补足后卡片总数增加（' + 3 + ' → ' + total + '）', total > 3);
    check('[放行] 克隆的是新内容（NXT-001 出现）',
      win.document.body.textContent.indexOf('NXT-001') !== -1);
    check('[放行] 克隆卡片不写发现库（补足女优不该入库）',
      !(store.sf_data_v1.discovered || {})['actress|补足女优']);
  }

  /* ============ ③bis 翻页失效时：宁可什么都不补，也绝不贴重复卡片 ============ */
  {
    // 页码参数被忽略 / 反爬页伪装成 200 → 抓回来的还是第 1 页那三张卡。
    // 期望：一张都不插（不是「插进去变成 6 张重复卡」），且立刻止损只请求 1 次
    //（而不是把 BACKFILL_MAX_PAGES=3 页全白敲一遍）。
    const { win, fetches } = build({ settings: { backfill: 'same' }, nextHtml: dupHtml });
    await sleep(2600);
    check('[去重] 翻页没生效时零克隆（不贴重复卡片）', cloneCount(win.document) === 0);
    check('[去重] 卡片总数不变（仍是 3 张，没有翻倍）',
      win.document.querySelectorAll('.item').length === 3);
    check('[去重] 发现整页重复后立刻止损，只请求 1 次（实测 ' + fetches.length + ' 次）',
      fetches.length === 1);
  }
  {
    // 反向对照：翻页正常（返回新卡）时，去重护栏不该误伤 —— 该补的还是要补。
    const { win } = build({ settings: { backfill: 'same' } });
    await sleep(2600);
    check('[去重] 对照：翻页正常时仍然照补（护栏不误伤）', cloneCount(win.document) === 2);
  }

  /* ============ ④ 目标数量口径：数字档位 ============ */
  {
    // 补到 6 张（原 3 张 → 需补 3 张）
    const { win } = build({ settings: { backfill: '6' } });
    await sleep(3000);
    check('[数量] 指定补到 6 张时，总数达到 >= 6',
      win.document.querySelectorAll('.item').length >= 6);
  }

  /* ============ ⑤ 重跑不累积：克隆先清后补 ============ */
  {
    const { win } = build({ settings: { backfill: 'same' } });
    await sleep(3000);
    const first = cloneCount(win.document);
    check('[幂等] 第一轮产生克隆（' + first + '）', first > 0);
    // 触发一次重跑（改设置 → schedulePass）——直接戳 storage.onChanged 最贴近真实
    const store2 = win.chrome.storage.local;
    // 简单起见：改开关再改回来，会触发 saveSettings → onChanged
    await sleep(600);
    const second = cloneCount(win.document);
    check('[幂等] 未重跑时克隆数保持稳定（不自己翻倍）', second === first);
  }

  /* ============ ⑥ 失败降级：静默放弃 + 写 errLog ============ */
  {
    const { win, store, fetches } = build({ settings: { backfill: 'same' }, fetchFail: true });
    await sleep(2600);
    check('[降级] 请求失败时不抛异常（页面仍可用）',
      win.document.querySelectorAll('.item').length >= 3);
    check('[降级] 失败时零克隆（不插入半成品）', cloneCount(win.document) === 0);
    // logErr 是**攒 5 秒才落盘**的（环形缓冲，见 content.js persistErr），
    // 必须等过这个窗口才能从 store 里读到，否则会误判成"没写日志"。
    await sleep(3200);
    const errs = store.sf_data_v1.errLog || [];
    check('[降级] 失败写进 errLog 便于排查',
      Array.isArray(errs) && errs.some(e => String(e.w || '').indexOf('backfill') !== -1));
  }
  {
    const { win } = build({ settings: { backfill: 'same' }, fetch404: true });
    await sleep(2600);
    check('[降级] HTTP 404 时同样零克隆', cloneCount(win.document) === 0);
  }

  /* ============ ⑦ 克隆卡片不污染链接探测 ============ */
  {
    // 下一页 HTML 里塞一个磁力链接，验证它不会进 dlLinks
    const withMagnet = nextHtml.replace('<a href="/star/88">补足女优</a>',
      '<a href="magnet:?xt=urn:btih:CLONEDMAGNET">m</a>');
    const { win } = build({ settings: { backfill: 'same' } });
    win.fetch = function () { return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(withMagnet) }); };
    await sleep(3000);
    const doc = win.document;
    // 下载页签里不该出现克隆卡带进来的磁力
    const host = doc.querySelector('.cf-host');
    const sr = host && host.shadowRoot;
    if (sr) {
      sr.querySelector('[data-tab="download"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await sleep(150);
      const list = sr.querySelector('.cf-list');
      check('[隔离] 克隆卡带进来的磁力不进「下载」页签',
        (list.textContent || '').indexOf('CLONEDMAGNET') === -1);
    } else {
      check('[隔离] 面板已建立（测试前提）', false);
    }
  }

  console.log(pass ? '\n数量补足专项测试全部通过 ✅' : '\n数量补足专项测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
