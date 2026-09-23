/* SiteFilter —— 磁力 / 下载链接的解析与格式化核心。
 *
 * 为什么单独成文件：这部分逻辑**全是纯函数**（不碰 document、不碰 chrome.storage、
 * 不碰 UI 状态），却占了 content.js 里很大一块，而且是最容易「静默出错」的一块 ——
 * 字段口径（xl 优先于 DOM 文本）、同 infohash 归并、分层排序，错一点用户只会觉得
 * 「少看到一条」或「看到重复的一条」，不会报错。抽出来以后它可以被独立单测，
 * 也给后续「让设置页也能解析磁力」留了口子。
 *
 * 边界：
 *   在本模块 —— 文本 / 链接串 ⇒ 候选与结构化数据（parseMagnet / decodeObfuscated /
 *              probeBodyMagnets / fmtBytes …）
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

  /* 「隐形空白」：JS 的 \s 把它们都算作空白，站点却常拿它们做反抓取 —— 插进
     infohash 中间（U+FEFF 是复制粘贴带出来的 BOM 型字符，U+00A0 是 `&nbsp;`，
     U+2000–U+200A / U+3000 是排版空格）。URL_STOP 里含 \s，于是 MAGNET_RE
     会在它们处**截断**；而 parseMagnet 只要求「hash 非空」，所以半截 hash
     （实测 8 位）会被当合法磁力收下 —— 用户在列表里看到一条**下不动的链接**，
     页面上没有任何提示。实测会截断的：U+FEFF / U+00A0 / U+3000 / U+2009。 */
  var INVISIBLE_WS = '\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  var INVISIBLE_WS_RE = new RegExp('[' + INVISIBLE_WS + ']', 'g');
  /* 截断点之后、到下一个「真分隔符」为止的尾巴。两处讲究：
     · 刻意不用 \s —— 尾巴里可能还夹着更多隐形空白，得一起带走；
     · 遇到新链接的协议头就停（(?!…) 那段）—— 否则 `<a>A</a>&nbsp;<a>B</a>`
       这种「两条链接只隔一个 &nbsp;」的页面会把 B 整条吞进 A 的尾巴里，
       本来能找到的两条一起弄丢。 */
  var URL_TAIL_RE = new RegExp(
    '[' + INVISIBLE_WS + ']+((?:(?!(?:magnet|ed2k|thunder|https?|ftp):)'
    + '[0-9A-Za-z%._~+\\-=&/?:])+)');
  /* hash 长度像不像一个真正的 infohash。**只当修复的触发条件，不做过滤用** ——
     现在收下的任何长度都照旧收下（不改既有行为），只是「长度不像」时才试着往后接。
     v1(btih)：40 hex 或 32 base32；v2(btmh)：multihash，hex 且 ≥64 位、偶数长度。 */
  var HASH_V1_HEX_RE = /^[0-9a-f]{40}$/i;
  var HASH_V1_B32_RE = /^[a-z2-7]{32}$/i;

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

  /* hash 长度是否可疑（判据见上面 HASH_V1_*_RE 的注释）。 */
  function hashLooksTruncated(m) {
    if (!m || !m.hash) return false;
    var h = m.hash;
    if (m.algo === 'btmh') {
      return !(h.length >= 64 && h.length % 2 === 0 && /^[0-9a-f]+$/i.test(h));
    }
    return !(HASH_V1_HEX_RE.test(h) || HASH_V1_B32_RE.test(h));
  }

  /* 正文磁力探测：把「被隐形空白截断」的磁力链补回完整形态。一次返回两样东西 ——
       list    最终候选（每处一到一条，被截断的已接回完整）
       masked  把「已接进候选的尾巴」挖成空格的文本，供后面的 base64 / 裸 hash
               扫描使用。不挖会怎样：那段尾巴（去掉前 8 位后的 32 位 hex）仍然
               躺在正文里，于是被当成一个独立的「32 位裸 hash」收下 —— 一条链接
               变成两条，其中一条 hash 不完整、点开下不动。

     为什么不干脆把这些字符从 URL_STOP 的排除集里去掉：`&nbsp;` 本来就是 HTML 里
     合法的分隔符（这正是它的用途）。一旦不再截断，`链接 + &nbsp; + 另一条链接`
     会被粘成一条坏串（把本来能找到的两条一起弄丢），`链接 + &nbsp; + 正文`
     也会把正文吃进 hash。所以这里**只在严格匹配已经解析出可疑 hash 时**才尝试
     跨越，且接出来的候选必须自身解析出像样的 hash 才采用 —— 拿不准就保持原样。
     好处是「本来就能解析的链接」行为一字不变（零回归）。

     每处截断只出一条：修复成功就用完整串**替换**残串 —— 否则同一条链接会在列表里
     出现两张卡片，其中一张还下不动。

     只救 infohash 被截断：那会让整条链接下不动。dn / tr 里夹了隐形空白只是参数
     残缺（客户端会忽略），没有「长度」这种廉价判据，不在这里猜。 */
  function probeBodyMagnets(text) {
    var out = [], m;
    if (!text) return { list: out, masked: '' };
    var masked = text;
    MAGNET_RE.lastIndex = 0;
    while ((m = MAGNET_RE.exec(text)) !== null) {
      var cand = m[0];
      var p = parseMagnet(cand);
      if (p && hashLooksTruncated(p)) {
        var tm = URL_TAIL_RE.exec(text.slice(m.index + cand.length));
        if (tm) {
          var joined = (cand + tm[1]).replace(INVISIBLE_WS_RE, '');
          var jp = parseMagnet(joined);
          if (jp && !hashLooksTruncated(jp)) cand = joined;
        }
      }
      out.push(cand);
      if (cand !== m[0]) {
        // 尾巴已被接进候选：① 跳过它，别再从里面扫出个「半截」；
        // ② 在 masked 里挖空（等长空格替换，所以下标仍与 text 对齐）。
        // tm[0] = 隐形空白 + 尾巴（URL_TAIL_RE 没有 g 标志，lastIndex 不会动，
        // 别拿它当长度 —— 那样挖空长度恒为 0，等于没挖）
        var tailStart = m.index + m[0].length;
        var tailEnd = tailStart + tm[0].length;
        MAGNET_RE.lastIndex = tailEnd;
        masked = masked.slice(0, tailStart)
          + masked.slice(tailStart, tailEnd).replace(/./g, ' ') + masked.slice(tailEnd);
      }
    }
    return { list: out, masked: masked };
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
    mergeMagnet: mergeMagnet,
    hashLooksTruncated: hashLooksTruncated,
    probeBodyMagnets: probeBodyMagnets
  });

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  try { if (typeof globalThis !== 'undefined') globalThis.SF_MAGNET = API; } catch (e) { }
})();
