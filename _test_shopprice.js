/* SiteFilter 多站比价（需求 003 建议 ②）专项测试
 *
 * 这个功能的定位先说清楚，否则测试会写歪：
 *   「自动抓各站价格/是否有货」在这个扩展里**做不到** —— JavDB 被 Cloudflare 挑战挡、
 *   JavBus 302 到年龄门、JavDB571 直接连不上，只有 JavDB580 能返回正常 HTML；
 *   再加上跨域限制，扩展内无法稳定"替你问一圈"。
 *   所以做的是诚实版：① 一键齐开（让浏览器替你开，带登录态与代理）
 *                    ② 本地标记（你在哪几个站看到过什么，勾一下累积成徽标）
 *
 * 因此本测试断言的是：
 *   ① 比价入口出现在番号行，且不引入任何网络请求（只拼 URL）
 *   ② 浮层能开、能关，列出全部 CODE_SITES，标记按钮数量 = 站点数 × 字段数
 *   ③ 点标记 → 真的写进 shopMarks，且全空站点条目会被清掉（不留垃圾）
 *   ④ 列表徽标计数与之对得上
 *   ⑤ 清空按钮只清当前番号，不误伤别的番号
 *   ⑥ 一键齐开只调 window.open，URL 里的番号被正确 encode
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

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

function build(opts) {
  opts = opts || {};
  const dom = new JSDOM(`<!doctype html><html><body><div class="container">${[
    cardHtml('ABC-001', '明星甲'),
    cardHtml('ABC-002', '新人乙'),
    cardHtml('ABC-003', '路人丙'),
  ].join('')}</div></body></html>`, {
    url: 'https://www.javbus.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const opened = [];
  win.open = function (u) { opened.push(u); return null; };
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 300, height: 420, top: 20, left: 600, right: 900, bottom: 440, x: 600, y: 20 };
  };
  const store = {};
  store['sf_data_v1'] = {
    settings: {
      enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
      showBall: true, pinHighlight: true, markSeen: true, favBtn: true,
      watchBtn: true, showWhy: true, blockDisplay: 'hide', codeSearchBtns: true,
      hlColor: '#00e5ff', ball: { right: 24, bottom: 24 }, onboarded: true,
    },
    sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
    rules: [], groups: [], seen: {},
    favCodes: {
      'ABC-001': { t: '标题一', u: '/ABC-001', s: 'javbus', at: Date.now() },
      'ABC-002': { t: '标题二', u: '/ABC-002', s: 'javbus', at: Date.now() },
    },
    discovered: {}, dailyRecs: [], recHistory: [],
    shopMarks: opts.shopMarks || {},
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
  win.eval(code);
  return { win, store, opened };
}

(async () => {
  /* ============ ① 入口与零网络请求 ============ */
  {
    const { win, store, opened } = build();
    await sleep(700);
    const doc = win.document;
    const host = doc.querySelector('.cf-host');
    const sr = host && host.shadowRoot;
    const list = sr && sr.querySelector('.cf-list');
    check('面板已建立', !!list);

    // 切到番号收藏页
    sr.querySelector('[data-tab="favcode"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(120);

    const shopBtns = Array.from(list.querySelectorAll('.cf-dlrow [data-shop]'));
    check('每条番号都有「比价」入口', shopBtns.length === 2);
    check('比价入口标着番号', shopBtns.some(b => b.dataset.shop === 'ABC-001'));
    check('零命中时列表不显示比价徽标', list.querySelectorAll('.cf-shopbadge').length === 0);
    // 关键：光渲染比价入口不该发起任何网络请求，也不该自己开窗
    check('渲染比价入口不触发任何 window.open', opened.length === 0);

    /* ============ ② 浮层开 / 关 / 结构 ============ */
    shopBtns[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(80);
    const panel = doc.querySelector('.cf-shoppanel');
    check('点比价后出现浮层', !!panel);
    check('浮层标题含番号', !!panel && panel.textContent.indexOf('ABC-001') !== -1);
    check('浮层说明了「扩展不代你抓取」的原因（不假装有能力）',
      !!panel && panel.textContent.indexOf('不代你抓取') !== -1);

    // 站点行数 = CODE_SITES 数；标记按钮数 = 站点数 × 4 个字段
    const siteRows = panel.querySelectorAll('.cf-shoprow');
    check('浮层列出全部 Code 站点（>=3）', siteRows.length >= 3);
    const mkBtns = panel.querySelectorAll('.cf-shopmk');
    check('标记按钮数 = 站点数 × 4（有资源/有磁力/高清/想要）',
      mkBtns.length === siteRows.length * 4);
    check('站点行带外链（点了是浏览器自己开，不受扩展跨域限制）',
      panel.querySelectorAll('.cf-shoprow a.cf-shopname[target="_blank"]').length === siteRows.length);
    check('浮层初始没有任何标记被点亮', panel.querySelectorAll('.cf-shopmk.on').length === 0);

    /* ============ ③ 点标记 → 写进 shopMarks ============ */
    // 给「第一个站点」点「有磁力」；字段顺序是 has/magnet/hd/fav
    const firstSite = siteRows[0].querySelector('.cf-shopname').textContent.trim();
    const magnetBtn = Array.from(panel.querySelectorAll('.cf-shopmk')).find(b => b.dataset.shopmk === 'magnet');
    check('找到「有磁力」标记按钮', !!magnetBtn);
    if (magnetBtn) magnetBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(150);

    const marks = store.sf_data_v1.shopMarks || {};
    check('标记已写入 shopMarks[番号][站点]',
      !!(marks['ABC-001'] && marks['ABC-001'][firstSite] && marks['ABC-001'][firstSite].magnet === 1));
    const panel2 = doc.querySelector('.cf-shoppanel');
    check('浮层重绘后该标记呈点亮态',
      !!panel2 && Array.from(panel2.querySelectorAll('.cf-shopmk.on')).some(b => b.dataset.shopmk === 'magnet'));
    // 列表徽标要跟着出现（toggleShopMark 里主动重绘了列表）
    const badgeNow = list.querySelector('.cf-dlrow [data-shop="ABC-001"]');
    check('打标记后列表出现该番号的比价徽标',
      !!badgeNow && !!badgeNow.closest('.cf-dlrow').querySelector('.cf-shopbadge'));

    // 再点一次 → 取消
    const again = Array.from(panel2.querySelectorAll('.cf-shopmk')).find(
      b => b.dataset.shopmk === 'magnet' && b.dataset.site === firstSite);
    if (again) again.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(150);
    const marks2 = store.sf_data_v1.shopMarks || {};
    check('再点一次取消标记',
      !(marks2['ABC-001'] && marks2['ABC-001'][firstSite] && marks2['ABC-001'][firstSite].magnet));
    check('全空站点条目被清掉（不留空对象垃圾）',
      !(marks2['ABC-001'] && marks2['ABC-001'][firstSite]));
    check('番号本身也清掉了（全站都空时）', !marks2['ABC-001']);

    /* ============ ④ 一键齐开：只调 window.open，番号被 encode ============ */
    const panel3 = doc.querySelector('.cf-shoppanel');
    const allBtn = panel3 && panel3.querySelector('#cfShopAll');
    check('浮层有「一键齐开」按钮', !!allBtn);
    opened.length = 0;
    if (allBtn) allBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    // 第一个立即开，其余按 120ms 间隔
    await sleep(700);
    const siteCount = panel3.querySelectorAll('.cf-shoprow').length;
    check('一键齐开打开了全部 ' + siteCount + ' 个站点（实开 ' + opened.length + '）',
      opened.length === siteCount);
    check('打开的 URL 都带编码后的番号',
      opened.length > 0 && opened.every(u => u.indexOf('ABC-001') !== -1));
    check('打开的 URL 都是外链（http/https）',
      opened.every(u => /^https?:/i.test(u)));
    // 关掉浮层
    const closeBtn = doc.querySelector('.cf-shoppanel #cfShopClose');
    check('浮层有关闭按钮', !!closeBtn);
    if (closeBtn) closeBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(60);
    check('点关闭后浮层消失', !doc.querySelector('.cf-shoppanel'));
  }

  /* ============ ⑤ 徽标计数 + 清空只清当前番号 ============ */
  {
    const { win, store } = build({
      shopMarks: {
        'ABC-001': { Bus: { has: 1, magnet: 1 }, '580': { hd: 1 } },   // 2 个站点有标记
        'ABC-002': { Bus: { fav: 1 } },                                // 1 个站点有标记
      },
    });
    await sleep(700);
    const doc = win.document;
    const host = doc.querySelector('.cf-host');
    const sr = host && host.shadowRoot;
    const list = sr.querySelector('.cf-list');
    sr.querySelector('[data-tab="favcode"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(120);

    const badges = Array.from(list.querySelectorAll('.cf-shopbadge'));
    check('有标记的番号显示比价徽标', badges.length === 2);
    const b1 = badges.find(b => b.closest('.cf-dlrow').textContent.indexOf('ABC-001') !== -1);
    const b2 = badges.find(b => b.closest('.cf-dlrow').textContent.indexOf('ABC-002') !== -1);
    check('ABC-001 徽标显示 2（有 2 个站点做过标记）', !!b1 && b1.textContent.indexOf('2') !== -1);
    check('ABC-002 徽标显示 1', !!b2 && b2.textContent.indexOf('1') !== -1);

    // 打开 ABC-001 的比价浮层 → 清空
    const shopBtn = list.querySelector('.cf-dlrow [data-shop="ABC-001"]');
    shopBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(80);
    const clearBtn = doc.querySelector('.cf-shoppanel #cfShopClear');
    check('浮层有「清空本番号标记」按钮', !!clearBtn);
    if (clearBtn) clearBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(200);

    const after = store.sf_data_v1.shopMarks || {};
    check('清空后 ABC-001 的标记没有了', !after['ABC-001']);
    check('清空不误伤 ABC-002', !!(after['ABC-002'] && after['ABC-002'].Bus && after['ABC-002'].Bus.fav));
  }

  /* ============ ⑥ 右键菜单入口 ============ */
  {
    const { win } = build();
    await sleep(700);
    const doc = win.document;
    const card = Array.from(doc.querySelectorAll('.item')).find(el =>
      el.querySelector('a[href="/ABC-001"]'));
    // 打开卡片右键菜单
    card.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await sleep(80);
    const menu = doc.querySelector('.cf-cardmenu');
    check('卡片右键菜单已出现', !!menu);
    check('菜单含「多站比价」入口', !!menu && !!menu.querySelector('button[data-cm="shoppanel"]'));
    check('菜单含「在全部站点打开」入口', !!menu && !!menu.querySelector('button[data-cm="openall"]'));
  }

  console.log(pass ? '\n多站比价专项测试全部通过 ✅' : '\n多站比价专项测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
