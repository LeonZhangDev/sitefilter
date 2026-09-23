/* SiteFilter —— 磁力 / 下载链接的解析与格式化核心。
 *
 * 为什么单独成文件：这部分逻辑**全是纯函数**（不碰 document、不碰 chrome.storage、
 * 不碰 UI 状态），却占了 content.js 里很大一块，而且是最容易「静默出错」的一块 ——
 * 字段口径（xl 优先于 DOM 文本）、同 infohash 归并、分层排序，错一点用户只会觉得
 * 「少看到一条」或「看到重复的一条」，不会报错。抽出来以后它可以被独立单测，
 * 也给后续「让设置页也能解析磁力」留了口子。
 *
 * 边界：
 *   在本模块 —— 链接串 ⇒ 结构化数据（parseMagnet / decodeObfuscated / fmtBytes …）
 *   不在这里 —— 扫 DOM、装配结果集、页面打标记（那些仍在 content.js::probeLinks）
 *
 * content.js 通过 globalThis.SF_MAGNET 使用；Node 测试 require 亦可。
 */
(function () {
  'use strict';

  var PAN_HOSTS = [
    ['baidu', /(^|\.)pan\.baidu\.com/i],
    ['PikPak', /(^|\.)mypikpak\.com/i],
    ['115', /(^|\.)115\.com|(^|\.)115cdn\.com|(^|\.)anxia\.com/i],
    ['夸克', /(^|\.)quark\.cn/i],
    ['阿里盘', /(^|\.)alipan\.com|(^|\.)aliyundrive\.com/i],
    ['天翼', /(^|\.)cloud\.189\.cn/i],
    ['Google', /(^|\.)drive\.google\.com/i],
    ['MEGA', /(^|\.)mega\.nz|(^|\.)mega\.co\.nz/i],
    ['MediaFire', /(^|\.)mediafire\.com/i],
    ['OneDrive', /(^|\.)1drv\.ms/i],
    ['Dropbox', /(^|\.)dropbox\.com/i],
    ['send.cm', /(^|\.)send\.cm/i],
    ['固实', /(^|\.)solidfiles\.com/i]
  ];
  var URL_STOP = '[^\\s"\'<>）)】\\]]+';
  /* 磁力链接：**不锚定 xt=urn:btih 的位置**。
     真实的磁力串里参数顺序是任意的 —— `dn=`/`tr=` 排在 `xt=` 前面很常见
     （很多站的「复制磁力」按钮产出的就是这个顺序），旧写法
     /^magnet:\?xt=urn:btih:/ 会把它们整条丢掉，且 btih 与 btmh 混用时只认 btih。
     这里只认「是个 magnet: 链接」，字段交给 parseMagnet() 解析。 */
  var MAGNET_RE = new RegExp('magnet:\\?' + URL_STOP, 'gi');
  var ED2K_RE = new RegExp('ed2k://' + URL_STOP, 'gi');
  var THUNDER_RE = new RegExp('thunder://' + URL_STOP, 'gi');
  var TORRENT_RE = /https?:\/\/[^\s"'<>]*\.torrent(\?[^\s"'<>]*)?/gi;
  // L3：正文里还可能出现「百分号编码」的磁力（magnet%3A%3Fxt%3D...），字面 MAGNET_RE 抓不到
  var MAGNET_PCT_RE = /magnet%3A[^\s"'<>）)】\]]+/gi;
  // L3：正文里 base64 包一层的磁力 token（bounded：24~400 字符，避免扫遍正文散文）
  var B64_TOKEN_RE = /[A-Za-z0-9+/]{24,400}={0,2}/g;
  var SIZE_RE = /(\d+(?:\.\d+)?\s?(?:GB|GiB|MB|MiB|KB|TB|TiB))/i;
  var QUALITY_RE = /(2160p|4k|1080p|720p|480p|360p)/i;
  /* 磁力 xt 里的 hash：btih = v1（40 位 hex / 32 位 base32），btmh = v2（multihash，通常 64 位 hex） */
  var MAGNET_HASH_RE = /xt=urn:(btih|btmh):([^&\s]+)/i;
  /* magnet 链接里常见的「体积」参数：xl 是精确字节数，其他几个是各站的私有写法 */
  var MAGNET_SIZE_KEYS = ['xl', 'size', 'length', 'fsize'];

  function hostOf(u) {
    try { return new URL(u, location.href).hostname; } catch (e) { return ''; }
  }

  function panOf(url) {
    var h = hostOf(url);
    if (!h) return null;
    for (var i = 0; i < PAN_HOSTS.length; i++) {
      if (PAN_HOSTS[i][1].test(h)) return PAN_HOSTS[i][0];
    }
    return null;
  }

  /* ---------------- 磁力：全字段解析（L2） ----------------
   * 为什么值得单独写一个解析器：磁力串里**本来就带着体积和文件名**，
   * 而旧实现只读 btih 和 dn，体积靠 metaAround() 在外层 DOM 文本里「猜」——
   * 猜错（抓到广告位体积 / 抓到别的文件的体积）是静默的，用户看不出来。
   * 现在优先信链接里的 xl（精确字节数），DOM 文本只作为兜底。
   *
   * 返回 null 表示「这是个 magnet: 但不是可用的种子链接」（没有 xt=urn:btih/btmh）——
   * 调用方据此丢弃，避免把 `magnet:?dn=xxx` 这种残缺串当链接展示。 */
  function parseMagnet(raw) {
    var qs = String(raw).replace(/^magnet:\?/i, '');
    // 站内 HTML 常把 & 写成 &amp;；URL 里也可能有 + 代替空格的写法
    qs = qs.replace(/&amp;/gi, '&');
    var hm = qs.match(MAGNET_HASH_RE);
    if (!hm) return null;
    var algo = hm[1].toLowerCase();
    var hash = hm[2].replace(/[^0-9a-z]/gi, '');
    if (!hash) return null;
    // v1(btih)：40 hex 或 32 base32；v2(btmh)：multihash，hex 长度可观
    var hashLen = hash.length;
    var short10 = hash.slice(0, 10).toUpperCase();

    // 逐段解析查询串（不用 URLSearchParams：jsdom/MV3 里都可用，
    // 但手写更稳 —— magnet 串常带未编码的 + 与裸空格，URL API 会抛）
    var parts = qs.split('&');
    var dn = '', trs = [], xl = 0, altSize = '';
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      var k = parts[i].slice(0, eq).toLowerCase();
      var v = parts[i].slice(eq + 1);
      if (k === 'dn') {
        if (!dn) dn = decodeParam(v);
      } else if (k === 'tr') {
        var t = decodeParam(v);
        if (t && trs.indexOf(t) < 0) trs.push(t);
      } else if (MAGNET_SIZE_KEYS.indexOf(k) >= 0) {
        var n = parseInt(v, 10);
        if (n > 0) {
          if (k === 'xl' || !xl) xl = n;          // xl 优先，其余只当兜底
          if (k !== 'xl' && !altSize) altSize = fmtBytes(n);
        }
      }
    }

    // 从 dn 里拆「体积 + 画质」：`xxx.1080p.4.2GB.mkv` 这种命名极常见
    var guess = dn ? guessFromName(dn) : { size: '', quality: '' };

    return {
      algo: algo,
      hash: hash,
      hashLen: hashLen,
      hashShort: short10,
      dn: dn,
      trs: trs,
      xl: xl,
      size: xl ? fmtBytes(xl) : (altSize || guess.size),
      quality: guess.quality,
      sizeFrom: xl ? 'xl' : (altSize ? 'param' : (guess.size ? 'dn' : ''))
    };
  }

  // magnet 串里的解码：站内常留着 %XX 和 +，逐一容错解码
  function decodeParam(v) {
    var s = String(v);
    try { s = decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { s = s.replace(/\+/g, ' '); }
    return s;
  }

  /* ---------------- 磁力反混淆（L3） ----------------
   * 很多站会故意把磁力「藏起来」，最典型的几种形态：
   *   ① 注入零宽/不可见字符（\u200b 之类）防正则；
   *   ② HTML 实体编码（magnet:&#x3F;xt=... 或 &amp;）；
   *   ③ 百分号编码（magnet%3A%3Fxt%3Durn%3Abtih%3A...）；
   *   ④ base64 包一层（data-* 属性里放 bWFnbmV0Oj8...，点击时 atob）；
   *   ⑤ 只给裸 hash（data-hash="a0b1…c8"）不带 magnet: 前缀。
   * 这里统一「解一层」，返回归一化后的可用链接串；解不出来返回 null。
   * 调用方（dispatchLink）据此重定型别再推给 pushLink。 */
  function b64decode(s) {
    try {
      var bin = (typeof atob === 'function')
        ? atob(s)
        : Buffer.from(s, 'base64').toString('binary');
      // thunder:// 变体是 base64("AA" + url + "ZZ")，去首尾不可打印包裹
      return bin.replace(/^[^ -~]+/, '').replace(/[^ -~]+$/, '');
    } catch (e) { return ''; }
  }
  function cleanupDecoded(d) {
    return String(d).replace(/[​﻿‌‍﻿\u200b\u200c\u200d\u2060\ufeff]/g, '').trim();
  }
  function decodeObfuscated(raw) {
    if (!raw) return null;
    var s = String(raw);
    // ① 去零宽/不可见字符，折叠多余空白
    s = s.replace(/[​﻿‌‍﻿\u200b\u200c\u200d\u2060\ufeff\u00a0\u2028\u2029]/g, '')
         .replace(/[ \t\r\n]+/g, ' ').trim();
    // ② HTML 实体解码（&#xHH; / &#DDD; / 命名实体）
    s = s.replace(/&(#x?[0-9a-f]+;|amp|lt|gt|quot|#39|apos)/gi, function (e, g) {
      try {
        if (g[0] === '#') {
          var code = (g[1] === 'x' || g[1] === 'X') ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
          return String.fromCodePoint(code);
        }
        return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[g.toLowerCase()] || e;
      } catch (err) { return e; }
    });
    // ③ 百分号解码（仅当确实含 %XX，避免误伤字面 %）
    if (/%[0-9a-f]{2}/i.test(s)) {
      try { var p = decodeURIComponent(s); if (p && p !== s) s = p; } catch (e) { /* 保留原串 */ }
    }
    // ④ base64 包一层（data-* / 正文 token）
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length >= 24) {
      var dec = cleanupDecoded(b64decode(s));
      if (dec && /^(magnet:|thunder:|ed2k:|https?:)/i.test(dec)) return dec;
    }
    // ⑤ 裸 hash（data-hash 之类）→ 补 magnet: 前缀
    var bare = s.match(/^(?:btih:)?([0-9a-f]{40}|[0-9a-f]{32})$/i);
    if (bare) return 'magnet:?xt=urn:btih:' + bare[1];
    // ⑥ 已是可用链接？
    if (/^(magnet:|thunder:|ed2k:)/i.test(s) || /\.torrent(\?|$)/i.test(s) || /^https?:/i.test(s)) return s;
    return null;
  }

  // 字节数 → 人类可读。用 1024 进制（与 BT 客户端口径一致）。
  // 整数不带小数（1KB 而不是 1.00KB）—— 磁力体积大多数是整数 MB/GB，带两位小数反而显得像估算值。
  function fmtBytes(n) {
    if (!(n > 0)) return '';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    if (i === 0) return v + u[0];
    if (v >= 100 || Math.abs(v - Math.round(v)) < 0.005) return Math.round(v) + u[i];
    return v.toFixed(v >= 10 ? 1 : 2) + u[i];
  }

  // 从文件名里猜体积与画质。只认「数字+单位」的独立词，避免把番号里的数字当体积。
  function guessFromName(name) {
    var s = String(name);
    var sz = s.match(/(\d+(?:\.\d+)?)\s?(TB|TiB|GB|GiB|MB|MiB)/i);
    var q = s.match(/(2160p|4k|1080p|720p|480p|360p)/i);
    return {
      size: sz ? (sz[1] + sz[2].toUpperCase()) : '',
      quality: q ? q[1].toLowerCase() : ''
    };
  }

  function shortLabel(d) {
    if (d.type === 'magnet') {
      var m = d.magnet;
      var h = m && m.hashShort ? m.hashShort : '';
      var name = d.name || '';
      if (name) return (h ? h + ' · ' : '') + name;
      return h ? ('磁力 ' + h + '…') : d.raw.slice(0, 40);
    }
    if (d.type === 'ed2k' || d.type === 'thunder') {
      var dm = d.raw.match(/(?:ed2k|thunder):\/\/\|file\|([^|]+)/i);
      return dm ? dm[1] : d.raw.slice(0, 40);
    }
    if (d.type === 'torrent') {
      var seg = d.raw.split('/').pop().split('?')[0];
      return decodeParam(seg);
    }
    try { var u = new URL(d.raw, location.href); return (d.pan ? d.pan + ' · ' : '') + decodeURIComponent(u.pathname.split('/').pop() || u.hostname); }
    catch (e) { return d.raw.slice(0, 40); }
  }

  /* 两条同 infohash 的磁力合并成一条（L4）。
   * 合并策略：tr 取并集；dn 取「更长」的那个（更完整的文件名通常信息更多）；
   * el 保留最先出现的（那是页面里真正可点的元素，用于高亮标记）。 */
  function mergeMagnet(keep, other) {
    var km = keep.magnet, om = other.magnet;
    var i;
    for (i = 0; i < om.trs.length; i++) {
      if (km.trs.indexOf(om.trs[i]) < 0) km.trs.push(om.trs[i]);
    }
    if (om.dn && om.dn.length > (km.dn || '').length) {
      km.dn = om.dn;
      keep.name = om.dn;
    }
    if (!km.xl && om.xl) { km.xl = om.xl; km.sizeFrom = 'xl'; }
    if (!keep.size && other.size) keep.size = other.size;
    if (!keep.quality && other.quality) keep.quality = other.quality;
    // raw 也跟着更新，保证「复制」出去的是信息最全的那条
    keep.raw = buildMagnetRaw(km);
    keep.label = shortLabel(keep);
  }

  // 由解析结果重建一条规范磁力串（归并后 tr 更全，复制出去才对）
  function buildMagnetRaw(m) {
    if (!m || !m.hash) return '';
    var s = 'magnet:?xt=urn:' + m.algo + ':' + m.hash;
    if (m.dn) s += '&dn=' + encodeURIComponent(m.dn);
    if (m.xl) s += '&xl=' + m.xl;
    for (var i = 0; i < m.trs.length && i < 8; i++) s += '&tr=' + encodeURIComponent(m.trs[i]);
    return s;
  }

  /* L4：按 infohash 归并后的最终排序。
   * 分层（每组内保持探测顺序，稳定）：
   *   0 有体积且有画质 —— 用户最想先看到的
   *   1 有体积
   *   2 有画质
   *   3 其余（网盘 / 电驴 / 迅雷 / 种子 / 无信息的磁力）
   * 同层内：磁力优先于其它类型（磁力是主诉求）。 */
  function magnetRank(d) {
    if (d.type === 'magnet') {
      if (d.size && d.quality) return 0;
      if (d.size) return 1;
      if (d.quality) return 2;
      return 3;
    }
    if (d.size && d.quality) return 4;
    if (d.size) return 5;
    if (d.quality) return 6;
    return 7;
  }
  function sortLinks(arr) {
    var idx = new Map();
    for (var i = 0; i < arr.length; i++) idx.set(arr[i], i);
    arr.sort(function (a, b) {
      var ra = magnetRank(a), rb = magnetRank(b);
      if (ra !== rb) return ra - rb;
      return idx.get(a) - idx.get(b);
    });
  }

  /* 对外只暴露一个冻结的命名空间，避免调用方互相改到内部状态。
     注意 MAGNET_RE 等正则**是共享对象**（content.js 会用 lastIndex 复位再 exec），
     这与搬迁前的行为一致 —— 别改成每次新建，否则 B64_TOKEN_RE 之类的大范围扫描
     会失去「同一份 lastIndex 契约」的可预期性。 */
  var API = Object.freeze({
    // 常量
    PAN_HOSTS: PAN_HOSTS,
    URL_STOP: URL_STOP,
    MAGNET_RE: MAGNET_RE,
    ED2K_RE: ED2K_RE,
    THUNDER_RE: THUNDER_RE,
    TORRENT_RE: TORRENT_RE,
    MAGNET_PCT_RE: MAGNET_PCT_RE,
    B64_TOKEN_RE: B64_TOKEN_RE,
    SIZE_RE: SIZE_RE,
    QUALITY_RE: QUALITY_RE,
    MAGNET_HASH_RE: MAGNET_HASH_RE,
    MAGNET_SIZE_KEYS: MAGNET_SIZE_KEYS,
    // 纯函数
    hostOf: hostOf,
    panOf: panOf,
    parseMagnet: parseMagnet,
    decodeParam: decodeParam,
    decodeObfuscated: decodeObfuscated,
    b64decode: b64decode,
    cleanupDecoded: cleanupDecoded,
    fmtBytes: fmtBytes,
    guessFromName: guessFromName,
    shortLabel: shortLabel,
    buildMagnetRaw: buildMagnetRaw,
    magnetRank: magnetRank,
    sortLinks: sortLinks,
    mergeMagnet: mergeMagnet
  });

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  try { if (typeof globalThis !== 'undefined') globalThis.SF_MAGNET = API; } catch (e) { }
})();
