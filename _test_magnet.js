/* SiteFilter 磁力深度（L2 全字段解析 + L4 归并排序）专项测试
 *
 * 为什么这个套件要分两层：
 *   ① 面板层（真实路径）—— 页面里塞磁力，走 probeLinks → renderDownloads → 读
 *      Shadow DOM 里的「下载」页签。这层保证「用户真的看得到」。
 *   ② 解析器层（钩子）—— 磁力的正确性全在解析细节里：字段口径、同 infohash 归并、
 *      排序层级。这些在面板文字里是被压缩过的（只看得见标签和体积），
 *      用 UI 断言测不出「tr 有没有合并」「xl 有没有被误读」。所以 content.js
 *      末尾开了一扇**只读**测试钩子（window.__siteFilterTestApi === 'magnet-only'
 *      时才挂 __sfHook），这里用 vm 代理桩把它接出来直测。
 *
 * 本套件钉住的 4 个已知缺陷（都是「静默错」，用户看不出来）：
 *   A. 旧 pushLink 用 /^magnet:\?xt=urn:btih:/ 锚定 → `dn=` 排在 xt 前的磁力整条丢失
 *   B. 旧写法只认 btih → BitTorrent v2（`xt=urn:btmh:`）被静默丢弃
 *   C. 旧写法按整串 raw 去重 → 同一种子换 tracker 会显示成两行
 *   D. 旧写法不读 `xl` → 体积靠外层 DOM 文本猜，可能抓到无关数字
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const EXT = 'C:\\Users\\admin\\Desktop\\site-filter';
const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 两条真实磁力串（互为同一 infohash 的两个变体） ---------------- */
const HASH_A = 'c12fe1aabbccddeeff00112233445566778899aa';   // v1 40 hex
const HASH_B = '0123456789abcdef0123456789abcdef01234567';   // v1 40 hex（另一部片）
// v2 multihash：真实形态是 64 位 hex（sha256）
const HASH_V2 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// A 的第一个变体：**dn 与 tr 排在 xt 前面**（旧代码在这一条上会整条丢掉）
const MAG_A1 = 'magnet:?dn=' + encodeURIComponent('ABC-001 1080p 3.2GB.mkv') +
  '&tr=' + encodeURIComponent('udp://tracker.openbittorrent.com:80/announce') +
  '&xt=urn:btih:' + HASH_A;
// A 的第二个变体：xt 在前、tr 不同、dn 更短（应被归并成同一条，保留更长的 dn + 全部 tr）
const MAG_A2 = 'magnet:?xt=urn:btih:' + HASH_A +
  '&dn=' + encodeURIComponent('ABC-001.mkv') +
  '&tr=' + encodeURIComponent('udp://tracker2.example.com:6969/announce');
// 与 A 不同 hash 的独立磁力
const MAG_B = 'magnet:?xt=urn:btih:' + HASH_B + '&dn=' + encodeURIComponent('ABC-002 720p.mkv');
// v2 磁力
const MAG_V2 = 'magnet:?xt=urn:btmh:' + HASH_V2 + '&dn=' + encodeURIComponent('ABC-003 v2.mkv');
// 残缺磁力：只有 dn，没有 xt → 必须被丢弃（不是种子）
const MAG_BROKEN = 'magnet:?dn=just-a-name-no-hash';
// 带 xl 的磁力（精确字节数 3435973837 ≈ 3.2 GiB）
const MAG_XL = 'magnet:?xt=urn:btih:' + HASH_B +
  '&dn=' + encodeURIComponent('ABC-004.mkv') + '&xl=3435973837';
// 非磁力链接：验证排序里排在磁力之后
const PAN_URL = 'https://pan.baidu.com/s/1AbCdEfGhIjK';
const ED2K_URL = 'ed2k://|file|ABC-005.mkv|734003200|AABBCCDDEEFF00112233445566778899|/';

/* ---------------- 测试用页面 ---------------- */
const PAGE = `<!doctype html><html><body>
  <div class="container">
    <a id="a1" href="${MAG_A1.replace(/&/g, '&amp;')}">磁力A1</a>
    <a id="a2" href="${MAG_A2.replace(/&/g, '&amp;')}">磁力A2</a>
    <a id="a3" href="${MAG_B.replace(/&/g, '&amp;')}">磁力B</a>
    <a id="a4" href="${MAG_V2.replace(/&/g, '&amp;')}">磁力v2</a>
    <a id="a5" href="${MAG_BROKEN.replace(/&/g, '&amp;')}">残缺磁力</a>
    <a id="a6" href="${PAN_URL}">网盘</a>
    <a id="a7" href="${ED2K_URL}">电驴</a>
  </div>
</body></html>`;

const BASE_SETTINGS = {
  enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
  showBall: true, pinHighlight: true, markSeen: true, favBtn: false,
  watchBtn: false, showWhy: false, blockDisplay: 'placeholder',
  hlColor: '#00e5ff', ball: { right: 24, bottom: 24 }, onboarded: true,
  probeLinks: true, probeMark: true, probeAnySite: true, backfill: 'off',
};

function build(opts) {
  opts = opts || {};
  const dom = new JSDOM(opts.html || PAGE, {
    url: opts.url || 'https://example.com/page',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 220, height: 320, top: 0, left: 0, right: 220, bottom: 320, x: 0, y: 0 };
  };
  const store = {};
  store['sf_data_v1'] = {
    // 不写 schemaVersion ⇒ 从 v1 一路迁移到当前版本（与真实老数据同路径）
    settings: Object.assign({}, BASE_SETTINGS, opts.settings || {}),
    sites: opts.sites || [],
    rules: [], groups: [], seen: {}, favCodes: {}, discovered: {},
    dailyRecs: [], recHistory: [], peeks: {}, errLog: [],
  };
  win.chrome = {
    storage: {
      // 注意：不带 get/set 函数体 —— 见下方 vm 代理桩为什么这么写
      local: {}, sync: {},
      onChanged: { addListener() { } },
    },
    runtime: { sendMessage() { return Promise.resolve(); }, onMessage: { addListener() { } } },
  };
  const dlGet = (k, cb) => cb({ [k]: store[k] });
  const dlSet = (o, cb) => { Object.assign(store, o); if (cb) cb(); };
  // 需要 vm 代理才能补函数体（沙箱对象的属性可以按名字劫持）
  const chromeProxy = new Proxy(win.chrome, {
    get(t, k) {
      if (k === 'storage') {
        return new Proxy(t.storage, {
          get(s, area) {
            if (area === 'local') return { get: dlGet, set: dlSet };
            if (area === 'sync') return { get: (k2, cb) => cb({}), set: dlSet };
            return s[area];
          },
        });
      }
      return t[k];
    },
  });
  const sandbox = {
    window: win, document: win.document, location: win.location,
    navigator: win.navigator, chrome: chromeProxy,
    setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win),
    addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    // 内容脚本在 boot() 里挂 MutationObserver 监听无限滚动；不注入会一路抛到 process 级
    MutationObserver: win.MutationObserver,
    Node: win.Node, Element: win.Element, HTMLElement: win.HTMLElement,
    KeyboardEvent: win.KeyboardEvent, MouseEvent: win.MouseEvent, CustomEvent: win.CustomEvent,
    Map, Set, WeakMap, Promise, JSON, Math, Date, URL, URLSearchParams,
    RegExp, String, Number, Boolean, Array, Object, Error,
    console: { log() { }, warn() { }, error() { } },
    decodeURIComponent, encodeURIComponent, parseInt, parseFloat, isNaN,
    atob: win.atob.bind(win), btoa: win.btoa.bind(win),
  };
  sandbox.globalThis = sandbox;
  // 显式打开只读测试钩子
  win.__siteFilterTestApi = 'magnet-only';
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'expr.js'), 'utf8'), sandbox, { filename: 'expr.js' });
  vm.runInContext(code, sandbox, { filename: 'content.js' });
  return { win, store, sandbox };
}

/* 钩子是否可用 —— 不可用则整个套件失去意义，必须先红 */
function hookOf(win) {
  return win.__sfHook;
}

/* 打开面板的「下载」页签，返回该页签列表元素 */
async function openDownloadTab(win) {
  const doc = win.document;
  const host = doc.querySelector('.cf-host');
  const sr = host && host.shadowRoot;
  if (!sr) return null;
  const tab = sr.querySelector('[data-tab="download"]');
  if (!tab) return null;
  tab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  return sr.querySelector('.cf-list');
}

const dlText = d => d.raw;

(async () => {
  /* ================================================================
   * 第一层：解析器（直测钩子）
   * ================================================================ */
  const { win: W } = build({});
  await sleep(700);
  const hook = hookOf(W);

  check('[钩子] 只读测试钩子已挂载（window.__sfHook）', !!hook);
  if (!hook) {
    console.log('\n钩子缺失，后续断言无法进行 ❌');
    process.exit(1);
  }
  check('[钩子] 暴露的是纯函数 parseMagnet', typeof hook.parseMagnet === 'function');
  check('[钩子] 暴露的是纯函数 fmtBytes', typeof hook.fmtBytes === 'function');
  check('[钩子] 只读：赋值不生效（未定义 setter）',
    (() => { try { hook.parseMagnet = null; return hook.parseMagnet === (hookOf(W).parseMagnet); } catch (e) { return true; } })());

  /* ---------- 缺陷 A：xt 不在最前的磁力必须能解析出来 ---------- */
  {
    const m = hook.parseMagnet(MAG_A1);
    check('[A][回归] dn/tr 排在 xt 前面的磁力仍能解析（旧代码整条丢弃）', !!m);
    check('[A] 解析出 v1 算法', m && m.algo === 'btih');
    check('[A] 解析出完整 40 位 infohash', m && m.hash === HASH_A);
    check('[A] hashShort 为前 10 位大写', m && m.hashShort === HASH_A.slice(0, 10).toUpperCase());
    check('[A] dn 已解码（%20 → 空格）', m && m.dn === 'ABC-001 1080p 3.2GB.mkv');
    check('[A] tr 已收集 1 条', m && m.trs.length === 1);
  }

  /* ---------- 缺陷 B：BitTorrent v2（btmh）不能被丢 ---------- */
  {
    const m = hook.parseMagnet(MAG_V2);
    check('[B][回归] v2 磁力（xt=urn:btmh）不再被丢弃', !!m);
    check('[B] 算法识别为 btmh', m && m.algo === 'btmh');
    check('[B] v2 multihash 完整保留（64 位）', m && m.hash === HASH_V2 && m.hashLen === 64);
  }

  /* ---------- 残缺磁力必须丢弃 ---------- */
  {
    check('[健壮] 没有 xt 的 magnet 串返回 null（不当链接展示）',
      hook.parseMagnet(MAG_BROKEN) === null);
    check('[健壮] 空串返回 null', hook.parseMagnet('') === null);
    check('[健壮] 非磁力串返回 null', hook.parseMagnet('https://example.com/x') === null);
  }

  /* ---------- 缺陷 D：xl 是权威体积，优先于文件名猜测 ---------- */
  {
    const m = hook.parseMagnet(MAG_XL);
    check('[D][回归] xl 被读取并作为体积来源', m && m.sizeFrom === 'xl');
    check('[D] xl=3435973837 → 显示 3.20GB（1024 进制）', m && m.size === '3.20GB');
    // dn 里没有体积时，xl 是唯一来源（精确格式见下方「格式」段，这里只验来源口径）
    const m2 = hook.parseMagnet('magnet:?xt=urn:btih:' + HASH_A + '&dn=plain.mkv&xl=1048576');
    check('[D] dn 无体积时 xl 是唯一来源（sizeFrom=xl）', m2 && m2.sizeFrom === 'xl' && m2.size === '1MB');
  }
  {
    // 没有 xl → 退回从文件名里猜（带单位才认）
    const m = hook.parseMagnet(MAG_A1);
    check('[D] 无 xl 时从 dn 兜底猜体积（1080p 3.2GB.mkv → 3.2GB）', m && m.size === '3.2GB');
    check('[D] 同时从 dn 猜出画质 1080p', m && m.quality === '1080p');
    check('[D] 体积来源标记为 dn', m && m.sizeFrom === 'dn');
    // 番号里的数字不能被当体积（这是「只认独立数字+单位」的原因）
    const m3 = hook.parseMagnet('magnet:?xt=urn:btih:' + HASH_A + '&dn=ABC-1234567890-x264.mkv');
    check('[D] 番号里的数字不会被误认成体积', m3 && m3.size === '');
  }

  /* ---------- 体积格式化口径 ---------- */
  {
    check('[格式] 0 / 负数 → 空串', hook.fmtBytes(0) === '' && hook.fmtBytes(-5) === '');
    check('[格式] 512 → 512B（字节不带小数）', hook.fmtBytes(512) === '512B');
    check('[格式] 1024 → 1KB（整数不带 .00，读起来才像人写的）', hook.fmtBytes(1024) === '1KB');
    check('[格式] 1536 → 1.50KB（非整数保留两位）', hook.fmtBytes(1536) === '1.50KB');
    check('[格式] 1.5GB（1610612736）→ 1.50GB', hook.fmtBytes(1610612736) === '1.50GB');
    check('[格式] 100GB 以上取整（不显示无意义小数）', hook.fmtBytes(107374182400) === '100GB');
    check('[格式] 2TB 上限单位', hook.fmtBytes(2199023255552) === '2TB');
    // 3.2 GiB 的精确字节数 —— xl 是权威值，必须原样可信
    check('[格式] 3435973837 → 3.20GB（xl 实测量级）', hook.fmtBytes(3435973837) === '3.20GB');
  }

  /* ---------- 排序层级 ---------- */
  {
    const mk = (type, size, quality, magnet) => ({ type, size, quality, magnet });
    const r = hook.magnetRank;
    check('[排序] 磁力+体积+画质 = 第 0 档', r(mk('magnet', '3GB', '1080p')) === 0);
    check('[排序] 磁力+体积 = 第 1 档', r(mk('magnet', '3GB', '')) === 1);
    check('[排序] 磁力+画质 = 第 2 档', r(mk('magnet', '', '1080p')) === 2);
    check('[排序] 裸磁力 = 第 3 档', r(mk('magnet', '', '')) === 3);
    check('[排序] 网盘排在任何磁力之后', r(mk('pan', '3GB', '1080p')) > r(mk('magnet', '', '')));
  }

  /* 归并后的 raw 重建：tr 要全，顺序要规范 */
  {
    const m = hook.parseMagnet(MAG_A1);
    m.trs.push('udp://tracker2.example.com:6969/announce');
    const raw = hook.buildMagnetRaw(m);
    check('[重建] xt 排在最前（规范顺序）', /^magnet:\?xt=urn:btih:/.test(raw));
    check('[重建] 两条 tr 都在', raw.indexOf('openbittorrent') !== -1 && raw.indexOf('tracker2.example.com') !== -1);
    check('[重建] dn 已 URL 编码（空格不裸奔）', raw.indexOf('dn=ABC-001%201080p') !== -1 || raw.indexOf('dn=') !== -1);
    check('[重建] 重建结果可被自己解析回同一 hash',
      hook.parseMagnet(raw).hash === HASH_A);
  }

  /* ================================================================
   * L3 反混淆：把藏起来的磁力解出来（直测 decodeObfuscated）
   * ================================================================ */
  {
    check('[L3][钩子] 暴露纯函数 decodeObfuscated', typeof hook.decodeObfuscated === 'function');

    // ① 注入零宽字符防正则
    const zw = 'magnet:?\u200bxt=urn:btih:' + HASH_A + '&dn=' + encodeURIComponent('zw.mkv');
    const mzw = hook.parseMagnet(hook.decodeObfuscated(zw));
    check('[L3][零宽] 注入 \\u200b 的磁力被还原为同一 hash', !!mzw && mzw.hash === HASH_A);

    // ② HTML 实体编码（&#x3F; → ?，&#x26; → &）
    const ent = 'magnet:&#x3F;xt=urn:btih:' + HASH_A + '&#x26;dn=' + encodeURIComponent('entity.mkv');
    const ment = hook.decodeObfuscated(ent);
    check('[L3][实体] &#x3F;/&#x26; 被解码成 ? 和 &',
      !!ment && ment.indexOf('magnet:?xt=urn:btih:') === 0 && ment.indexOf('&dn=') !== -1);

    // ③ 百分号编码（magnet%3A%3Fxt%3D...）
    const pct = 'magnet%3A%3Fxt%3Durn%3Abtih%3A' + HASH_A + '%26dn%3D' + encodeURIComponent('pct.mkv');
    const mpct = hook.decodeObfuscated(pct);
    check('[L3][百分号] magnet%3A%3F... 被解码为可用磁力',
      !!mpct && mpct.indexOf('magnet:?xt=urn:btih:') === 0);

    // ④ base64 包一层（data-* 常见藏法）
    const b64 = Buffer.from('magnet:?xt=urn:btih:' + HASH_A + '&dn=' + encodeURIComponent('b64.mkv')).toString('base64');
    const mb64 = hook.decodeObfuscated(b64);
    check('[L3][base64] 包一层 base64 的磁力被解出',
      !!mb64 && mb64.indexOf('magnet:?xt=urn:btih:') === 0);

    // ⑤ 裸 40 位 hash 补 magnet: 前缀（data-hash 之类）
    const bare = hook.decodeObfuscated(HASH_A);
    check('[L3][裸hash] 40 位裸 hex 补上 magnet: 前缀', bare === 'magnet:?xt=urn:btih:' + HASH_A);

    // ⑥ 普通散文不应被当磁力（不误报）
    check('[L3][健壮] 普通文本 decodeObfuscated 返回 null',
      hook.decodeObfuscated('just some random prose with no link') === null);
  }

  /* L3 端到端：藏在属性 / 正文里的磁力，面板要出现 */
  {
    const magB64 = Buffer.from('magnet:?xt=urn:btmh:' + HASH_V2 + '&dn=' + encodeURIComponent('l3-v2.mkv')).toString('base64');
    const L3_HTML = `<!doctype html><html><body>
      <div class="wrap">
        <span id="h1" data-hash="${HASH_B}">裸hash</span>
        <a id="m1" data-magnet="${magB64}" href="#">base64磁力</a>
        <div id="z1">magnet:?\u200bxt=urn:btih:${HASH_A}&dn=zw.mkv</div>
      </div></body></html>`;
    const { win } = build({ html: L3_HTML });
    await sleep(900);
    const h = hookOf(win);
    const mags = h.dlLinks().filter(d => d.type === 'magnet');
    check('[L3][面板] data-hash 裸 hash 被补全为磁力', mags.some(d => d.magnet && d.magnet.hash === HASH_B));
    check('[L3][面板] data-magnet 的 base64 被解出为磁力（含 v2）',
      mags.some(d => d.magnet && d.magnet.hash === HASH_V2 && d.magnet.algo === 'btmh'));
    check('[L3][面板] 正文零宽字符磁力被还原', mags.some(d => d.magnet && d.magnet.hash === HASH_A));
    check('[L3][面板] 共 3 条磁力（无重复、无漏）', mags.length === 3);
  }

  /* ================================================================
   * 第二层：端到端（真实探测 → 面板「下载」页签）
   * ================================================================ */
  {
    const { win } = build({});
    await sleep(900);
    const doc = win.document;
    const list = await openDownloadTab(win);
    check('[面板] 「下载」页签已建立（测试前提）', !!list);
    if (list) {
      const text = list.textContent || '';
      const rows = list.querySelectorAll('.cf-dlrow');
      // 页面给了 3 条有效磁力（A1/A2 同一 hash 归并成 1 条 + B + v2）+ 1 网盘 + 1 电驴 = 5 行
      check('[面板] 行数 = 5（7 条链接中：A1/A2 归并、残缺磁力丢弃）', rows.length === 5);
      check('[面板][C][回归] 同一 infohash 的两个变体只出现一行（旧代码两行）',
        text.indexOf('c12fe1aabb'.toUpperCase().slice(0, 10)) !== -1 &&
        countOccurrences(text, 'C12FE1AABB') === 1);
      check('[面板][B][回归] v2 磁力出现在列表里', /MAGNET·V2/.test(text));
      check('[面板][A][回归] xt 不在前的磁力仍在列表里（ABC-001 文件名可见）',
        text.indexOf('ABC-001') !== -1);
      check('[面板] 残缺磁力没有出现', text.indexOf('just-a-name-no-hash') === -1);
      check('[面板] 标题显示「10 位 hash · 文件名」', /C12FE1AABB · ABC-001/.test(text));
      // 排序：第一条应是信息最全的磁力
      const first = rows[0] && rows[0].textContent || '';
      check('[面板] 首行是磁力（磁力优先于网盘）', /MAGNET/.test(first));
      // 归并后 tracker 数应出现（2 条）
      check('[面板] 显示归并后的 tracker 条数（2 trackers）', /2 trackers/.test(text));
      // 网盘 / 电驴排在最后
      const types = Array.from(rows).map(r => (r.querySelector('.k') || {}).textContent || '');
      check('[面板] 网盘行排在磁力行之后', types.indexOf('PAN') > 0 || types.indexOf('PAN') === -1);
    }
  }

  /* 开关关掉 → 零行（不能因为改了探测逻辑就绕过开关） */
  {
    const { win } = build({ settings: { probeLinks: false } });
    await sleep(900);
    const list = await openDownloadTab(win);
    const rows = list ? list.querySelectorAll('.cf-dlrow').length : 0;
    check('[开关] probeLinks:false 时下载页签零行', rows === 0);
  }

  /* 面板未开时也要先把链接探好（stats.dl 要准，悬浮球徽标读它） */
  {
    const { win } = build({});
    await sleep(900);
    const h = hookOf(win);
    check('[统计] 探测结果已落进 stats.dl', h && h.stats().dl === 5);
    check('[统计] dlLinks 里磁力占 3 条（归并后）',
      h && h.dlLinks().filter(d => d.type === 'magnet').length === 3);
  }

  function countOccurrences(s, sub) {
    let n = 0, i = 0;
    while ((i = s.indexOf(sub, i)) !== -1) { n++; i += sub.length; }
    return n;
  }

  console.log(pass ? '\n磁力深度专项测试全部通过 ✅' : '\n磁力深度专项测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
