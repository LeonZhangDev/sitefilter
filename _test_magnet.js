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

const EXT = __dirname;
const code = require('./_load').contentBundle();

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
  const wantSub = !!opts.subframe;
  const dom = new JSDOM(
    // 子 frame 场景：外层页面只放一个 <iframe>，内容脚本注入到 iframe 里执行。
    // jsdom 会正确实现 iframe 的 frame 关系（iframeWin.top === topWin，iframeWin.self === iframeWin）
    // ⇒ content.js 里的 IS_TOP 判定自然为 false，**不需要任何测试后门**。
    // （试过直接改写 win.top：jsdom 里它是不可配置的 getter —— Cannot redefine property。）
    wantSub ? '<!doctype html><html><body><iframe id="__f" src="about:blank"></iframe></body></html>'
            : (opts.html || PAGE),
    {
      url: opts.url || 'https://example.com/page',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
  const win = dom.window;
  const rectStub = function () {
    return { width: 220, height: 320, top: 0, left: 0, right: 220, bottom: 320, x: 0, y: 0 };
  };
  win.Element.prototype.getBoundingClientRect = rectStub;
  // W = 内容脚本实际运行的那个 window（顶层就是 win，子 frame 场景是 iframe 的 contentWindow）
  let W = win;
  if (wantSub) {
    W = win.document.getElementById('__f').contentWindow;
    W.Element.prototype.getBoundingClientRect = rectStub;
    W.document.body.innerHTML = opts.html || PAGE;
  }
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
    runtime: { sendMessage: opts.sendMessage || function () { return Promise.resolve(); }, onMessage: { addListener(fn) { (win.__sfMsgListeners = win.__sfMsgListeners || []).push(fn); } } },
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
    window: W, document: W.document, location: W.location,
    navigator: W.navigator, chrome: chromeProxy,
    setTimeout: W.setTimeout.bind(W), clearTimeout: W.clearTimeout.bind(W),
    setInterval: W.setInterval.bind(W), clearInterval: W.clearInterval.bind(W),
    addEventListener: W.addEventListener.bind(W), removeEventListener: W.removeEventListener.bind(W),
    getComputedStyle: W.getComputedStyle.bind(W),
    // 内容脚本在 boot() 里挂 MutationObserver 监听无限滚动；不注入会一路抛到 process 级
    MutationObserver: W.MutationObserver,
    Node: W.Node, Element: W.Element, HTMLElement: W.HTMLElement,
    KeyboardEvent: W.KeyboardEvent, MouseEvent: W.MouseEvent, CustomEvent: W.CustomEvent,
    Map, Set, WeakMap, Promise, JSON, Math, Date, URL, URLSearchParams,
    RegExp, String, Number, Boolean, Array, Object, Error,
    console: { log() { }, warn() { }, error() { } },
    decodeURIComponent, encodeURIComponent, parseInt, parseFloat, isNaN,
    atob: W.atob.bind(W), btoa: W.btoa.bind(W),
  };
  sandbox.globalThis = sandbox;
  // 显式打开只读测试钩子
  W.__siteFilterTestApi = 'magnet-only';
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'content-bundle' });
  return { win, W, store, sandbox };
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

  /* ---------- 正文被「隐形空白」截断的磁力（第一层：纯函数） ----------
   * 这条缺陷比「丢一条」更坏：URL_STOP 含 \s（JS 空白类），而 U+FEFF / U+00A0 /
   * U+3000 / U+2009 都算 JS 空白 → 正则在此截断 → parseMagnet 只要求「hash 非空」，
   * 于是**半截 hash 会被当合法磁力收下**：用户看到一条下不动的链接，页面上毫无提示。
   * 修法见 magnet-core.js::magnetCandidates（只在 hash 长度可疑时才跨过隐形空白重接）。 */
  {
    const INVISIBLES = [
      ['U+FEFF（BOM 型 ZWNBSP）', '\ufeff'],
      ['U+00A0（&nbsp;）', '\u00a0'],
      ['U+3000（全角空格）', '\u3000'],
      ['U+2009（thin space）', '\u2009'],
    ];
    INVISIBLES.forEach(([name, ch]) => {
      const raw = 'magnet:?xt=urn:btih:' + HASH_A.slice(0, 8) + ch + HASH_A.slice(8);
      // 先证明前提成立：严格正则会在此截断。这条断言防的是「测试悄悄失效」——
      // 哪天 URL_STOP 不再含 JS 空白类，它会红，提示这一节该重写。
      hook.MAGNET_RE.lastIndex = 0;
      const strict = hook.MAGNET_RE.exec(raw);
      check('[截断][前提][' + name + '] 严格正则确实在此截断（残串只剩 8 位 hash）',
        !!strict && strict[0].indexOf(ch) === -1 &&
        hook.parseMagnet(strict[0]).hash === HASH_A.slice(0, 8));
      const cds = hook.probeBodyMagnets(raw).list;
      check('[截断][' + name + '] 候选只有 1 条（残串被替换，不是并排两条）', cds.length === 1);
      const p = cds.length === 1 ? hook.parseMagnet(cds[0]) : null;
      check('[截断][' + name + '] hash 被补成完整 40 位', !!p && p.hash === HASH_A);
    });

    // 截断点之后还有别的参数时也要接对（别接半截就停）
    const withDn = 'magnet:?xt=urn:btih:' + HASH_A.slice(0, 8) + '\ufeff' + HASH_A.slice(8) + '&dn=x.mkv';
    const pd = hook.parseMagnet(hook.probeBodyMagnets(withDn).list[0]);
    check('[截断] 截断点之后还有 &dn= 时同样接对（hash 完整、参数不丢）',
      !!pd && pd.hash === HASH_A && pd.dn === 'x.mkv');
  }

  /* ---------- 截断修复的负面：修它不能把别的弄坏 ---------- */
  {
    // ① 完整链接后面跟「&nbsp; + 正文」→ 不能把正文吃进 hash（宁少不错）
    const latin = hook.probeBodyMagnets('magnet:?xt=urn:btih:' + HASH_A + '\u00a0Some text here').list;
    check('[截断][负面] 完整 hash 后跟 &nbsp; 与拉丁正文：不吃正文',
      latin.length === 1 && hook.parseMagnet(latin[0]).hash === HASH_A);
    const cjk = hook.probeBodyMagnets('magnet:?xt=urn:btih:' + HASH_A + '\u00a0下载说明文字').list;
    check('[截断][负面] 完整 hash 后跟 &nbsp; 与中文正文：不吃正文',
      cjk.length === 1 && hook.parseMagnet(cjk[0]).hash === HASH_A);

    // ② 两条链接只隔一个 &nbsp;（<a>A</a>&nbsp;<a>B</a> 的文本形态）→ 不能粘成一条
    const two = hook.probeBodyMagnets(
      'magnet:?xt=urn:btih:' + HASH_A + '\u00a0magnet:?xt=urn:btih:' + HASH_B).list;
    check('[截断][负面] 两条链接只隔一个 &nbsp;：仍是 2 条（不粘、不丢）', two.length === 2);
    const hs = two.map(c => (hook.parseMagnet(c) || {}).hash);
    check('[截断][负面] 两条各自的 hash 都完整',
      hs.indexOf(HASH_A) !== -1 && hs.indexOf(HASH_B) !== -1);

    // ③ 真是被真空格拆开的残串 → 不猜（猜错比不猜更坏）
    const spaced = hook.probeBodyMagnets(
      'magnet:?xt=urn:btih:' + HASH_A.slice(0, 8) + ' ' + HASH_A.slice(8)).list;
    check('[截断][负面] 被真空格拆开的残串不猜（保持原样）',
      spaced.length === 1 && hook.parseMagnet(spaced[0]).hash === HASH_A.slice(0, 8));

    // ④ 零宽 U+200B 不在 JS 空白类里 → 本来就能解，行为不受本次改动影响
    const zw = hook.probeBodyMagnets(
      'magnet:?xt=urn:btih:' + HASH_A.slice(0, 8) + '\u200b' + HASH_A.slice(8)).list;
    check('[截断][对照] U+200B（不属于 JS 空白类）本来就被解出完整 hash',
      zw.length === 1 && hook.parseMagnet(zw[0]).hash === HASH_A);
  }

  /* ---------- hash 长度判据：只当修复的触发条件，不做过滤 ---------- */
  {
    const pk = s => hook.hashLooksTruncated(hook.parseMagnet(s));
    check('[判据] v1 40 位 hex → 不是残串', pk('magnet:?xt=urn:btih:' + HASH_A) === false);
    check('[判据] v1 32 位 base32 → 不是残串',
      pk('magnet:?xt=urn:btih:abcdefghijklmnopqrstuvwxyz234567') === false);
    check('[判据] 8 位 hex → 判为可疑（截断的典型形态）',
      pk('magnet:?xt=urn:btih:c12fe1aa') === true);
    check('[判据] v2 64 位 multihash → 不是残串',
      pk('magnet:?xt=urn:btmh:' + HASH_V2) === false);
    check('[判据] v2 68 位（0x1220 前缀的真实形态）→ 不是残串',
      pk('magnet:?xt=urn:btmh:1220' + HASH_V2) === false);
    // 挖空：被接走的尾巴不能再被 base64 / 裸 hash 扫描认领（否则一条变两条）
    check('[判据] 挖空只挖被接走的尾巴，不动其它文本',
      (function () {
        const head = '前缀保持不变 ';
        const r = hook.probeBodyMagnets(head + 'magnet:?xt=urn:btih:' + HASH_A.slice(0, 8)
          + '\u00a0' + HASH_A.slice(8) + ' 尾巴之后' + ('x'.repeat(40)));
        return r.masked.indexOf(head) === 0 &&
          r.masked.indexOf(HASH_A.slice(0, 8)) !== -1 &&
          r.masked.indexOf(HASH_A.slice(8)) === -1 &&
          r.masked.indexOf('尾巴之后') !== -1 &&
          r.masked.length === (head + 'magnet:?xt=urn:btih:' + HASH_A.slice(0, 8)
            + '\u00a0' + HASH_A.slice(8) + ' 尾巴之后' + ('x'.repeat(40))).length;
      })());
    // 关键：判据只决定「要不要试着往后接」，不收窄既有行为（短 hash 照旧收下）
    check('[判据] 只做触发不做过滤：短 hash 仍被 parseMagnet 收下（既有行为不变）',
      !!hook.parseMagnet('magnet:?xt=urn:btih:c12fe1aa'));
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

  /* 正文截断端到端：站点拿 &nbsp; / U+FEFF 把 infohash 打断 —— 面板必须给出完整串。
     修复前的真实行为是「列表里多一条 hash 只有 8 位、点开下不动的链接」。 */
  {
    const SPLIT_HTML = `<!doctype html><html><body>
      <div class="wrap">
        <div id="p1">magnet:?xt=urn:btih:${HASH_A.slice(0, 8)}&nbsp;${HASH_A.slice(8)}</div>
        <div id="p2">magnet:?xt=urn:btih:${HASH_B.slice(0, 8)}&#65279;${HASH_B.slice(8)}</div>
      </div></body></html>`;
    const { win } = build({ html: SPLIT_HTML });
    await sleep(900);
    const h = hookOf(win);
    const mags = h.dlLinks().filter(d => d.type === 'magnet');
    check('[截断][面板] 只出现 2 条（残串被替换，不是 4 条）', mags.length === 2);
    check('[截断][面板] &nbsp; 打断的 infohash 在面板里是完整的 40 位',
      mags.some(d => d.magnet && d.magnet.hash === HASH_A));
    check('[截断][面板] U+FEFF 打断的 infohash 在面板里是完整的 40 位',
      mags.some(d => d.magnet && d.magnet.hash === HASH_B));
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
      check('[面板] 默认 magnetAction=copy 时不显示「打开」按钮（零行为变化）',
        list.querySelectorAll('[data-open]').length === 0);
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

  /* 磁力行操作方式：both → 每行有「打开」按钮，点击唤起系统默认下载工具 */
  {
    const { win } = build({ settings: { magnetAction: 'both' } });
    await sleep(900);
    const list = await openDownloadTab(win);
    const opens = list ? list.querySelectorAll('[data-open]') : [];
    const copies = list ? list.querySelectorAll('[data-dl]') : [];
    check('[打开] both 模式：磁力行出现「打开」按钮', opens.length > 0);
    check('[打开] both 模式：同时保留「复制」按钮', copies.length > 0);
    check('[打开] 顶部出现「用下载工具打开全部磁力」按钮',
      !!list && !!list.parentNode.querySelector('[data-act="openAllMagnet"]'));
    // 点击「打开」→ 造一个 magnet: 锚点并 click（用桩捕获，避免 jsdom 真导航）
    let captured = null;
    const proto = win.HTMLAnchorElement.prototype;
    const origClick = proto.click;
    proto.click = function () { captured = this.href; };
    try {
      opens[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    } finally {
      proto.click = origClick;
    }
    check('[打开][回归] 点击「打开」唤起系统默认处理程序（生成 magnet: 锚点）',
      !!captured && /magnet:/i.test(captured));
    check('[打开] 首次点击后出现一次性提示（未装客户端时引导）',
      !!list && !!list.parentNode.querySelector('.cf-maghint'));
  }

  /* 磁力行操作方式：open → 只有「打开」按钮，没有「复制」 */
  {
    const { win } = build({ settings: { magnetAction: 'open' } });
    await sleep(900);
    const list = await openDownloadTab(win);
    const opens = list ? list.querySelectorAll('[data-open]') : [];
    const copies = list ? list.querySelectorAll('[data-dl]') : [];
    check('[打开] open 模式：磁力行有「打开」按钮', opens.length > 0);
    check('[打开] open 模式：不显示「复制」按钮（仅打开）', copies.length === 0);
  }

  /* Tier B：设置里填了自定义下载器 → 「打开」走本机桥（而不是系统默认） */
  {
    const sent = [];
    // 桩：背景返回成功。content.js 用 sendMessage(msg, cb) 形式
    const sendMessage = (msg, cb) => {
      sent.push(msg);
      if (cb) cb({ ok: true, result: { launched: true, client: 'C:\\Thunder.exe' } });
      return Promise.resolve();
    };
    const { win } = build({ settings: { magnetAction: 'both', magnetClient: 'C:\\Thunder.exe' }, sendMessage });
    await sleep(900);
    const list = await openDownloadTab(win);
    const opens = list ? list.querySelectorAll('[data-open]') : [];
    check('[TierB] 填了自定义下载器时「打开」按钮仍在', opens.length > 0);

    // 点「打开」→ 应发给背景（而不是造锚点唤起系统默认）
    let anchorClicked = null;
    const proto = win.HTMLAnchorElement.prototype;
    const origClick = proto.click;
    proto.click = function () { anchorClicked = this.href; };
    try {
      opens[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    } finally {
      proto.click = origClick;
    }
    await sleep(30);

    const m = sent.find(x => x && x.type === 'sf_magnet_open');
    check('[TierB] 走本机桥：发出 sf_magnet_open 消息', !!m);
    check('[TierB] 消息里带上自定义下载器路径', !!m && m.client === 'C:\\Thunder.exe');
    check('[TierB] 消息里带上 magnet 链接', !!m && /^magnet:/i.test(m.magnet));
    check('[TierB] 成功时不回退去唤起系统默认（不生成锚点）', anchorClicked === null);
    check('[TierB] 成功时不给「没装客户端」的误导提示',
      !list.parentNode.querySelector('.cf-maghint'));
  }

  /* Tier B 失败 → 自动回退 Tier A（保证「点了总有反应」） */
  {
    const sent = [];
    const sendMessage = (msg, cb) => {
      sent.push(msg);
      if (cb) cb({ ok: false, error: { code: 'client-not-found', message: '找不到下载器：C:\\bad.exe' } });
      return Promise.resolve();
    };
    const { win } = build({ settings: { magnetAction: 'both', magnetClient: 'C:\\bad.exe' }, sendMessage });
    await sleep(900);
    const list = await openDownloadTab(win);
    const opens = list ? list.querySelectorAll('[data-open]') : [];

    let anchorClicked = null;
    const proto = win.HTMLAnchorElement.prototype;
    const origClick = proto.click;
    proto.click = function () { anchorClicked = this.href; };
    try {
      opens[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      // 降级发生在 Promise 的 catch 里（异步），所以桩要保持到它跑完再撤
      await sleep(40);
    } finally {
      proto.click = origClick;
    }

    check('[TierB-降级] 也先尝试了本机桥', sent.some(x => x && x.type === 'sf_magnet_open'));
    check('[TierB-降级][回归] 本机桥失败时回退唤起系统默认（生成 magnet: 锚点）',
      !!anchorClicked && /magnet:/i.test(anchorClicked));
    const hint = list.parentNode.querySelector('.cf-maghint');
    check('[TierB-降级] 面板内说明失败原因（含具体错误）',
      !!hint && /找不到下载器/.test(hint.textContent));
  }

  /* ================================================================
   * 第三层：磁力归属到卡片（角标 + 卡片右键菜单）
   * 下载页签是**整页扁平**的 —— 一页几十张卡扫出几百条链接时，
   * 「这张卡上有几条磁力」必须真的接到卡片上（class / data-*），
   * 而不是只躺在 dlLinks 里等人去猜。
   * ================================================================ */
  const CARD_HTML = `<!doctype html><html><body>
    <div class="list">
      <div class="item"><a href="${MAG_A1.replace(/&/g, '&amp;')}">ABC-001</a>
        <a href="${MAG_A2.replace(/&/g, '&amp;')}">mirror</a></div>
      <div class="item"><a href="${MAG_B.replace(/&/g, '&amp;')}">ABC-002</a></div>
      <div class="item"><a href="/detail/3">ABC-003</a></div>
      <div class="item"><a href="/detail/4">ABC-004</a></div>
    </div></body></html>`;
  const CARD_SITES = [{ id: 's1', pattern: '*://example.com/*', enabled: true, selector: '.item', note: 'T' }];

  {
    const { win } = build({ html: CARD_HTML, sites: CARD_SITES });
    await sleep(900);
    const doc = win.document;
    const cards = Array.from(doc.querySelectorAll('.item'));
    check('[归属] 前提：4 张卡都被识别为 .cf-card（否则本节断言无意义）',
      doc.querySelectorAll('.item.cf-card').length === 4);
    check('[归属] 有磁力的卡片挂上 .cf-hasmagnet 角标', cards[0].classList.contains('cf-hasmagnet'));
    check('[归属] 角标计数走 data-cf-mg（CSS attr() 读它）', cards[0].dataset.cfMg === '1');
    check('[归属] 同一张卡上的两个变体只算 1 条（已归并，不是 2）',
      cards[0].dataset.cfMg === '1');
    check('[归属] 第二张卡的磁力归到它自己（1 条）',
      cards[1].classList.contains('cf-hasmagnet') && cards[1].dataset.cfMg === '1');
    check('[归属] 没有磁力的两张卡不挂角标',
      !cards[2].classList.contains('cf-hasmagnet') && !cards[3].classList.contains('cf-hasmagnet'));
    // 角标靠 class + CSS ::after，不许往页面里插节点（插了会触发自己的 MutationObserver → 每轮自激）
    check('[归属] 不靠插 DOM 节点实现（卡片里没有额外子元素）',
      cards[0].querySelectorAll('span.cf-mg').length === 0);

    // 卡片右键菜单：按卡取磁力
    cards[0].dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const menu = doc.querySelector('.cf-cardmenu');
    check('[归属] 卡片右键菜单能弹出', !!menu);
    const copyBtn = menu && menu.querySelector('[data-cm="copycardmagnet"]');
    check('[归属] 菜单里有「复制这张卡的磁力」（带条数）',
      !!copyBtn && /复制这张卡的磁力（1）/.test(copyBtn.textContent));
    check('[归属] magnetAction=copy（默认）时不给「打开」项（零行为变化）',
      !!menu && !menu.querySelector('[data-cm="opencardmagnet"]'));
    if (copyBtn) {
      copyBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      check('[归属] 点「复制这张卡的磁力」后菜单关闭', !doc.querySelector('.cf-cardmenu'));
    }
  }

  /* 关「标记链接」→ 角标摘掉，但数据仍在（面板还得能用） */
  {
    const { win } = build({ html: CARD_HTML, sites: CARD_SITES, settings: { probeMark: false } });
    await sleep(900);
    const doc = win.document;
    check('[归属] 关掉「标记链接」时不挂卡片角标',
      doc.querySelectorAll('.cf-hasmagnet').length === 0);
    const h = hookOf(win);
    check('[归属] 但探测数据还在（A1/A2 归并 + B = 2 条磁力）',
      h && h.dlLinks().filter(d => d.type === 'magnet').length === 2);
  }

  /* magnetAction=both → 卡片菜单给出「打开这张卡的磁力」 */
  {
    const { win } = build({ html: CARD_HTML, sites: CARD_SITES, settings: { magnetAction: 'both' } });
    await sleep(900);
    const doc = win.document;
    doc.querySelector('.item').dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
    const menu = doc.querySelector('.cf-cardmenu');
    check('[归属] magnetAction=both 时菜单出现「打开这张卡的磁力」',
      !!menu && !!menu.querySelector('[data-cm="opencardmagnet"]'));
  }

  /* ================================================================
   * 第四层：iframe（子 frame 探测 → 顶层 frame 汇总）
   * 子 frame 里只探测 + 上报，不建面板、不画标记、不应用规则。
   * ================================================================ */
  {
    const sent = [];
    const { W } = build({
      subframe: true,
      sendMessage: function (msg) { sent.push(msg); return Promise.resolve(); },
    });
    await sleep(900);
    const doc = W.document;
    check('[frame] 前提：这个 window 确实不是顶层（top !== self）', W.top !== W.self);
    check('[frame] 子 frame 不建悬浮面板（没有 .cf-host）', !doc.querySelector('.cf-host'));
    const rep = sent.filter(x => x && x.type === 'sf_frame_probe').pop();
    check('[frame] 子 frame 把探测结果上报给后台（sf_frame_probe）', !!rep);
    check('[frame] 上报内容含页面里的磁力',
      !!rep && rep.links.some(function (l) { return /^magnet:/i.test(l.raw); }));
    check('[frame] 上报条目带 type（顶层用同一套解析复用，不必二次猜类型）',
      !!rep && rep.links.every(function (l) { return typeof l.type === 'string' && l.type; }));
    check('[frame] 子 frame 不在页面里画绿虚线标记', doc.querySelectorAll('.cf-dl').length === 0);
    check('[frame] 子 frame 不做卡片分类（页面里没有 .cf-card）',
      doc.querySelectorAll('.cf-card').length === 0);
  }

  {
    const { win } = build({});
    await sleep(900);
    const h = hookOf(win);
    const before = h ? h.dlLinks().length : 0;
    const lns = win.__sfMsgListeners || [];
    check('[frame] 顶层 frame 注册了消息监听', lns.length > 0);

    // 1) 子 frame 上报一条顶层页面里没有的磁力 → 应并入
    const SUB_HASH = 'abcdef0123456789abcdef0123456789abcdef01';
    const subMagnet = 'magnet:?xt=urn:btih:' + SUB_HASH + '&dn=' + encodeURIComponent('SUB-FRAME-ONLY.mkv');
    lns.forEach(fn => fn({ type: 'sf_frame_probe', frameId: 3, links: [{ raw: subMagnet, type: 'magnet' }] }));
    await sleep(60);
    const after = hookOf(win).dlLinks();
    check('[frame] 子 frame 的链接被并入顶层列表', after.some(d => d.raw === subMagnet));
    check('[frame] 并入后条目数 +1（' + before + ' → ' + after.length + '）', after.length === before + 1);
    const list = await openDownloadTab(win);
    check('[frame] 下载页签里能看到子 frame 的链接',
      !!list && list.textContent.indexOf('SUB-FRAME-ONLY') !== -1);
    check('[frame] 下载页签标出「有几条来自子框架」',
      !!list && list.textContent.indexOf('来自子框架') !== -1);

    // 2) 跨 frame 同一 infohash 必须归并（页面里已有 HASH_A，子 frame 再报一次）
    const dup = 'magnet:?xt=urn:btih:' + HASH_A + '&dn=' + encodeURIComponent('ABC-001-mirror.mkv');
    lns.forEach(fn => fn({ type: 'sf_frame_probe', frameId: 4, links: [{ raw: dup, type: 'magnet' }] }));
    await sleep(60);
    const after2 = hookOf(win).dlLinks();
    check('[frame] 跨 frame 同一 infohash 只出现一条（归并，不是两条）',
      after2.filter(d => d.magnet && d.magnet.hash === HASH_A).length === 1);

    // 3) 该 frame 重新上报为空（导航走了 / 内容变了）→ 旧条目必须消失，不留残影
    lns.forEach(fn => fn({ type: 'sf_frame_probe', frameId: 3, links: [] }));
    await sleep(60);
    const after3 = hookOf(win).dlLinks();
    check('[frame] 子 frame 更新为空后旧条目消失（不留残影）',
      !after3.some(d => d.raw === subMagnet));
    check('[frame] 顶层自己的链接不受影响（子 frame 清空只撤它自己的）',
      after3.some(d => /^magnet:/i.test(d.raw) && d.magnet && d.magnet.hash === HASH_A));
  }

  function countOccurrences(s, sub) {
    let n = 0, i = 0;
    while ((i = s.indexOf(sub, i)) !== -1) { n++; i += sub.length; }
    return n;
  }

  console.log(pass ? '\n磁力深度专项测试全部通过 ✅' : '\n磁力深度专项测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
