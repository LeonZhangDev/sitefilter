/* =============================================================
 * SiteFilter —— 内容脚本
 * 职责：识别页面卡片 → 提取女优/标签/标题 → 应用规则 → 渲染悬浮球面板
 * 数据全部存于 chrome.storage.local，不上传任何信息。
 * ============================================================= */
(function () {
  'use strict';

  if (window.__SITEFILTER_LOADED__) return;
  window.__SITEFILTER_LOADED__ = true;

  var DATA_KEY = 'sf_data_v1';
  var SCHEMA_VERSION = 6;   // 数据结构版本：改结构时 +1，并在 migrate() 里补一步
  var DEBUG = false;
  function log() { if (DEBUG) console.log.apply(console, ['[SF]'].concat([].slice.call(arguments))); }

  /* ---------------- 本地错误日志（环形缓冲，最多 200 条） ----------------
   * 过去所有异常都被 `catch (e) {}` 静默吞掉，「功能没反应」时无从排查。
   * 现在统一走 logErr()，攒够 5 秒落盘一次，设置页「错误日志」可查看/导出。 */
  var ERR_MAX = 200;
  var errRing = [];
  var errTimer = null;
  function logErr(where, e) {
    try {
      errRing.push({
        t: Date.now(),
        w: String(where || ''),
        m: String((e && (e.message || e)) || 'unknown').slice(0, 300),
        s: location.hostname
      });
      if (errRing.length > ERR_MAX) errRing.shift();
      if (DEBUG) console.warn('[SF]', where, e);
      if (!errTimer) errTimer = setTimeout(persistErr, 5000);
    } catch (_) { }
  }
  function persistErr() {
    errTimer = null;
    if (!errRing.length) return;
    var delta = errRing.splice(0, errRing.length);
    try {
      cfGet(function (o) {
        var d = o || {};
        d.errLog = (d.errLog || []).concat(delta);
        if (d.errLog.length > ERR_MAX) d.errLog = d.errLog.slice(-ERR_MAX);
        var pl = {}; pl[DATA_KEY] = d;
        cfSet(pl, function () { });
      });
    } catch (e) { }
  }

  /* ---------------- 默认配置 ---------------- */
  var DEFAULT_SETTINGS = {
    enabled: true,        // 总开关
    sfw: false,           // 缩略图模糊
    onlyFav: false,       // 只看收藏
    onlyFavCode: false,   // 只看番号收藏
    boss: false,          // 老板键
    showBall: true,       // 显示悬浮球
    pinHighlight: true,   // 高亮置顶
    markSeen: true,       // 标记已看
    favBtn: true,         // 卡片 hover 显示 ♥ 番号收藏按钮
    probeLinks: true,     // 下载链接探测
    probeMark: true,      // 页面内给下载链接加标记
    probeAnySite: true,   // 非监管站点也启用探测
    hlColor: '#00e5ff',   // 默认高亮色
    ball: { right: 24, bottom: 24 },
    ballLock: false,        // 锁定悬浮球位置：锁定后拖不动（防误挪），点击仍能开合面板
    onboarded: false,       // 是否已看过新手引导
    lastRecDay: '',         // 上次看过推荐页的日期（用于每日自动推荐）
    showWhy: true,          // 悬停卡片显示「为什么被处理」浮层
    watchBtn: true,         // 卡片 hover 显示 ⏳ 待看按钮
    softBlock: false,       // 已废弃：由 blockDisplay 取代（保留仅为兼容旧数据，migrate 会读一次）
    blockDisplay: 'placeholder', // 屏蔽后显示方式：'hide' 完全隐藏 / 'placeholder' 保留占位（默认）/ 'soft' 灰化遮罩
    previewMode: false,     // 规则预览：命中屏蔽不真正隐藏，只描边提示（确认无误杀后再关掉）
    peekHours: 24,          // 「仍然查看」放行有效期（小时，可调）
    firstMatchWins: false,  // 规则按顺序、首个命中生效（默认 false = 屏蔽优先于收藏/高亮）
    codeSearchBtns: true,   // 番号处显示多站直达链接
    keys: {},               // 自定义键位（{} = 全用 DEFAULT_KEYS；载入时归一化成完整表）
    autoSeen: true,         // 打开详情页时自动把该番号标为已看（不用手动点）
    auditWarn: true,        // 建屏蔽规则前先估算影响面，过宽时先确认
    autoBackup: false,      // 每天自动备份整库到下载目录（实际执行在 background.js）
    backupKeep: 7,          // 自动备份快照轮换份数：0 = 不轮换（无限累积）
    backfill: 'off',        // 番号站数量补足：'off'（默认，绝不联网）/ 'same'（补齐到原始数量）/ 正整数（指定数量）
                            // ⚠ 这是全库唯一会发网络请求的开关，且仅对 JavDB580 生效（见 doBackfill 注释）
    magnetAction: 'copy',   // 磁力行操作：'copy'（默认，仅复制）/ 'open'（仅用本机下载工具打开）/ 'both'（复制+打开）
    magnetClient: ''        // 自定义下载器 exe 绝对路径；留空=唤起系统默认（Tier A），
                            // 填了=经本机桥用指定 exe 打开（Tier B，需装 native-host）
  };

  // 「仍然查看」放行有效期（可调：设置页「软屏蔽 → 放行有效期」）
  function peekTtl() { return Math.max(1, Number(S.settings.peekHours) || 24) * 3600 * 1000; }

  /* ---------------- 可自定义快捷键 ----------------
   * 设置页「快捷键」卡片里改；存 settings.keys，缺项回落到默认值。
   * 分两组：全局键（Alt + 键）与面板内键（单键），组内重复会在设置页提示。 */
  var DEFAULT_KEYS = {
    panel: 'f',    // Alt+F 展开 / 收起面板
    sfw: 's',      // Alt+S SFW 缩略图模糊
    boss: 'b',     // Alt+B 老板键
    lock: 'l',     // Alt+L 锁定 / 解锁悬浮球位置
    prev: 'k',     // 上一条
    next: 'j',     // 下一条
    block: 'b',    // 屏蔽当前卡片的全部女优
    fav: 'f',      // 收藏
    hl: 'h',       // 高亮
    watch: 'p',    // 加入待看
    open: 'enter'  // 打开链接
  };
  var KEY_SPECIAL = ['enter', 'space', 'escape', 'tab', 'backspace', 'delete',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown'];

  function isKeyName(v) {
    v = String(v || '').toLowerCase();
    if (!v) return false;
    if (/^[a-z0-9]$/.test(v)) return true;
    if (/^f([1-9]|1[0-2])$/.test(v)) return true;
    return KEY_SPECIAL.indexOf(v) !== -1;
  }

  // 把存下来的键位洗成合法值：非法 / 缺失一律回落到默认，避免出现"按什么都没反应"
  function normKeys(raw) {
    var out = {};
    for (var k in DEFAULT_KEYS) {
      var v = (raw && raw[k] != null && raw[k] !== '') ? String(raw[k]).toLowerCase() : DEFAULT_KEYS[k];
      out[k] = isKeyName(v) ? v : DEFAULT_KEYS[k];
    }
    return out;
  }

  function keyOf(name) {
    var k = (S.settings && S.settings.keys) || {};
    var v = k[name];
    if (v == null || v === '') v = DEFAULT_KEYS[name] || '';
    return String(v).toLowerCase();
  }

  // KeyboardEvent.key → 可配置的小写名（' ' → space、'Esc' → escape …）
  function normKey(k) {
    k = String(k == null ? '' : k);
    if (k === ' ' || k === 'Spacebar') return 'space';
    if (k === 'Esc') return 'escape';
    return k.toLowerCase();
  }

  // 提示文案里的按键显示（j → J，enter → Enter）
  function keyLabel(name) {
    var k = keyOf(name);
    if (k.length === 1) return k.toUpperCase();
    return k.charAt(0).toUpperCase() + k.slice(1);
  }

  /* ---------------- 站点模板：全站唯一事实来源 ----------------
   * 新增/修改一个站点只改这一张表。下面的 DEFAULT_SITES / KNOWN_SELECTORS /
   * SELECTOR_TEMPLATES / CODE_SITES / 维度识别规则 全部由它派生。
   *
   *   id       唯一标识（进 sites 用，迁移时按 id 去重补新站）
   *   name     显示名
   *   pattern  监管站点匹配规则；有值才可能进 DEFAULT_SITES
   *   host     主机名正则，用于按域名取模板
   *   sel      候选卡片选择器（按优先级依次尝试）
   *   tpl      设置页「套用预置模板」用的主选择器；留空 = 不出现在模板下拉
   *   enabled  是否默认进监管列表（false = 只贡献选择器，需用户手动添加）
   *   sbtn     番号多站直达的按钮短名；配合 search 使用
   *   search   番号搜索 URL 模板（{q} 为番号占位）；有值才进多站直达
   *   code     是否番号体系（false 时只从标题里猜番号，不从链接路径猜）
   *   rowMode  列表是「表格行 / 无图条目」（论坛类），需要另一套识别与可见性判定
   *   dims     该站专属的维度识别规则，先于全局 LINK_KINDS 匹配
   *   bf       是否支持「数量补足」（列表页用 ?page=N 翻页）。**这是全库唯一会联网的
   *            功能的放行名单**，缺省 false。标记前必须有**真机抓取实证**（见 doBackfill
   *            上方那段实测记录）—— 宁可功能不做，也不能赌错参数去敲人家的站。 */
  var SITE_TEMPLATES = [
    {
      id: 's_javbus', name: 'JavBus', pattern: '*://*.javbus.com/*', host: /javbus/i,
      sel: ['.item', 'a.movie-box', '.movie-box'], tpl: '.item', tplTest: 'javbus', enabled: true,
      sbtn: 'Bus', search: 'https://www.javbus.com/{q}', code: true
    },
    {
      id: 's_xchina', name: 'xchina', pattern: '*://*.xchina.co/*', host: /xchina/i,
      sel: ['.item', '.video-item', '.video-list li', '.card', 'li.video'], tpl: '.item', tplTest: 'xchina', enabled: true,
      sbtn: 'XC', search: 'https://xchina.co/search/{q}', code: false
    },
    {
      id: 's_javdb', name: 'JavDB', pattern: '*://*.javdb.com/*', host: /javdb/i,
      sel: ['.item', 'a.box', '.movie-box', '.grid-item'],       tpl: '.item', tplTest: 'javdb', enabled: true, mirror: 'javdb',
      sbtn: 'DB', search: 'https://javdb.com/search?q={q}&f=all', code: true
    },
    {
      id: 's_javdb571', name: 'JavDB 镜像', pattern: '*://*.javdb571.com/*', host: /javdb571/i,
      sel: ['.item', 'a.box', '.movie-box', '.grid-item'], enabled: true, mirror: 'javdb', code: true
    },
    {
      id: 's_javdb580', name: 'JavDB 镜像580', pattern: '*://*.javdb580.com/*', host: /javdb580/i,
      sel: ['.item', 'a.box', '.movie-box', '.grid-item'], enabled: true, mirror: 'javdb', bf: true,
      sbtn: '580', search: 'https://javdb580.com/search?q={q}&f=all', code: true
    },
    {
      id: 's_pornhub', name: 'PornHub', pattern: '*://*.pornhub.com/*', host: /pornhub/i,
      sel: ['li.pcVideoListItem', '.videoBox', '#videoSearchResult li', '.phimage', '.item'],
      tpl: 'li.pcVideoListItem', tplTest: 'pornhub', enabled: true, code: false,
      sbtn: 'PH', search: 'https://www.pornhub.com/video/search?search={q}',
      idFrom: /[?&]viewkey=([0-9a-z]+)/i, idPrefix: 'ph',
      dims: [
        { kind: 'actress', href: /(\/pornstar\/|\/pornstars\/|\/models?\/|pornstar=)/i, cls: /(pornstar|usernameBadge)/i },
        { kind: 'maker', href: /(\/channels?\/|\/channel\/)/i, cls: /(channel)/i },
        { kind: 'tag', href: /(\/categories\/|\/category\/|\/tags?\/|\/video\?c=)/i, cls: /(category|tag)/i }
      ]
    },
    {
      id: 's_youporn', name: 'YouPorn', pattern: '*://*.youporn.com/*', host: /youporn/i,
      // 真实卡片是 <article class="video-box pc js_video-box js-pop">（2026-09-22 实测搜索页 33 个）。
      // 注意：标签名是 <article> 不是 <li>，class 是 video-box（连字符）不是 videoBox（驼峰）。
      sel: ['article.video-box', '.video-box', 'li.video', '.item', '.card'],
      tpl: 'article.video-box', tplTest: 'youporn', enabled: true, code: false,
      sbtn: 'YP', search: 'https://www.youporn.com/search/?query={q}',
      idFrom: /\/watch\/(\d+)/i, idPrefix: 'yp',
      dims: [
        { kind: 'actress', href: /(\/pornstar\/|\/pornstars\/|\/models?\/)/i, cls: /(pornstar|model)/i },
        { kind: 'maker', href: /(\/channels?\/)/i, cls: /(channel)/i },
        { kind: 'tag', href: /(\/categories\/|\/category\/|\/tags?\/)/i, cls: /(category|tag)/i }
      ]
    },
    {
      id: 's_xsijishe', name: 'xsijishe（求出处）', pattern: '*://*.xsijishe.net/*', host: /xsijishe/i,
      // Discuz! X3.4 + nex_* 主题：帖子行是**纯 div**（id=normalthread_xxx / stickthread_xxx），
      // 整页 <tbody> 只有 1 个（工具栏），所以 '#threadlist tbody tr' 只命中 1 个、不能用。
      // 2026-09-22 实测 forum-40-1.html：#threadlist div[id^="normalthread_"] = 26、
      // div[id^="stickthread_"] = 10（合计 36，行容器为 .nex_forum_lists）。
      sel: ['#threadlist div[id^="normalthread_"]', '#threadlist div[id^="stickthread_"]',
        '#threadlist .nex_forum_lists', '.nex_forum_lists'],
      tpl: '#threadlist div[id^="normalthread_"], #threadlist div[id^="stickthread_"]',
      tplTest: 'xsijishe', enabled: true, code: false, rowMode: true,
      idFrom: /(?:thread-|tid=)(\d+)/i, idPrefix: 'dz',
      dims: [
        { kind: 'tag', href: /(forum-|forumdisplay|mod=forumdisplay)/i, cls: /(forum)/i },
        { kind: 'actress', href: /(space-uid-|mod=space|uid=)/i, cls: /(authi|author)/i }
      ]
    },
    // 以下站点不进监管列表，只为「用户手动添加后立刻能识别」而预置选择器
    {
      id: 't_avmoo', name: 'AVMOO / AVSOX', host: /(avmoo|avsox|airav|busjav)/i,
      sel: ['.item', '.movie-box', 'a.movie-box'], tpl: '.item', tplTest: 'avmoo', enabled: false
    },
    {
      id: 't_forum', name: '色花堂 / 高清', host: /(sehuatang|hdsky|t66y|sexinsex)/i,
      sel: ['.item', '.card', 'li.media', 'tbody tr'], tpl: '.card', tplTest: 'sehuatang', enabled: false
    },
    {
      id: 't_javlib', name: 'JavLibrary', host: /(jav321|javlibrary|freejavbt|javhoo|javgg)/i,
      sel: ['.item', '.movie-box', '.grid-item', '.card', '.video'], tpl: '.item', tplTest: 'javlibrary', enabled: false
    }
  ];

  // 由模板派生：默认监管站点
  var DEFAULT_SITES = SITE_TEMPLATES.filter(function (t) { return t.enabled && t.pattern; })
    .map(function (t) {
      return { id: t.id, pattern: t.pattern, enabled: true, selector: '', note: t.name };
    });

  // 由模板派生：已知站点的卡片选择器（按 hostname 匹配，命中失败会自动走通用识别）
  var KNOWN_SELECTORS = SITE_TEMPLATES.filter(function (t) { return t.sel && t.sel.length; })
    .map(function (t) { return { test: t.host, sel: t.sel }; });

  // 由模板派生：设置页「套用预置模板」用（options.js 的 TPL_SELECTORS 是同一份数据的副本，
  // 由 _test_sites.js 断言两边一致）
  // 由模板派生（tplTest 是设置页用来匹配站点 pattern 的关键字，必须显式给 ——
  // 不能从 host 正则里截，多分支正则会截出 '(avmoo' 这种永远匹配不上的值）
  var SELECTOR_TEMPLATES = SITE_TEMPLATES.filter(function (t) { return t.tpl; })
    .map(function (t) { return { name: t.name, test: t.tplTest || '', sel: t.tpl }; });

  // 元数据链接识别（全局兜底）：顺序敏感，命中即停。分别对应 类别/片商/系列/导演/女优
  var LINK_KINDS = [
    { kind: 'series', href: /(\/series\/|series=)/i, cls: /(series)/i },
    { kind: 'maker', href: /(studio|maker|label|company|brand|vendor|\/makers\/|\/studios\/)/i, cls: /(studio|maker|label|brand)/i },
    { kind: 'director', href: /(director|監督|监督|\/directors\/)/i, cls: /(director)/i },
    { kind: 'tag', href: /(genre|category|\/tags?\/|tag=|keyword)/i, cls: /(genre|category|tags?\b)/i },
    { kind: 'actress', href: /(\/star\/|\/star\b|actress|actor|\/actors\/|\/stars\/|\/model\/|performer|\/cast\/|av-star|star=)/i, cls: /(star|actor|actress|model|performer)/i }
  ];

  /* 按主机名取模板 / 取该站生效的维度规则（站点专属 dims 优先，再回落全局）。
     结果按 host 缓存，避免每轮 pass 反复拼数组。 */
  var _tplCache = {};
  /* 按主机名找站点模板。
   * ⚠️ 必须「先精确、后模糊」两级匹配，不能只按 SITE_TEMPLATES 的书写顺序取首个 host 命中：
   *   s_javdb.host = /javdb/i 排在 s_javdb580.host = /javdb580/i 之前，
   *   顺序首匹配会把 javdb580.com / javdb571.com 全部误判成 s_javdb
   *   （连带影响：cardSelOf 拿到错的选择器、镜像组归错、panel 站点名显示错、
   *     以及番号站数量补足因为容器选择器不对而完全失效）。
   * 第一级：pattern 直接匹配 location.href（`*://*.javdb580.com/*` 只认它自己）；
   * 第二级：退回 host 正则顺序匹配，保留对未登记子域/镜像的容错。 */
  function templateForHost(host) {
    host = String(host || '');
    if (_tplCache[host] !== undefined) return _tplCache[host];
    var href = '';
    try { href = (typeof location !== 'undefined' && location.href) || ''; } catch (e) { href = ''; }
    var hit = null;
    if (href) {
      for (var p = 0; p < SITE_TEMPLATES.length; p++) {
        var t0 = SITE_TEMPLATES[p];
        if (!t0 || !t0.pattern) continue;
        try {
          if (globToRegex(t0.pattern).test(href)) { hit = t0; break; }
          // 与 matchSite 同一套裸域兼容：`*://*.x.com/*` 也要认 https://x.com/
          if (/^\*:\/\/\*\./.test(t0.pattern) &&
            globToRegex(t0.pattern.replace('*://*.', '*://')).test(href)) { hit = t0; break; }
        } catch (e) { /* 非法 pattern 跳过 */ }
      }
    }
    if (!hit) {
      for (var i = 0; i < SITE_TEMPLATES.length; i++) {
        if (SITE_TEMPLATES[i].host.test(host)) { hit = SITE_TEMPLATES[i]; break; }
      }
    }
    _tplCache[host] = hit;
    return hit;
  }
  var _kindsCache = {};
  function linkKindsFor(host) {
    host = String(host || '');
    if (_kindsCache[host]) return _kindsCache[host];
    var tpl = templateForHost(host);
    var list = (tpl && tpl.dims) ? tpl.dims.concat(LINK_KINDS) : LINK_KINDS;
    _kindsCache[host] = list;
    return list;
  }

  // 不同维度的默认作用范围
  var SCOPE_OF = {
    actress: 'actress', tag: 'tag', maker: 'maker', series: 'series',
    director: 'director', keyword: 'title', code: 'title'
  };

  var COLORS = ['#00e5ff', '#ff4d6d', '#7c5cff', '#22c55e', '#ff9f1c', '#ffc93c'];

  /* ---------------- 下载链接探测 ---------------- */
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

  /* ---------------- 运行时状态 ---------------- */
  var S = { settings: {}, sites: [], rules: [], seen: {}, favCodes: {}, discovered: {}, groups: [], statsLog: {}, watchlist: {}, cooc: {}, peeks: {}, errLog: [], shopMarks: {} };

  /* 增量提取缓存：同一张卡片只跑一次 extract()（无限滚动追加卡片时只算新的）
     注意：缓存键是卡片元素，但卡片内容可能被就地更新（懒加载标题 / 状态角标 / 换图），
     所以额外存一个「轻量签名」，签名变了就重新提取，避免拿到过期文本。 */
  var extractCache = new WeakMap();
  var extractSig = new WeakMap();
  // 签名必须「排除我们自己注入的按钮（♥ / ⏳ / 仍然查看）」——
  // 否则每轮 pass 都会因为按钮还在卡片里而签名漂移，缓存永远命中不了。
  var OWN_BTN_SEL = ':scope > .cf-favbtn, :scope > .cf-watchbtn, :scope > .cf-peekbtn';
  function cardSig(card) {
    try {
      var own = card.querySelectorAll(OWN_BTN_SEL);
      var n = card.childElementCount - own.length;
      var t = (card.textContent || '').length;
      for (var i = 0; i < own.length; i++) t -= (own[i].textContent || '').length;
      return n + ':' + t;
    } catch (e) { return ''; }
  }
  function invalidateExtract() { extractCache = new WeakMap(); extractSig = new WeakMap(); }

  /* 键盘导航当前卡片下标 */
  var navIdx = -1;

  /* 番号多站直达：纯本地拼 URL，零网络请求。由站点模板的 sbtn + search 派生 */
  var CODE_SITES = SITE_TEMPLATES.filter(function (t) { return t.sbtn && t.search; })
    .map(function (t) { return { n: t.sbtn, tpl: t.search }; });
  function codeSearchBtns(code) {
    if (!code || S.settings.codeSearchBtns === false) return '';
    return CODE_SITES.map(function (cs) {
      var u = cs.tpl.replace('{q}', encodeURIComponent(code));
      return '<a class="cf-mini cf-gos" href="' + escapeHtml(u) + '" target="_blank" rel="noopener" ' +
        'title="在 ' + cs.n + ' 搜索 ' + escapeHtml(code) + '">' + cs.n + '</a>';
    }).join('');
  }

  /* ---------------- 多站比价（建议 ②） ----------------
   * 为什么不做「自动抓各站价格/是否有货」：
   *   四个番号站里 JavDB 被 Cloudflare 挑战挡、JavBus 302 到年龄门、JavDB571 直接连不上，
   *   只有 JavDB580 能返回正常 HTML。再加上跨域限制，扩展内无法稳定地"替你问一圈"。
   *   硬做只会得到一个经常失效、还容易被反爬盯上的功能。
   *
   * 所以这里做的是诚实版：
   *   ① 一键四站齐开 —— 让浏览器替你开（带你的登录态与代理，不受扩展 CORS 限制）
   *   ② 本地标记 —— 你在哪几个站看到过 / 哪个站有磁力，勾一下记进 S.shopMarks，
   *      累积成徽标。下次再遇到同一个番号，一眼就知道"上次在 580 有货"。
   * 零网络请求，纯本地累积。 */
  var SHOP_FIELDS = [
    ['has', '有资源', '#7ee0a5'],
    ['magnet', '有磁力', '#9beaff'],
    ['hd', '高清', '#ffc93c'],
    ['fav', '想要', '#ff4d6d']
  ];
  function shopMarkOf(code) {
    if (!code) return null;
    return (S.shopMarks || {})[code] || null;
  }
  // 该番号被打过标记的站点数（用于列表徽标）
  function shopMarkCount(code) {
    var m = shopMarkOf(code);
    if (!m) return 0;
    var n = 0;
    CODE_SITES.forEach(function (cs) {
      var e = m[cs.n];
      if (e && SHOP_FIELDS.some(function (f) { return e[f[0]]; })) n++;
    });
    return n;
  }
  function openAllSites(code) {
    if (!code) return;
    // 逐个 open 而不是一次性开 4 个 —— 浏览器对单次手势内的多次 open 通常会拦掉后面的，
    // 所以第一个立刻开，其余用短延时间隔（多数浏览器会放行）。
    var list = CODE_SITES.slice();
    list.forEach(function (cs, i) {
      var u = cs.tpl.replace('{q}', encodeURIComponent(code));
      if (i === 0) window.open(u, '_blank', 'noopener');
      else setTimeout(function () { try { window.open(u, '_blank', 'noopener'); } catch (e) { } }, i * 120);
    });
    flashBall('已打开 ' + list.length + ' 个站点');
  }
  // 切换某个站点上的某个标记
  function toggleShopMark(code, siteKey, field) {
    if (!code || !siteKey || !field) return;
    S.shopMarks = S.shopMarks || {};
    var m = S.shopMarks[code] || (S.shopMarks[code] = {});
    var e = m[siteKey] || (m[siteKey] = {});
    if (e[field]) delete e[field]; else e[field] = 1;
    // 全空的站点条目直接删掉，避免存储里堆一堆空对象
    if (!SHOP_FIELDS.some(function (f) { return e[f[0]]; })) delete m[siteKey];
    if (!Object.keys(m).length) delete S.shopMarks[code];
    saveState({ shopMarks: S.shopMarks });
    // 列表里的「比价 N」徽标要跟着变（浮层是独立节点，重绘它不会顺带更新列表）
    if (activeTab === 'favcode') renderFavCodes();
  }
  /* 镜像站点归一：javdb.com / javdb571.com / javdb580.com 是同一个站的三个域名。
     发现库按「来源组」记而不是按域名记 —— 否则同一个演员在三个镜像上逛一圈，
     会被当成三个来源，出现次数 n 也会三倍膨胀，进而影响规则体检的「命中面」估算
     和候选规则的覆盖率计算。n 本身的含义（出现次数）不变，只是多了按组拆分的账。 */
  var MIRROR_GROUPS = (function () {
    var m = {};
    SITE_TEMPLATES.forEach(function (t) { if (t.mirror) m[t.mirror] = (m[t.mirror] || 0) + 1; });
    return m;
  })();
  function mirrorGroupOf(host) {
    var t = templateForHost(host);
    return (t && t.mirror) ? t.mirror : String(host || '').toLowerCase();
  }
  function sourceGroup() { return mirrorGroupOf(location.hostname); }

  var currentSite = null;
  var probeMode = false;             // true = 当前页不是监管站点，仅启用链接探测
  var stats = { cards: 0, blocked: 0, fav: 0, hl: 0, dl: 0, soft: 0, preview: 0 };
  var revealHidden = false;          // 「显示被隐藏」临时揭示态（纯视图，不落存储）
  var foundActress = new Map();   // name -> count
  var foundTag = new Map();       // name -> count
  var foundMaker = new Map();
  var foundSeries = new Map();
  var foundDirector = new Map();
  var dlLinks = [];               // 探测到的下载链接
  var dlSeenCodes = {};           // 当前页出现过的番号
  var hitDelta = new Map();       // ruleId -> 增量命中数
  var origPos = new WeakMap();    // 置顶前的位置记忆
  var whyMap = new WeakMap();     // 卡片 -> 命中原因（悬停浮层）
  var whyEl = null;               // 悬停浮层 DOM
  var undoStack = [];             // 规则/分组快照，供撤销
  var coocDelta = new Map();      // 共现增量（女优→标签/片商/系列/导演）
  var pickMode = false;           // 卡片选择器「点选」模式
  var pickBanner = null;
  var ui = null;                  // 悬浮 UI 引用
  var activeTab = 'actress';
  var searchQuery = '';           // 面板内全局搜索词
  var favFilter = 'all';          // 番号收藏页筛选：all | seen | unseen
  var passTimer = null;
  var recommendBatch = false;        // 推荐页批量选择模式
  var recommendSel = new Set();      // type||value 集合
  var lastHref = location.href;

  /* ---------------- 工具函数 ---------------- */
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function globToRegex(pattern) {
    var p = String(pattern).trim();
    var re = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + re + '$', 'i');
  }

  function matchSite(href) {
    for (var i = 0; i < S.sites.length; i++) {
      var st = S.sites[i];
      if (!st || !st.enabled || !st.pattern) continue;
      try {
        if (globToRegex(st.pattern).test(href)) return st;
        // `*://*.example.com/*` 按匹配规则只认子域，裸域 example.com 会被漏掉。
        // 站点实际常在裸域上（如 https://xsijishe.net/），这里补一次裸域匹配。
        if (/^\*:\/\/\*\./.test(st.pattern) &&
          globToRegex(st.pattern.replace('*://*.', '*://')).test(href)) return st;
      } catch (e) { /* 忽略非法 pattern */ }
    }
    return null;
  }

  function hexToRgba(hex, a) {
    var h = String(hex || '#00e5ff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function uid() { return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // 悬浮球短暂显示一个字符（操作反馈）
  function flashBall(txt, ms) {
    if (!ui || !ui.ball) return;
    ui.ball.textContent = txt;
    setTimeout(function () { if (ui && ui.ball) ui.ball.textContent = '◈'; }, ms || 900);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ---------------- 数据读写 ---------------- */
  // 云同步：开启后用 sync 区并镜像到 local；否则仅 local
  function activeArea() { return (S.settings && S.settings.sync) ? 'sync' : 'local'; }
  /* 读数据。
     契约：cb 收到的是**数据对象本身**（不是 {sf_data_v1: ...} 外层包），
     出错时给 {}。曾经这里和 7 个调用点理解不一致，导致写回时用空对象覆盖整库，
     表现为「设置/规则莫名其妙丢了」「错误日志一落盘就没」。
     新增调用点请直接 `cfGet(function (d) { d.xxx = ... })`，不要再解 DATA_KEY。 */
  function cfGet(cb) {
    try { chrome.storage[activeArea()].get(DATA_KEY, function (o) { cb(o[DATA_KEY] || {}); }); }
    catch (e) { cb({}); }
  }
  function cfSet(payload, cb) {
    var area = activeArea();
    if (area === 'sync') {
      try { chrome.storage.sync.set(payload, function () { try { chrome.storage.local.set(payload, function () { if (cb) cb(); }); } catch (e2) { if (cb) cb(); } }); }
      catch (e) { try { chrome.storage.local.set(payload, cb); } catch (e2) { if (cb) cb(); } }
    } else {
      try { chrome.storage.local.set(payload, function () { if (cb) cb(); }); } catch (e) { if (cb) cb(); }
    }
  }

  /* ---------------- 数据迁移 ----------------
   * 规则：任何数据结构变更都要 ① SCHEMA_VERSION +1 ② 在 steps 里补一步。
   * migrate 只负责「把旧数据补齐成新结构」，必须幂等（重复执行结果一致）。 */
  function migrate(d) {
    d = d || {};
    var from = Number(d.schemaVersion) || 1;
    if (from > SCHEMA_VERSION) logErr('migrate', new Error('数据来自更高版本 (' + from + ')'));
    var steps = {
      // v1 → v2：补齐各版本陆续新增的字段（历史上曾因漏挂字段导致设置页/后台写回丢数据）
      2: function (x) {
        x.settings = x.settings || {};
        x.watchlist = x.watchlist || {};
        x.cooc = x.cooc || {};
        x.peeks = x.peeks || {};
        x.recFeedback = x.recFeedback || {};
        x.recFeedbackDaily = x.recFeedbackDaily || {};
        x.similarRecs = x.similarRecs || {};
        x.dailyRecs = x.dailyRecs || {};
        x.groups = x.groups || [];
        x.statsLog = x.statsLog || {};
        x.discovered = x.discovered || {};
        x.errLog = x.errLog || [];
      },
      // v2 → v3：① 键位可自定义（settings.keys）② 规则支持条件表达式（rule.expr，规范化成空串）
      3: function (x) {
        x.settings = x.settings || {};
        x.settings.keys = x.settings.keys || {};
        x.recSettings = x.recSettings || {};
        x.recHistory = x.recHistory || [];
        x.rules = (x.rules || []).map(function (r) {
          if (r && r.expr == null) r.expr = '';
          return r;
        });
      },
      // v3 → v4：① 临时规则有效期（rule.expiresAt）② 自动记录已看 / 影响面预估开关
      //          ③ 自动学习候选规则 ④ 场景档位 Profile
      4: function (x) {
        x.settings = x.settings || {};
        if (x.settings.autoSeen == null) x.settings.autoSeen = true;
        if (x.settings.auditWarn == null) x.settings.auditWarn = true;
        x.rules = (x.rules || []).map(function (r) {
          if (r && r.expiresAt == null) r.expiresAt = 0;
          return r;
        });
        x.learned = x.learned || {};
        x.dismissedLearn = x.dismissedLearn || {};
        x.profiles = x.profiles || [];
        x.activeProfile = x.activeProfile || '';
        x.expiredLog = x.expiredLog || [];
      },
      // v4 → v5：站点模板化。老用户已存过 sites，这里按 id 把缺的默认站点补齐。
      //           幂等：已存在的 id 不重复加。注意边界 —— 用户此前手动删掉过的默认站点
      //           会在这次迁移里被补回来（一次性行为，之后不再触发）。
      5: function (x) {
        x.sites = x.sites || [];
        var have = {};
        x.sites.forEach(function (s) { if (s && s.id) have[s.id] = 1; });
        DEFAULT_SITES.forEach(function (s) {
          if (have[s.id]) return;
          x.sites.push({ id: s.id, pattern: s.pattern, enabled: true, selector: '', note: s.note });
        });
      },
      // v5 → v6：屏蔽显示方式从二元开关 softBlock 升级为三档 blockDisplay。
      //           **迁移必须尊重老用户既有行为，不能顺手改成新默认值** ——
      //           否则升级瞬间所有老用户的页面观感突变（本来是"完全隐藏"，
      //           突然变成满屏空格）。所以：勾过软屏蔽的 → 'soft'，没勾的 → 'hide'。
      //           'placeholder' 只作为全新安装的默认（在 DEFAULT_SETTINGS 里）。
      6: function (x) {
        x.settings = x.settings || {};
        if (!x.settings.blockDisplay) {
          x.settings.blockDisplay = x.settings.softBlock ? 'soft' : 'hide';
        }
        delete x.settings.softBlock;   // 旧字段清掉，避免两份真相并存
      }
    };
    for (var v = from + 1; v <= SCHEMA_VERSION; v++) {
      if (steps[v]) { try { steps[v](d); } catch (e) { logErr('migrate.v' + v, e); } }
    }
    d.schemaVersion = SCHEMA_VERSION;
    return d;
  }

  function loadState() {
    return new Promise(function (resolve) {
      try {
        cfGet(function (d) {
          d = migrate(d);
          S.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
          S.settings.ball = Object.assign({}, DEFAULT_SETTINGS.ball, (d.settings && d.settings.ball) || {});
          S.settings.keys = normKeys(d.settings && d.settings.keys);
          S.sites = (d.sites && d.sites.length) ? d.sites : DEFAULT_SITES.slice();
          S.rules = d.rules || [];
          S.seen = d.seen || {};
          S.favCodes = d.favCodes || {};
          S.discovered = d.discovered || {};
          S.groups = d.groups || [];
          S.statsLog = d.statsLog || {};
          S.dailyRecs = d.dailyRecs || {};
          S.recHistory = d.recHistory || [];
          S.recFeedback = d.recFeedback || {};
          S.watchlist = d.watchlist || {};
          S.cooc = d.cooc || {};
          S.similarRecs = d.similarRecs || {};
          S.recFeedbackDaily = d.recFeedbackDaily || {};
          S.peeks = d.peeks || {};
          S.errLog = d.errLog || [];
          S.shopMarks = d.shopMarks || {};
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  function saveState(patch) {
    return new Promise(function (resolve) {
      cfGet(function (o) {
        var d = Object.assign({ sites: S.sites, rules: S.rules, seen: S.seen, favCodes: S.favCodes, discovered: S.discovered, groups: S.groups, statsLog: S.statsLog, dailyRecs: S.dailyRecs, recHistory: S.recHistory, recFeedback: S.recFeedback, watchlist: S.watchlist, cooc: S.cooc, similarRecs: S.similarRecs, recFeedbackDaily: S.recFeedbackDaily, peeks: S.peeks, errLog: S.errLog, shopMarks: S.shopMarks, settings: S.settings }, o || {});
        if (patch) Object.assign(d, patch);
        var payload = {};
        payload[DATA_KEY] = d;
        cfSet(payload, function () { resolve(); });
      });
    });
  }

  function saveRules() { return saveState({ rules: S.rules }); }
  function saveSettings() { return saveState({ settings: S.settings }); }

  /* ---------------- 撤销（规则 / 分组快照） ---------------- */
  function snapshot(label) {
    try {
      undoStack.push({
        rules: JSON.parse(JSON.stringify(S.rules || [])),
        groups: JSON.parse(JSON.stringify(S.groups || [])),
        label: label || '修改',
        ts: Date.now()
      });
      if (undoStack.length > 40) undoStack.shift();
    } catch (e) { }
  }
  function undoLast() {
    if (!undoStack.length) return false;
    var s = undoStack.pop();
    S.rules = s.rules || [];
    S.groups = s.groups || [];
    saveState({ rules: S.rules, groups: S.groups });
    schedulePass();
    if (ui) setTimeout(renderList, 60);
    flashBall('↶');
    return true;
  }

  /* ---------------- 冲突检测：同一目标同时被屏蔽 + 收藏/高亮 ---------------- */
  function computeConflicts() {
    var byKey = {};
    (S.rules || []).forEach(function (r) {
      if (!r || r.enabled === false) return;
      var k = r.type + '|' + String(r.value).toLowerCase();
      if (!byKey[k]) byKey[k] = { value: r.value, type: r.type, actions: {} };
      byKey[k].actions[r.action] = (byKey[k].actions[r.action] || 0) + 1;
    });
    var out = [];
    Object.keys(byKey).forEach(function (k) {
      var e = byKey[k];
      if (e.actions.block && (e.actions.favorite || e.actions.highlight)) out.push(e);
    });
    return out;
  }

  /* ---------------- 稍后再看队列（优先级看板） ---------------- */
  var PRIO = [
    { v: 2, t: '高', c: '#ff4d6d' },
    { v: 1, t: '中', c: '#ff9f1c' },
    { v: 0, t: '低', c: '#7a8399' }
  ];
  // 兼容历史数据：无 prio 字段视为「中」
  function prioOf(it) {
    var p = it && it.prio;
    return (p === 0 || p === 1 || p === 2) ? p : 1;
  }
  function prioLabel(p) {
    for (var i = 0; i < PRIO.length; i++) if (PRIO[i].v === p) return PRIO[i];
    return PRIO[1];
  }
  function toggleWatch(code, meta) {
    if (!code) return;
    S.watchlist = S.watchlist || {};
    if (S.watchlist[code]) delete S.watchlist[code];
    else S.watchlist[code] = {
      t: (meta && meta.title) || '', u: (meta && meta.url) || '',
      s: location.hostname, at: Date.now(), note: '', prio: 1
    };
    saveState({ watchlist: S.watchlist });
    schedulePass();
    if (activeTab === 'watch') setTimeout(renderList, 80);
  }
  function watchDone(code) {
    if (!code || !S.watchlist || !S.watchlist[code]) return;
    S.seen[code] = Date.now();
    delete S.watchlist[code];
    saveState({ watchlist: S.watchlist, seen: S.seen });
    schedulePass();
    if (activeTab === 'watch') setTimeout(renderList, 80);
  }
  function watchRemove(code) {
    if (!code || !S.watchlist) return;
    delete S.watchlist[code];
    saveState({ watchlist: S.watchlist });
    schedulePass();
    if (activeTab === 'watch') setTimeout(renderList, 80);
  }
  // 优先级循环：低 → 中 → 高 → 低
  function watchSetPrio(code) {
    var it = S.watchlist && S.watchlist[code];
    if (!it) return;
    it.prio = (prioOf(it) + 1) % 3;
    saveState({ watchlist: S.watchlist });
    if (activeTab === 'watch') renderWatch();
  }
  function watchSetNote(code, note) {
    var it = S.watchlist && S.watchlist[code];
    if (!it) return;
    it.note = String(note == null ? '' : note).slice(0, 120);
    saveState({ watchlist: S.watchlist });
  }
  // 就地进入备注编辑（不整页重渲染，避免打断正在进行的操作）
  function watchStartEdit(code) {
    if (!ui) return;
    var cards = ui.sr.querySelectorAll('.cf-wcard'), card = null;
    for (var i = 0; i < cards.length; i++) { if (cards[i].dataset.wcode === code) { card = cards[i]; break; } }
    if (!card) return;
    var span = card.querySelector('.wnote');
    if (!span) return;
    var inp = document.createElement('input');
    inp.className = 'wnote-in';
    inp.id = 'wnoteInput';
    inp.setAttribute('data-code', code);
    inp.value = (S.watchlist[code] && S.watchlist[code].note) || '';
    inp.placeholder = '写点什么…（Enter 保存 / Esc 取消）';
    span.parentNode.replaceChild(inp, span);
    try { inp.focus(); inp.select(); } catch (e) { }
  }
  // 失焦/回车后把输入框还原成文本（就地，不重渲染）
  function watchCommitInput(inp, cancel) {
    if (!inp || !inp.parentNode) return;
    var code = inp.getAttribute('data-code') || '';
    if (!cancel) watchSetNote(code, inp.value);
    var span = document.createElement('span');
    var val = cancel ? ((S.watchlist[code] && S.watchlist[code].note) || '') : String(inp.value || '');
    span.className = 'wnote' + (val ? '' : ' empty');
    span.textContent = val || '＋备注';
    span.setAttribute('data-wnote', code);
    span.title = '点击编辑备注';
    inp.parentNode.replaceChild(span, inp);
  }

  /* ---------------- 共现矩阵（相似女优算法输入） ---------------- */
  // 记录「某女优与哪些标签/片商/系列/导演共同出现」，供 IDF 加权相似度使用
  function noteCooc(actress, ctx, url) {
    if (!actress) return;
    var e = coocDelta.get(actress);
    if (!e) { e = { tag: {}, maker: {}, series: {}, director: {}, w: {} }; coocDelta.set(actress, e); }
    ['tag:tagList', 'maker:makerList', 'series:seriesList', 'director:directorList'].forEach(function (pair) {
      var p = pair.split(':');
      (ctx[p[1]] || []).forEach(function (v) { if (v) e[p[0]][v] = (e[p[0]][v] || 0) + 1; });
    });
    // 作品记录：她出现在哪个番号。供相似推荐「共同出演作品」下钻使用
    if (ctx.code) {
      e.w = e.w || {};
      e.w[ctx.code] = { t: ctx.rawTitle || '', u: url || '', at: Date.now() };
    }
  }

  var flushCooc = debounce(function () {
    if (!coocDelta.size) return;
    var delta = coocDelta; coocDelta = new Map();
    cfGet(function (o) {
      var d = o || {};
      var cooc = d.cooc || {};
      delta.forEach(function (e, name) {
        var cur = cooc[name] || (cooc[name] = { tag: {}, maker: {}, series: {}, director: {}, w: {} });
        ['tag', 'maker', 'series', 'director'].forEach(function (dim) {
          cur[dim] = cur[dim] || {};
          Object.keys(e[dim] || {}).forEach(function (v) { cur[dim][v] = (cur[dim][v] || 0) + e[dim][v]; });
        });
        // 作品合并（每人最多保留 40 部，超出按最近出现淘汰）
        cur.w = cur.w || {};
        var ws = e.w || {};
        Object.keys(ws).forEach(function (c) { if (!cur.w[c]) cur.w[c] = ws[c]; });
        var ck = Object.keys(cur.w);
        if (ck.length > 40) {
          ck.sort(function (a, b) { return (cur.w[a].at || 0) - (cur.w[b].at || 0); });
          ck.slice(0, ck.length - 40).forEach(function (c) { delete cur.w[c]; });
        }
      });
      // 上限保护
      var names = Object.keys(cooc);
      if (names.length > 3000) names.slice(3000).forEach(function (n) { delete cooc[n]; });
      d.cooc = cooc;
      S.cooc = cooc;
      var p = {}; p[DATA_KEY] = d;
      cfSet(p, function () { });
    });
  }, 6000);

  // 推荐反馈按天累计（供看板画采纳率曲线）
  function bumpFeedbackDaily(kind) {
    var day = todayStr();
    S.recFeedbackDaily = S.recFeedbackDaily || {};
    var e = S.recFeedbackDaily[day] || { faved: 0, blocked: 0, seen: 0 };
    e[kind] = (e[kind] || 0) + 1;
    S.recFeedbackDaily[day] = e;
    cfGet(function (o) {
      var d = o || {};
      d.recFeedbackDaily = d.recFeedbackDaily || {};
      d.recFeedbackDaily[day] = Object.assign({}, d.recFeedbackDaily[day] || {}, e);
      var p = {}; p[DATA_KEY] = d;
      cfSet(p, function () { });
    });
  }

  // 命中次数异步落盘，避免频繁写 storage
  var flushHits = debounce(function () {
    if (!hitDelta.size) return;
    var delta = hitDelta; hitDelta = new Map();
    var now = Date.now();
    // 先更新内存，使面板/设置页即时可见「最近命中」
    delta.forEach(function (n, id) {
      for (var i = 0; i < S.rules.length; i++) {
        if (S.rules[i].id === id) { S.rules[i].hits = (S.rules[i].hits || 0) + n; S.rules[i].lastHit = now; break; }
      }
    });
    cfGet(function (o) {
      var d = o || {};
      var rules = d.rules || [];
      delta.forEach(function (n, id) {
        for (var i = 0; i < rules.length; i++) {
          if (rules[i].id === id) { rules[i].hits = (rules[i].hits || 0) + n; rules[i].lastHit = now; break; }
        }
      });
      var p = {}; p[DATA_KEY] = d;
      cfSet(p, function () { });
    });
  }, 4000);

  // 每日统计日志：把当天快照写入 statsLog，供「数据看板」绘制曲线
  // 用「脏标记 + 单次定时器」而非纯防抖：rulePass 频繁调用也不会把定时器反复重置，
  // 保证每隔一段空闲（≥3s）必然落盘一次当天数据。
  var statsDirty = false, statsTimer = null;
  function flushStats() {
    statsDirty = true;
    if (statsTimer) return;
    statsTimer = setTimeout(function () {
      statsTimer = null;
      if (!statsDirty) return;
      statsDirty = false;
      var day = todayStr();
      var snap = { cards: stats.cards, blocked: stats.blocked, fav: stats.fav, hl: stats.hl, dl: stats.dl, at: Date.now() };
      S.statsLog = S.statsLog || {};
      S.statsLog[day] = snap;
      cfGet(function (o) {
        var d = o || {};
        d.statsLog = d.statsLog || {};
        d.statsLog[day] = snap;
        var p = {}; p[DATA_KEY] = d;
        cfSet(p, function () { });
      });
    }, 3000);
  }

  /* ---------------- 卡片识别 ---------------- */
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 60 && r.height > 60;
  }

  function dedupe(els) {
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i], nested = false;
      for (var j = 0; j < els.length; j++) {
        if (i !== j && els[j].contains(el)) { nested = true; break; }
      }
      if (!nested) out.push(el);
    }
    return out;
  }

  // 通用兜底：找「含图片 + 有文字」的链接，按父容器分组，取分组内 >=3 个的那一层
  function detectGeneric() {
    var cands = [];
    var all = document.querySelectorAll('a[href]');
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      if (!a.querySelector('img')) continue;
      var txt = (a.innerText || a.textContent || '').trim();
      var alt = (a.querySelector('img') || {}).alt || '';
      if (txt.length < 2 && alt.length < 2) continue;
      if (!visible(a)) continue;
      cands.push(a);
    }
    if (cands.length < 3) return [];

    var groups = new Map();
    cands.forEach(function (a) {
      var p = a.parentElement ? a.parentElement.parentElement : null;
      if (!p) return;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(a);
    });

    var best = null, bestN = 0;
    groups.forEach(function (list, p) {
      if (list.length > bestN) { bestN = list.length; best = { p: p, list: list }; }
    });
    if (!best || bestN < 3) return [];

    var cards = best.list.map(function (a) {
      var n = a;
      while (n.parentElement && n.parentElement !== best.p) n = n.parentElement;
      return n;
    });
    return dedupe(cards);
  }

  // 列表行（论坛 / 表格）可见性：行高远小于卡片，不能用 visible() 的 60px 门槛
  function visibleRow(el) {
    var r = el.getBoundingClientRect();
    return r.width > 120 && r.height > 14;
  }

  // 列表行模式兜底：论坛标题行通常没有图片，detectGeneric 的「必须含 img」会全军覆没
  function detectRows() {
    var sels = ['#threadlist tbody tr', '#threadlist tr', 'tbody tr', '.nex_forum_lists li', 'ul li'];
    // ⚠️ 导航菜单污染防护（2026-09-22 实测踩到）：
    // 论坛网页里有大量 <ul><li> 是**下拉菜单/导航**（如"立即注册""图片区"），
    // 它们同样有 <a href> 且文本够长，会被 'ul li' 误当成帖子行 ——
    // 结果是用户能"屏蔽"掉菜单项，而真正的帖子一行都屏蔽不到（静默错误）。
    // 判据：兜底命中必须落在主要内容区（#threadlist / form#moderate / .bm / #ct 内），
    // 只有 0 个落进去时，才认定这组选择器无效、换下一个。
    // 注意：该判据只在**存在明确列表容器**时生效；通用论坛（无这些容器）走原逻辑。
    var HOST_OK = /#threadlist|#threadlisttableid|form#moderate|\.bm\b|#ct\b/;
    var hasListRoot = false;
    try {
      hasListRoot = !!document.querySelector('#threadlist, #threadlisttableid, form#moderate');
    } catch (e) { hasListRoot = false; }
    for (var i = 0; i < sels.length; i++) {
      try {
        var raw = document.querySelectorAll(sels[i]);
        var els = [];
        for (var j = 0; j < raw.length; j++) {
          var el = raw[j];
          if (!visibleRow(el)) continue;
          var a = el.querySelector('a[href]');
          if (!a || txt(a).length < 2) continue;
          if (hasListRoot) {
            // 该元素或其祖先必须落在内容容器内，否则视为菜单项
            var inRoot = false;
            var n = el;
            while (n && n !== document) {
              var idc = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
              if (HOST_OK.test(idc)) { inRoot = true; break; }
              n = n.parentElement;
            }
            if (!inRoot) continue;
          }
          els.push(el);
        }
        if (els.length >= 3) { log('rows via selector', sels[i], els.length); return els.slice(0, 200); }
      } catch (e) { /* 选择器非法则跳过 */ }
    }
    return [];
  }

  function findCards() {
    var host = location.hostname || '';
    var tpl = templateForHost(host);
    var rowMode = !!(tpl && tpl.rowMode);
    var vis = rowMode ? visibleRow : visible;

    // 用户在「监管站点」里手填的卡片选择器优先
    if (currentSite && currentSite.selector) {
      try {
        var ce = Array.prototype.filter.call(document.querySelectorAll(currentSite.selector), vis);
        if (ce.length >= 3) {
          var cd = dedupe(ce);
          if (cd.length >= 3) { log('cards via custom selector', currentSite.selector, cd.length); return cd; }
        }
      } catch (e) { /* 选择器非法则跳过 */ }
    }

    if (rowMode) {
      var rows = detectRows();
      if (rows.length >= 3) return rows;
    }

    var sels = [];
    for (var i = 0; i < KNOWN_SELECTORS.length; i++) {
      if (KNOWN_SELECTORS[i].test.test(host)) sels = sels.concat(KNOWN_SELECTORS[i].sel);
    }
    sels = sels.concat(['.item', '.movie-box', '.video-item', '.card']);

    for (var k = 0; k < sels.length; k++) {
      try {
        var els = Array.prototype.filter.call(document.querySelectorAll(sels[k]), vis);
        if (els.length >= 3) {
          var d = dedupe(els);
          if (d.length >= 3) { log('cards via selector', sels[k], d.length); return d; }
        }
      } catch (e) { /* 选择器非法则跳过 */ }
    }
    var g = detectGeneric();
    log('cards via generic', g.length);
    return g;
  }

  /* ---------------- 卡片内容提取 ---------------- */
  function txt(el) { return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim(); }

  function classify(el) {
    var href = (el.getAttribute && el.getAttribute('href')) || '';
    var cls = typeof el.className === 'string' ? el.className : '';
    var kinds = linkKindsFor(location.hostname);
    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i];
      if (k.href.test(href) || k.cls.test(cls)) return k.kind;
    }
    return null;
  }

  function extract(card) {
    var full = txt(card);
    var kinds = linkKindsFor(location.hostname);
    var links = card.querySelectorAll('a[href]');
    var bucket = { actress: new Set(), tag: new Set(), maker: new Set(), series: new Set(), director: new Set(), actressItems: [] };

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var t = txt(a);
      if (!t || t.length > 40) continue;
      var kind = classify(a);
      if (kind) {
        bucket[kind].add(t);
        if (kind === 'actress') bucket.actressItems.push({ name: t, href: absoluteUrl(a.getAttribute('href')) });
      }
    }

    var clsEls = card.querySelectorAll('[class]');
    for (var j = 0; j < clsEls.length; j++) {
      var el = clsEls[j];
      var c = el.className;
      if (typeof c !== 'string' || !c) continue;
      var t2 = txt(el);
      if (!t2 || t2.length > 40) continue;
      for (var q = 0; q < kinds.length; q++) {
        if (kinds[q].cls.test(c)) { bucket[kinds[q].kind].add(t2); break; }
      }
    }

    var img = card.querySelector('img');
    var titleEl = card.querySelector('.title, h1, h2, h3, h4, [class*="title" i]');
    var title = txt(titleEl) || (img && img.getAttribute('alt')) || '';
    // 标题兜底：论坛行 / 没有 .title 元素的卡片，取行内最长的锚文本当标题
    if (!title) {
      var as2 = card.querySelectorAll('a[href]'), bestT = '', bestL = 0;
      for (var z = 0; z < as2.length; z++) {
        var tt = txt(as2[z]);
        if (tt.length > bestL) { bestL = tt.length; bestT = tt; }
      }
      if (bestT) title = bestT;
    }
    var code = '';
    var tpl = templateForHost(location.hostname);
    var firstA = card.querySelector('a[href]');
    // 非番号体系的站点，从链接路径猜番号只会得到 thread-12345 这类垃圾，
    // 所以这类站只从标题里猜（论坛标题里往往直接写着番号）。
    if (firstA && (!tpl || tpl.code !== false)) code = codeFromHref(firstA.getAttribute('href'));
    if (!code && title) code = codeFromHref(title);
    var cid = code || contentIdFromHref(firstA ? firstA.getAttribute('href') : '', tpl);

    function joined(set) { return Array.from(set).join(' | ').toLowerCase(); }

    return {
      all: (full + ' ' + title + ' ' + code).toLowerCase(),
      actress: joined(bucket.actress),
      tag: joined(bucket.tag),
      maker: joined(bucket.maker),
      series: joined(bucket.series),
      director: joined(bucket.director),
      title: (title + ' ' + code).toLowerCase(),
      code: code,
      cid: cid,
      rawTitle: title,
      actressList: Array.from(bucket.actress),
      actressItems: bucket.actressItems || [],
      tagList: Array.from(bucket.tag),
      makerList: Array.from(bucket.maker),
      seriesList: Array.from(bucket.series),
      directorList: Array.from(bucket.director),
      rating: extractRating(card, full),
      date: extractDate(card, full)
    };
  }

  /* ---------------- 跨站内容身份（cid）----------------
     番号站：cid 就是番号本身，老数据（已看 / 收藏 / 待看都按番号存）不用迁移。
     非番号站：番号为空，就从链接里抽站点自己的稳定 ID，加前缀避免跨站撞号
       —— PornHub 的 viewkey → ph:xxxx，YouPorn 的 /watch/123 → yp:123，Discuz 的 thread-123 → dz:123。
     有了它，收藏 / 待看 / 已看 / 临时放行在这些站上才可用。 */
  function contentIdFromHref(href, tpl) {
    if (!href || !tpl || !tpl.idFrom) return '';
    var m = String(href).match(tpl.idFrom);
    if (!m || !m[1]) return '';
    return (tpl.idPrefix || tpl.id) + ':' + m[1].toLowerCase();
  }

  // 评分提取（尽力而为）：优先取 class 含 rate/score/star 的元素里的数字，其次匹配「评分 N.N」
  function extractRating(card, full) {
    var els = card.querySelectorAll('[class]');
    for (var i = 0; i < els.length; i++) {
      var c = typeof els[i].className === 'string' ? els[i].className : '';
      if (/rate|score|star|rating/i.test(c)) {
        var t = txt(els[i]);
        var m = t.match(/(\d(?:\.\d)?)/);
        if (m) { var v = parseFloat(m[1]); if (v >= 0 && v <= 10) return v; }
      }
    }
    var m2 = full.match(/(?:评分|rating|score|星|★|⭐)\D{0,6}(\d(?:\.\d)?)/i);
    if (m2) { var v2 = parseFloat(m2[1]); if (v2 >= 0 && v2 <= 10) return v2; }
    return null;
  }

  // 发行日期提取（尽力而为）：优先取 class 含 date/time 的元素，其次卡片文本里的 年-月-日
  function extractDate(card, full) {
    var els = card.querySelectorAll('[class]');
    for (var i = 0; i < els.length; i++) {
      var c = typeof els[i].className === 'string' ? els[i].className : '';
      if (/date|time|日付|配信|発売|release/i.test(c)) {
        var t = txt(els[i]);
        var m = t.match(/\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?/);
        if (m) return m[0].replace(/\//g, '-');
      }
    }
    var m2 = full.match(/\b(\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?)\b/);
    return m2 ? m2[1].replace(/\//g, '-') : null;
  }

  /* ---------------- 条件表达式（引擎在 expr.js，两份代码一份实现） ----------------
   * 这里只做接线：把 content.js 的错误日志挂到引擎上，并把结果翻译成布尔值。
   * 为什么不在 content.js 里再写一份：设置页的「表达式测试器」必须与页面跑的是
   * 同一份实现，否则测试器通过 ≠ 规则生效，等于没有测试器。 */
  var SFX = (typeof SF_EXPR !== 'undefined' && SF_EXPR) ? SF_EXPR : null;
  if (SFX) {
    try { SFX.setLogger(function (e) { logErr('expr', e); }); } catch (e0) { }
  } else {
    logErr('expr', new Error('expr.js 未加载，条件表达式（rule.expr）将不生效'));
  }

  // 语法检查 / 求值（对 content.js 内部保持这两个名字）
  function exprCheck(src) {
    return SFX ? SFX.check(src) : { ok: false, err: '表达式引擎未加载' };
  }
  function exprTest(src, ctx) {
    return SFX ? SFX.test(src, ctx) : false;
  }

  /* ---------------- 规则匹配 ---------------- */
  function ruleValues(rule) {
    var v = [rule.value].concat(rule.aliases || []);
    return v.filter(function (x) { return x && String(x).trim(); });
  }

  // 临时规则有效期：expiresAt 为毫秒时间戳，到了就自动失效
  function ruleExpired(r) {
    return !!(r && r.expiresAt && Number(r.expiresAt) && Date.now() >= Number(r.expiresAt));
  }

  /* 匹配 + 判定过程。
     传 steps 数组时会把每一步记下来（只给「规则调试器」用），
     不传就是纯匹配 —— 仍然是同一份实现，不存在两份逻辑走偏的问题。 */
  function matchRuleDetail(rule, ctx, steps) {
    function why(t, ok, note) { if (steps) steps.push({ t: t, ok: !!ok, note: note || '' }); }
    if (!rule.enabled) { why('启用', false, '规则已关闭'); return false; }
    if (ruleExpired(rule)) { why('有效期', false, '临时规则已到期'); return false; }
    if (rule.sites && rule.sites.length && currentSite && rule.sites.indexOf(currentSite.pattern) === -1) {
      why('站点', false, '限定站点不含当前站');
      return false;
    }

    // 高级条件表达式：填了就完全以它为准（简单字段只是它的「傻瓜版」，同时填会让人困惑）
    if (rule.expr && String(rule.expr).trim()) {
      var oe = exprTest(rule.expr, ctx);
      why('表达式', oe, rule.expr);
      return oe;
    }

    // 附加条件（AND 关系）：评分下限 / 发行日期区间。
    // 有了这两项，规则就不只是「匹配文字」，还可以是「2023 年后 + 评分≥4 的自动高亮」。
    if (rule.ratingMin != null && rule.ratingMin !== '') {
      var rv = Number(ctx.rating);
      var okR = !!(rv >= Number(rule.ratingMin));
      why('评分≥', okR, (ctx.rating == null || ctx.rating === '' ? '卡片无评分' : String(ctx.rating)) + ' ≥ ' + rule.ratingMin);
      if (!okR) return false;
    }
    if (rule.dateFrom) {
      var okF = !!(ctx.date && ctx.date >= rule.dateFrom);
      why('日期≥', okF, (ctx.date || '无日期') + ' ≥ ' + rule.dateFrom);
      if (!okF) return false;
    }
    if (rule.dateTo) {
      var okT = !!(ctx.date && ctx.date <= rule.dateTo);
      why('日期≤', okT, (ctx.date || '无日期') + ' ≤ ' + rule.dateTo);
      if (!okT) return false;
    }

    var scope = rule.scope || 'all';
    // 关键：hay 也必须小写，否则「Mikami」规则匹配不到卡片里的「Mikami Yua」（首字母大写）。
    // 此前只把规则值小写、卡片文本不小写，导致拉丁字母规则大小写敏感 —— 静默漏匹配。
    var hayRaw = ctx[scope] != null ? ctx[scope] : ctx.all;
    var hay = String(hayRaw == null ? '' : hayRaw).toLowerCase();
    var vals = ruleValues(rule);
    var mode = rule.match || 'contains';

    // 纯条件规则：只填了评分/日期，没有关键词 → 命中所有满足条件的卡片
    if (!vals.length) { why('关键词', true, '未填关键词（纯条件规则）'); return true; }

    for (var i = 0; i < vals.length; i++) {
      var raw = String(vals[i]).trim();
      if (!raw) continue;
      if (mode === 'regex') {
        try {
          if (new RegExp(raw, 'i').test(hay)) { why('正则', true, raw); return true; }
        } catch (e) { why('正则', false, '正则写法有误：' + raw); }
      } else if (mode === 'exact') {
        if (hay === raw.toLowerCase()) { why('精确', true, raw); return true; }
        if (new RegExp('(^|[|\\s,，、])' + esc(raw.toLowerCase()) + '([|\\s,，、]|$)', 'i').test(hay)) { why('精确', true, raw); return true; }
      } else {
        if (hay.indexOf(raw.toLowerCase()) !== -1) { why('包含', true, raw); return true; }
      }
    }
    why(mode === 'regex' ? '正则' : (mode === 'exact' ? '精确' : '包含'), false, vals.join(' / '));
    return false;
  }

  function matchRule(rule, ctx) { return matchRuleDetail(rule, ctx, null); }

  /* ---------------- 应用规则 ---------------- */
  var applying = false;   // 防止 runPass 自身改 DOM 触发 MutationObserver 造成死循环

  function clearMarks() {
    var els = document.querySelectorAll('.cf-blocked,.cf-placeholder,.cf-fav,.cf-hl,.cf-seen,.cf-sfw,.cf-favcode,.cf-watch,.cf-card,.cf-dl,.cf-soft,.cf-peek,.cf-preview');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.classList.remove('cf-blocked', 'cf-placeholder', 'cf-fav', 'cf-hl', 'cf-seen', 'cf-sfw', 'cf-favcode', 'cf-watch', 'cf-card', 'cf-dl', 'cf-soft', 'cf-peek', 'cf-preview');
      try { delete el.dataset.cfCode; } catch (e) { }
      el.style.removeProperty('--cf-hl-color');
      el.style.removeProperty('--cf-hl-glow');
      var btn = el.querySelector(':scope > .cf-favbtn');
      if (btn) btn.remove();
      var wbtn = el.querySelector(':scope > .cf-watchbtn');
      if (wbtn) wbtn.remove();
      var pbtn = el.querySelector(':scope > .cf-peekbtn');
      if (pbtn) pbtn.remove();
      if (origPos.has(el)) {
        var pos = origPos.get(el);
        try {
          if (pos.parent) pos.parent.insertBefore(el, pos.next || null);
        } catch (e) { }
        origPos.delete(el);
      }
    }
  }

  // 重跑前先清掉上一轮的状态类。
  // 关键：'hide' 档的 .cf-blocked 是 display:none、'placeholder' 档的 .cf-placeholder 是
  // visibility:hidden，而 findCards() 用 getBoundingClientRect 判可见 ——
  // 若不先清除，被隐藏过的卡片会被过滤掉 → 规则撤销/清空后永远无法恢复。
  function resetPassMarks() {
    var els = document.querySelectorAll('.cf-blocked,.cf-placeholder,.cf-soft,.cf-peek,.cf-fav,.cf-hl,.cf-seen,.cf-sfw,.cf-favcode,.cf-watch,.cf-filt-out,.cf-preview');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.classList.remove('cf-blocked', 'cf-placeholder', 'cf-soft', 'cf-peek', 'cf-fav', 'cf-hl', 'cf-seen', 'cf-sfw', 'cf-favcode', 'cf-watch', 'cf-filt-out', 'cf-preview');
      el.style.removeProperty('--cf-hl-color');
      el.style.removeProperty('--cf-hl-glow');
      var pb = el.querySelector(':scope > .cf-peekbtn');
      if (pb) pb.remove();
    }
    // 先把上一轮被高亮置顶的卡片放回原位，再重新置顶，避免位置持续漂移
    var pinned = document.querySelectorAll('.cf-card');
    for (var j = 0; j < pinned.length; j++) {
      var c = pinned[j];
      if (origPos.has(c)) {
        var pos = origPos.get(c);
        try { if (pos.parent) pos.parent.insertBefore(c, pos.next || null); } catch (e) { }
        origPos.delete(c);
      }
    }
  }
  // 只清掉上一轮补足克隆进来的卡片（不碰站点原生卡片）。
  // 补足的目标数是「原始数量」，所以每次 pass 都要先把克隆清干净，
  // 否则第二轮的 originalCount 会把克隆也算进去 → 目标数越滚越大。
  function clearClones() {
    var els = document.querySelectorAll('.cf-cloned');
    for (var i = 0; i < els.length; i++) {
      try { els[i].remove(); } catch (e) { }
    }
  }

  /* 规则分桶：把"现在真正参与过滤的规则"算出来。
     runPass 与「规则调试器」共用，避免两处各自过滤一遍导致结论不一致。
     已过期的临时规则在这里就被排除掉。 */
  function buildBuckets(groupOn, st) {
    function inGroup(r) { return !r.groupId || groupOn[r.groupId]; }
    function alive(r) { return r && r.enabled && inGroup(r) && !ruleExpired(r); }
    var fav = [], hl = [], block = [];
    S.rules.forEach(function (r) {
      if (!alive(r)) return;
      if (r.action === 'block') block.push(r);
      else if (r.action === 'favorite') fav.push(r);
      else if (r.action === 'highlight') hl.push(r);
    });
    return {
      fav: fav, hl: hl, block: block,
      ordered: st && st.firstMatchWins ? S.rules.filter(alive) : null
    };
  }

  /* 决策：这张卡最终走哪个动作、是哪条规则说了算。
     抽出来是为了让「规则调试器」显示的结论 === 页面上的实际表现。 */
  function decideCard(ctx, bk) {
    var firstHit = null;
    if (bk.ordered) {
      for (var o = 0; o < bk.ordered.length; o++) {
        if (matchRule(bk.ordered[o], ctx)) { firstHit = bk.ordered[o]; break; }
      }
    }
    function scan(list, act) {
      if (bk.ordered && !(firstHit && firstHit.action === act)) return null;
      for (var i = 0; i < (list || []).length; i++) {
        if (matchRule(list[i], ctx)) return list[i];
      }
      return null;
    }
    var blockRule = scan(bk.block, 'block');
    if (blockRule) return { firstHit: firstHit, blockRule: blockRule, favRule: null, hlRule: null };
    return {
      firstHit: firstHit, blockRule: null,
      favRule: scan(bk.fav, 'favorite'),
      hlRule: scan(bk.hl, 'highlight')
    };
  }

  function runPass() {
    if (!document.body || applying) return;
    applying = true;
    try {
    currentSite = matchSite(location.href);
    probeMode = !currentSite;

    // 非监管站点：仍启用下载链接探测（可在设置里关闭）
    if (probeMode) {
      if (S.settings.probeLinks === false || S.settings.probeAnySite === false) {
        updateHostVisibility();
        return;
      }
      if (S.settings.boss) { clearMarks(); updateHostVisibility(); return; }
      stats = { cards: 0, blocked: 0, fav: 0, hl: 0, dl: 0, soft: 0, preview: 0 };
      probeLinks();
      updateHostVisibility();
      renderStats();
      if (ui && ui.panel && ui.panel.classList.contains('open')) renderList();
      return;
    }

    if (S.settings.boss) {
      clearMarks();
      updateHostVisibility();
      renderStats();
      return;
    }
    if (!S.settings.enabled) {
      clearMarks();
      renderStats();
      return;
    }

    resetPassMarks();
    // 补足前先把上一轮克隆清掉：本轮要重新算「原始数量」，克隆必须先出局
    clearClones();
    var cards = findCards();
    stats = { cards: cards.length, blocked: 0, fav: 0, hl: 0, dl: 0, soft: 0, preview: 0 };
    // 此刻 cards 全是站点原生卡片 —— 这就是「原始数量」，补足以它为基准
    var origCount = cards.length;
    foundActress = new Map();
    foundTag = new Map();
    foundMaker = new Map();
    foundSeries = new Map();
    foundDirector = new Map();
    dlSeenCodes = {};

    var st = S.settings;
    // 分组表：分组关闭 → 其下规则整体不生效
    var groupOn = {};
    (S.groups || []).forEach(function (g) { groupOn[g.id] = g.enabled !== false; });
    function inGroup(r) { return !r.groupId || groupOn[r.groupId]; }

    var bk = buildBuckets(groupOn, st);
    var favRules = bk.fav, hlRules = bk.hl, blockRules = bk.block, orderedRules = bk.ordered;

    navIdx = -1;
    cards.forEach(function (card) {
      // 克隆卡（补足来的）不参与任何规则判定：它们是"补位内容"，被本页规则再屏蔽
      // 一次的话补足就白做了。清干净可能残留的状态类后直接跳过。
      if (card.classList.contains('cf-cloned') || card.dataset.cfClone === '1') {
        card.classList.add('cf-cloned', 'cf-card');
        card.classList.remove('cf-blocked', 'cf-placeholder', 'cf-soft', 'cf-filt-out');
        return;
      }
      // 增量：同一张卡片只提取一次（无限滚动追加卡片时只算新的那批）
      var sig = cardSig(card);
      var ctx = extractCache.get(card);
      if (ctx && extractSig.get(card) !== sig) ctx = null;   // 卡片内容被就地改过 → 缓存失效
      if (!ctx) { ctx = extract(card); extractCache.set(card, ctx); extractSig.set(card, sig); }

      // 记录评分 / 发行日期，供面板「评分 / 日期」快速筛选
      card.dataset.cfDate = ctx.date || '';
      card.dataset.cfRating = (ctx.rating != null) ? String(ctx.rating) : '';
      // 供键盘导航 / 卡片右键菜单使用
      try {
        card.dataset.cfCode = ctx.code || '';
        card.dataset.cfA = ctx.actressList.join(' || ');
        card.dataset.cfTitle = (ctx.rawTitle || '').slice(0, 120);
      } catch (e) { }

      // 「首个命中生效」：先算出第一条命中的规则，再决定这张卡走哪个动作
      var dec = decideCard(ctx, { block: blockRules, fav: favRules, hl: hlRules, ordered: orderedRules });
      var firstHit = dec.firstHit;
      var blockRule = dec.blockRule, favRule = dec.favRule, hlRule = dec.hlRule;
      var blocked = !!blockRule;

      ctx.actressList.forEach(function (n) { foundActress.set(n, (foundActress.get(n) || 0) + 1); });
      ctx.tagList.forEach(function (n) { foundTag.set(n, (foundTag.get(n) || 0) + 1); });
      ctx.makerList.forEach(function (n) { foundMaker.set(n, (foundMaker.get(n) || 0) + 1); });
      ctx.seriesList.forEach(function (n) { foundSeries.set(n, (foundSeries.get(n) || 0) + 1); });
      ctx.directorList.forEach(function (n) { foundDirector.set(n, (foundDirector.get(n) || 0) + 1); });
      if (ctx.code) dlSeenCodes[ctx.code] = 1;

      var reasons = [];
      if (blockRule) hitDelta.set(blockRule.id, (hitDelta.get(blockRule.id) || 0) + 1);
      if (blocked) {
        reasons.push({ a: 'block', v: blockRule.value, t: blockRule.type, s: blockRule.scope || 'all' });
        // 临时放行：点过「仍然查看」的番号在有效期内不再屏蔽
        var peeked = !!(ctx.cid && S.peeks && S.peeks[ctx.cid] && (Date.now() - S.peeks[ctx.cid] < peekTtl()));
        if (peeked) {
          reasons.push({ a: 'peek', v: ctx.cid, t: 'code', s: 'title' });
          card.classList.add('cf-peek');   // 手动放行的卡片：淡绿虚线描边，便于识别
        } else if (st.previewMode) {
          // 规则预览：不真正隐藏，只描边提示「这里会被屏蔽」，便于确认有没有误杀
          card.classList.add('cf-preview', 'cf-card');
          try { card.dataset.cfCode = ctx.code || ''; card.dataset.cfA = ctx.actressList.join(' || '); } catch (e) { }
          whyMap.set(card, reasons);
          stats.blocked++; stats.preview = (stats.preview || 0) + 1;
          return;
        } else if (st.blockDisplay === 'soft') {
          // 灰化遮罩：灰化 + 模糊遮罩，卡片上浮出「仍然查看」按钮
          card.classList.add('cf-soft', 'cf-card');
          try { card.dataset.cfCode = ctx.code || ''; card.dataset.cfA = ctx.actressList.join(' || '); } catch (e) { }
          ensurePeekBtn(card, ctx.cid);
          whyMap.set(card, reasons);
          stats.blocked++; stats.soft++;
          return;
        } else {
          // 被屏蔽的卡片也要能悬停查看原因
          card.classList.add('cf-blocked', 'cf-card');
          // 保留占位（默认档）：挂 .cf-placeholder 把 display:none 换成 visibility:hidden，
          // 网格位置与卡片数量都不变，只是看不见。'hide' 档不挂，走上面的 display:none。
          if (st.blockDisplay !== 'hide') card.classList.add('cf-placeholder');
          whyMap.set(card, reasons);
          stats.blocked++;
          return;
        }
      }

      // 只记录没被屏蔽的内容（不想看的人不该被推荐）
      // 克隆卡片（补足抓来的下一页内容）跳过所有发现库/共现写入 ——
      // noteDiscovered 的口径是「你真实浏览过的内容」，补足的是同页之外的东西，
      // 记进去会让「推荐」与「规则体检的命中面」都被稀释。
      var isClone = card.classList.contains('cf-cloned');
      if (!isClone) {
        ctx.actressItems.forEach(function (it) { noteDiscovered('actress', it.name, { href: it.href }); });
        // 共现记录：为「相似女优」提供输入（含作品，供「共同出演」下钻）
        var _coA = card.querySelector('a[href]');
        var _coUrl = _coA ? absoluteUrl(_coA.getAttribute('href')) : '';
        ctx.actressList.forEach(function (n) { noteCooc(n, ctx, _coUrl); });
        ctx.actressList.forEach(function (n) { noteDiscovered('actress', n); });
        ctx.tagList.forEach(function (n) { noteDiscovered('tag', n); });
        ctx.makerList.forEach(function (n) { noteDiscovered('maker', n); });
        ctx.seriesList.forEach(function (n) { noteDiscovered('series', n); });
        ctx.directorList.forEach(function (n) { noteDiscovered('director', n); });
      }

      var isFav = !!favRule;
      if (favRule) hitDelta.set(favRule.id, (hitDelta.get(favRule.id) || 0) + 1);

      if (isFav) {
        card.classList.add('cf-fav'); stats.fav++;
        if (favRule) reasons.push({ a: 'favorite', v: favRule.value, t: favRule.type, s: favRule.scope || 'all' });
      }
      if (hlRule) {
        reasons.push({ a: 'highlight', v: hlRule.value, t: hlRule.type, s: hlRule.scope || 'all' });
        card.classList.add('cf-hl');
        var color = hlRule.color || st.hlColor || '#00e5ff';
        card.style.setProperty('--cf-hl-color', color);
        card.style.setProperty('--cf-hl-glow', hexToRgba(color, 0.5));
        hitDelta.set(hlRule.id, (hitDelta.get(hlRule.id) || 0) + 1);
        stats.hl++;
        if (st.pinHighlight && card.parentElement && card !== card.parentElement.firstElementChild) {
          if (!origPos.has(card)) origPos.set(card, { parent: card.parentElement, next: card.nextElementSibling });
          try { card.parentElement.insertBefore(card, card.parentElement.firstElementChild); } catch (e) { }
        }
      }

      if (st.sfw) card.classList.add('cf-sfw');

      // 已看 / 收藏 / 待看一律按 cid 记（番号站 cid 就是番号，非番号站是站点 ID）
      if (st.markSeen && ctx.cid && S.seen[ctx.cid]) card.classList.add('cf-seen');

      var favCode = !!(ctx.cid && S.favCodes[ctx.cid]);
      if (favCode) { card.classList.add('cf-favcode'); stats.fav++; }

      // 卡片 hover 的 ♥ 番号收藏按钮
      var fa = card.querySelector('a[href]');
      card.classList.add('cf-card');
      try { card.dataset.cfA = ctx.actressList.join(' || '); } catch (e) { }
      ensureFavBtn(card, ctx.cid, ctx.rawTitle, fa ? fa.getAttribute('href') : '');
      ensureWatchBtn(card, ctx.cid, ctx.rawTitle, fa ? fa.getAttribute('href') : '');

      var hideByFav = false;
      if (st.onlyFav && !isFav && !favCode) hideByFav = true;
      if (st.onlyFavCode && !favCode) hideByFav = true;
      if (hideByFav) { card.classList.add('cf-blocked'); stats.blocked++; reasons.push({ a: 'filter', v: st.onlyFavCode ? '只看★番号' : '只看收藏', t: 'filter', s: 'all' }); }

      if (favCode) reasons.push({ a: 'favcode', v: ctx.cid, t: 'code', s: 'title' });
      if (ctx.cid && S.watchlist && S.watchlist[ctx.cid]) {
        card.classList.add('cf-watch');
        reasons.push({ a: 'watch', v: ctx.cid, t: 'code', s: 'title' });
      }
      whyMap.set(card, reasons);
    });

    captureActressProfiles();
    probeLinks();
    flushHits();
    flushDisc();
    flushCooc();
    flushStats();
    applyFilter();
    renderStats();
    if (ui && ui.panel && ui.panel.classList.contains('open')) renderList();
    try {
      chrome.runtime.sendMessage({ type: 'sf_stats', blocked: stats.blocked }).catch(function () { });
    } catch (e) { }
    // 补足放到最后（不阻塞本轮渲染）：只有开了开关、且是已实测可用的番号站时才会真的发请求
    if (backfillAllowed()) doBackfill(origCount);
    } catch (e) { logErr('runPass', e); }
    finally {
      applying = false;
    }
  }

  var schedulePass = debounce(runPass, 260);

  /* ---------------- 番号站数量补足（需求 002 L2） ----------------
   * 解决的问题：「保留占位」虽然保住了格数，但卡片本身看不见了，列表还是显得稀。
   * 补足 = 去下一页抓卡片克隆过来，把「原始数量」填满。
   *
   * ⚠️ 这是全库唯一会发网络请求的地方（README 的「零网络请求」承诺必须在 README 里
   *    显式标注这个例外）。因此三道闸门缺一不可：
   *      ① 开关默认 off ② 仅在监管中的「番号站」 ③ 仅 JavDB580
   *    第 ③ 条是实测结论，不是保守：2026-09-22 真机抓取验证 ——
   *      · JavDB      → HTTP 200 但只有 1278B，被 Cloudflare 挑战 + 地区版权封锁
   *      · JavBus     → 302 到 /doc/driver-verify 年龄门
   *      · JavDB571   → HTTP 000（连接失败）
   *      · JavDB580   → HTTP 200 / 70KB 正常 SSR，?page=1 与 ?page=2 内容不同、选择器同构 ✅
   *    其余站抓了也拿不到卡片，硬做只会得到一个经常失效还容易被反爬盯上的功能。
   *
   * 只克隆、不改站点分页器；克隆卡片带 .cf-cloned 便于识别与清理；
   * 克隆卡片不写入发现库（noteDiscovered 只记真实浏览过的内容，克隆会污染推荐）。 */
  // 放行名单改由站点模板的 bf 标记驱动（见 SITE_TEMPLATES 注释）：
  // 只有 JavDB580 打 bf:true —— 上面那条实测结论就是名单本身，别再往名单里加站
  // （javdb.com 被 Cloudflare 挑战、javdb571 连不上、javbus 有年龄门，加了也只会
  //   每次都失败，白敲人家的站还容易被反爬盯上）。换站前请先重跑一遍真机抓取。）
  var BACKFILL_MAX_PAGES = 3;      // 最多补几页，防「整页全被屏蔽」时无限抓
  var BACKFILL_MIN_GAP = 1200;     // 同站两次请求最小间隔（ms），避免被判定爬虫
  var lastBackfillAt = 0;
  var backfilling = false;

  function backfillEnabled() {
    var v = S.settings && S.settings.backfill;
    return !!(v && v !== 'off');
  }
  // 补足目标数量：'same' = 补齐到屏蔽前的原始数量；数字 = 用户指定
  function backfillTarget(origCount) {
    var v = S.settings && S.settings.backfill;
    if (v === 'same' || v === true) return origCount;
    var n = parseInt(v, 10);
    return (n > 0) ? n : origCount;
  }
  function backfillAllowed() {
    if (!backfillEnabled()) return false;
    if (!currentSite) return false;
    // 该站点模板必须显式声明支持补足（bf: true）。模板取自当前主机名，
    // 与卡片识别同一套口径，不另立一份白名单（避免两处口径漂移）。
    var t = templateForHost(location.hostname);
    return !!(t && t.bf === true);
  }
  // 找出当前分页参数并推到下一页
  function nextPageUrl() {
    try {
      var u = new URL(location.href);
      var p = parseInt(u.searchParams.get('page') || '1', 10);
      if (isNaN(p) || p < 1) p = 1;
      u.searchParams.set('page', String(p + 1));
      return u.href;
    } catch (e) { return ''; }
  }
  // 清掉上一轮克隆的卡片（重跑前必做，否则越积越多）
  function removeClones() {
    var els = document.querySelectorAll('.cf-cloned');
    for (var i = 0; i < els.length; i++) {
      try { els[i].remove(); } catch (e) { }
    }
  }
  var cardSelOf = function () {
    var t = templateForHost(location.hostname);
    return (t && t.sel && t.sel.length) ? t.sel : ['.item'];
  };
  // 从一段 HTML 里抓出卡片元素（复用与 findCards 同一套选择器优先级）
  function cardsFromHtml(html) {
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return []; }
    if (!doc) return [];
    var sels = cardSelOf();
    for (var i = 0; i < sels.length; i++) {
      var got = doc.querySelectorAll(sels[i]);
      if (got.length >= 3) return Array.prototype.slice.call(got);
    }
    return [];
  }

  /* 当前「还看得见」的原生卡片数（排除克隆、排除被屏蔽的）。
   * ⚠️ 统计口径必须与 runPass 里的 `cards` 对齐：runPass 用的是 findCards()，
   *    它按选择器**优先级**取第一组满足的，不是把所有选择器并起来（`.item` 和
   *    `.movie-box` 常指向同一批卡片，并集会把数量翻倍）。所以这里同样走 findCards()。
   * 三档屏蔽下口径不同：
   *   soft        → 模糊但仍在，算「看得见」（视觉上是压缩过的，不该再补）
   *   placeholder → 原位置留白，等于看不见，要补
   *   hide        → display:none，等于看不见，要补 */
  function visibleCount() {
    var cards = findCards();
    var n = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.classList.contains('cf-cloned')) continue;
      if (c.classList.contains('cf-blocked') && !c.classList.contains('cf-placeholder')) continue;
      if (c.classList.contains('cf-filt-out')) continue;
      n++;
    }
    return n;
  }

  /* 卡片身份：用它自身详情链接的 pathname 作为指纹。
   * 用途是补足时的去重护栏。翻页有两个已知会「变旧」的风险：站点改了分页参数，
   * 或反爬拦截页伪装成 200 把第 1 页又吐回来。那时的失败模式是**把同一批卡片
   * 重复贴进列表**（用户看到重复内容，且不会有任何报错），比「什么都没补」更糟。
   * 有指纹就能把这种失败降级成「一张都不插」。
   * 取第一个 a[href]：列表卡的外层 <a> 就是详情链接。 */
  function cardHrefKey(el) {
    if (!el || !el.querySelector) return '';
    var a = el.querySelector('a[href]');
    if (!a) return '';
    var h = a.getAttribute('href') || '';
    if (!h || /^(#|javascript:)/i.test(h)) return '';
    try { return new URL(h, location.href).pathname.replace(/\/+$/, '').toLowerCase(); }
    catch (e) { return String(h).split('?')[0].replace(/\/+$/, '').toLowerCase(); }
  }

  function doBackfill(origCount) {
    if (backfilling) return;
    if (!backfillAllowed()) return;

    // 容器 = 原生卡片里最后一张的父节点（保持网格结构一致）。
    // ⚠️ 必须用 findCards() 取卡片，不能把 cardSelOf() 的选择器并起来 ——
    //    `.item` 与 `a.box`/`.movie-box` 常指向同一批卡片的**不同层级**，
    //    并集的最后一项是内层 <a>，它的 parentNode 是外层卡片而不是网格容器，
    //    克隆卡片会被塞进单个卡片的内部（真实表现：DOM 里找不到 .cf-cloned，功能静默失效）。
    var native = findCards().filter(function (c) { return !c.classList.contains('cf-cloned'); });
    if (!native.length) return;
    var container = native[native.length - 1].parentNode;
    if (!container) return;

    // 目标 = 用户配的口径（'same' 就是「补齐回原始数量」，数字就是用户指定的张数）。
    // ⚠️ 不能拿 origCount 去算 need：origCount 是**屏蔽前**的原生卡片数，此刻 DOM 里
    //    就这么多张，相减恒为 0，补足永远不会触发。真正的缺口是「原始数量 - 当前可见
    //    （未被屏蔽）数量」——也就是被屏蔽掉、需要拿新内容顶上的那一部分。
    var target = backfillTarget(origCount);
    var need = target - visibleCount();
    if (need <= 0) return;

    var now = Date.now();
    if (now - lastBackfillAt < BACKFILL_MIN_GAP) return;
    lastBackfillAt = now;
    backfilling = true;

    var pageUrl = nextPageUrl();
    if (!pageUrl) { backfilling = false; return; }
    var added = 0, pages = 0;

    // 去重护栏：页面上已有的卡片指纹先入集合，抓回来的重复内容一律跳过。
    // 顺带也拦住「第 2 页和第 3 页内容有重叠」这种常见情况。
    var seenKeys = {};
    native.forEach(function (c) { var k = cardHrefKey(c); if (k) seenKeys[k] = 1; });

    var step = function () {
      if (pages >= BACKFILL_MAX_PAGES || added >= need) {
        backfilling = false;
        // ⚠️ 这里**绝对不能**调 schedulePass()：
        //    runPass 开头就是 clearClones() + 重算 visibleCount()，
        //    克隆刚插进去就被清掉 → doBackfill 又判定 need>0 → 再抓一次 →
        //    无限循环打站点（实测 3 秒内发了 2 次请求，且永远不产生克隆）。
        //    克隆卡自己挂的 class 由 clearMarks/resetPassMarks 负责渲染，
        //    不需要再跑一轮完整 pass。只给用户一个反馈就够了。
        if (added) flashBall('已补足 ' + added + ' 张');
        return;
      }
      pages++;
      // credentials:'omit' —— 补足只是取公开列表页，不带 cookie，减少被识别为登录态爬虫的风险
      fetch(pageUrl, { credentials: 'omit' }).then(function (r) {
        if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
        return r.text();
      }).then(function (html) {
        var got = cardsFromHtml(html);
        if (!got.length) throw new Error('未解析出卡片');
        var fresh = 0;   // 本页真正新鲜（页面上还没有）的卡片数
        got.forEach(function (el) {
          if (added >= need) return;
          var key = cardHrefKey(el);
          if (key && seenKeys[key]) return;   // 重复内容：跳过，不插
          if (key) seenKeys[key] = 1;
          var clone = el.cloneNode(true);
          clone.classList.add('cf-cloned', 'cf-card');
          // 克隆卡不参与发现库写入，也不带原位置记录
          try { delete clone.dataset.cfCode; } catch (e) { }
          // 克隆卡是「补充内容」，不该再被本站规则二次处理（否则会被重新屏蔽，
          // 补足等于白补）。这里直接挂一条规则免疫标记，由 applyFilter/规则分支跳过。
          try { clone.dataset.cfClone = '1'; } catch (e) { }
          container.appendChild(clone);
          added++;
          fresh++;
        });
        // 一整页都是已有内容 → 翻页参数多半不对，再往下翻只是白敲人家的站。
        // 立刻收手（而不是把 BACKFILL_MAX_PAGES 页全抓一遍）。
        if (!fresh) {
          backfilling = false;
          if (added) flashBall('已补足 ' + added + ' 张');
          return;
        }
        // 抓够就停，否则顺延到再下一页
        var u = new URL(pageUrl);
        var p = parseInt(u.searchParams.get('page') || '1', 10) || 1;
        u.searchParams.set('page', String(p + 1));
        pageUrl = u.href;
        setTimeout(step, BACKFILL_MIN_GAP);
      }).catch(function (e) {
        // 失败降级：静默放弃，退回 placeholder 行为，只写日志
        backfilling = false;
        logErr('backfill', e);
      });
    };
    setTimeout(step, 300);
  }

  /* ---------------- 悬浮球 + 面板（Shadow DOM 隔离） ---------------- */
  var UI_CSS = [
    '.cf-host{position:fixed;z-index:2147483000;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;color:#e6e8ee;}',
    /* 悬浮球：径向渐变 + 内高光 + 外圈光晕；主色跟随高亮色（--hl） */
    '.cf-ball{position:fixed;width:48px;height:48px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;',
    'background:radial-gradient(circle at 32% 26%,#39415f 0%,#242a3d 52%,#141822 100%);',
    'border:1px solid rgba(255,255,255,.15);user-select:none;font-size:20px;line-height:1;color:var(--hl,#8bd5ff);',
    'box-shadow:0 8px 22px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.14),inset 0 -6px 12px rgba(0,0,0,.35);',
    'transition:transform .16s cubic-bezier(.2,.8,.3,1),box-shadow .18s,color .18s,filter .18s;}',
    '.cf-ball:hover{transform:scale(1.09);color:#eafcff;',
    'box-shadow:0 12px 28px rgba(0,0,0,.55),0 0 0 5px rgba(0,229,255,.10),inset 0 1px 0 rgba(255,255,255,.2);}',
    '.cf-ball:active{transform:scale(.95);}',
    '.cf-ball.dragging{transform:scale(1.13);cursor:grabbing;',
    'box-shadow:0 16px 34px rgba(0,0,0,.6),0 0 0 7px rgba(0,229,255,.14);}',
    /* 锁定位置：右下角挂一枚小锁，光标改成"点得动但拖不动"的抓手 */
    '.cf-ball.locked{cursor:pointer;}',
    '.cf-ball.locked::after{content:"🔒";position:absolute;right:-3px;bottom:-3px;width:17px;height:17px;border-radius:50%;',
    'background:#151824;border:1px solid rgba(255,255,255,.2);font-size:9px;line-height:16px;text-align:center;',
    'box-shadow:0 2px 6px rgba(0,0,0,.5);}',
    '.cf-ball.off{opacity:.4;}',
    '.cf-ball.hot{color:#ffc93c;border-color:rgba(255,201,60,.6);}',
    '.cf-panel{position:fixed;width:322px;max-height:74vh;display:none;flex-direction:column;overflow:hidden;',
    'background:rgba(20,22,32,.97);border:1px solid rgba(255,255,255,.12);border-radius:14px;',
    'box-shadow:0 16px 46px rgba(0,0,0,.6);backdrop-filter:blur(10px);}',
    '.cf-panel.open{display:flex;}',
    '.cf-panel.probe .cf-quick,.cf-panel.probe .cf-tg,.cf-panel.probe .cf-foot{display:none;}',
    '.cf-hd{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);}',
    '.cf-hd .t{font-weight:700;letter-spacing:.3px;color:#fff;}',
    '.cf-hd .sp{flex:1;}',
    '.cf-hd button{background:transparent;border:0;color:#9aa3b8;cursor:pointer;font-size:14px;padding:2px 5px;border-radius:5px;}',
    '.cf-hd button:hover{background:rgba(255,255,255,.08);color:#fff;}',
    '.cf-tg{display:flex;flex-wrap:wrap;gap:6px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.07);}',
    '.cf-tg label{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;cursor:pointer;',
    'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);font-size:12px;color:#c9cfdd;}',
    '.cf-tg label.on{background:rgba(0,229,255,.14);border-color:rgba(0,229,255,.45);color:#8beeff;}',
    '.cf-tg input{accent-color:#00e5ff;margin:0;}',
    /* 屏蔽显示方式的循环按钮：与 label 同款胶囊外观，但用 button 承载三档轮换 */
    '.cf-tg .cf-bd{display:inline-flex;align-items:center;padding:3px 8px;border-radius:20px;cursor:pointer;',
    'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);font-size:12px;color:#c9cfdd;',
    'font-family:inherit;transition:background .15s,border-color .15s,color .15s;}',
    '.cf-tg .cf-bd:hover{background:rgba(255,255,255,.1);color:#e6e8ee;}',
    '.cf-tg .cf-bd.cf-bd-on{background:rgba(0,229,255,.14);border-color:rgba(0,229,255,.45);color:#8beeff;}',
    '.cf-st{display:flex;gap:8px;padding:8px 12px;font-size:12px;color:#9aa3b8;border-bottom:1px solid rgba(255,255,255,.07);}',
    '.cf-st b{color:#fff;font-weight:600;}',
    '.cf-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px 0;}',
    '.cf-tabs button{flex:1 1 52px;min-width:52px;padding:5px 2px;border:0;border-radius:8px;cursor:pointer;font-size:11px;',
    'background:rgba(255,255,255,.04);color:#8b93a7;}',
    '.cf-tabs button.on{background:rgba(0,229,255,.13);color:#8beeff;font-weight:600;}',
    '.cf-tabs button.hide{display:none;}',
    '.cf-list{flex:1;overflow:auto;padding:8px 10px;min-height:110px;}',
    '.cf-row{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:8px;}',
    '.cf-row:hover{background:rgba(255,255,255,.05);}',
    '.cf-row .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dfe4ef;}',
    '.cf-row .c{font-size:11px;color:#6f7893;min-width:20px;text-align:right;}',
    '.cf-mini{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#aab2c6;',
    'border-radius:6px;font-size:11px;padding:2px 6px;cursor:pointer;}',
    '.cf-mini:hover{background:rgba(255,255,255,.12);color:#fff;}',
    '.cf-mini.act[data-a="block"]{background:rgba(255,77,109,.22);border-color:#ff4d6d;color:#ffb3c1;}',
    '.cf-mini.act[data-a="favorite"]{background:rgba(255,201,60,.22);border-color:#ffc93c;color:#ffe4a3;}',
    '.cf-mini.act[data-a="highlight"]{background:rgba(0,229,255,.18);border-color:currentColor;}',
    '.cf-empty{padding:18px 8px;text-align:center;color:#6f7893;font-size:12px;}',
    '.cf-dlrow{display:flex;align-items:center;gap:6px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.07);margin-bottom:5px;}',
    '.cf-dlrow:hover{background:rgba(255,255,255,.05);}',
    '.cf-dlrow .k{flex:none;font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(34,197,94,.18);color:#7ee2a8;}',
    '.cf-dlrow .k.magnet{background:rgba(0,229,255,.16);color:#8beeff;}',
    '.cf-dlrow .k.pan{background:rgba(255,159,28,.18);color:#ffcd85;}',
    '.cf-dlrow .k.torrent{background:rgba(124,92,255,.2);color:#c3b0ff;}',
    '.cf-dlrow .info{flex:1;min-width:0;overflow:hidden;}',
    '.cf-dlrow .n{font-size:12px;color:#dfe4ef;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.cf-dlrow .m{font-size:10px;color:#7a8399;margin-top:2px;}',
    /* 多站比价（建议 ②）：列表徽标 + 浮层 */
    '.cf-shopbadge{font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(124,92,255,.22);color:#c3b0ff;}',
    '.cf-gosrow{display:flex;gap:5px;flex-wrap:wrap;margin:-2px 0 7px;padding-left:2px;}',
    '.cf-shoppanel{position:fixed;z-index:2147483646;width:280px;background:#141821;border:1px solid rgba(255,255,255,.14);',
    'border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.55);padding:10px;font-size:12px;color:#dfe4ef;}',
    '.cf-shopphd{font-size:12px;color:#fff;margin-bottom:6px;display:flex;align-items:center;}',
    '.cf-shopptip{font-size:10px;color:#7a8399;line-height:1.5;margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,.08);}',
    '.cf-shoppgrid{display:flex;flex-direction:column;gap:5px;}',
    '.cf-shoprow{display:flex;align-items:center;gap:6px;}',
    '.cf-shopname{flex:none;width:44px;font-size:11px;color:#9beaff;text-decoration:none;}',
    '.cf-shopname:hover{text-decoration:underline;}',
    '.cf-shopmks{display:flex;gap:4px;flex-wrap:wrap;}',
    '.cf-shopmk{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#aab2c6;',
    'border-radius:5px;font-size:10px;padding:1px 5px;cursor:pointer;}',
    '.cf-shopmk:hover{background:rgba(255,255,255,.12);color:#fff;}',
    '.cf-shopmk.on{font-weight:600;}',
    '.cf-shoppf{display:flex;gap:6px;margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);}',
    '.cf-dlbar{display:flex;gap:6px;padding:0 0 8px;}',
    '.cf-dlbar button{flex:1;padding:5px 0;border-radius:7px;border:1px solid rgba(255,255,255,.14);',
    'background:rgba(255,255,255,.05);color:#dfe4ef;cursor:pointer;font-size:11px;}',
    '.cf-dlbar button:hover{background:rgba(255,255,255,.14);}',
    '.cf-quick{border-top:1px solid rgba(255,255,255,.08);padding:9px 12px;display:flex;flex-direction:column;gap:7px;}',
    '.cf-quick .r1{display:flex;gap:6px;}',
    '.cf-quick input{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);',
    'color:#fff;border-radius:7px;padding:5px 8px;font-size:12px;outline:none;}',
    '.cf-quick input:focus{border-color:rgba(0,229,255,.5);}',
    '.cf-quick select{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#dfe4ef;',
    'border-radius:7px;padding:5px 4px;font-size:12px;outline:none;}',
    '.cf-quick .r2{display:flex;gap:6px;align-items:center;}',
    '.cf-quick .r2 button{flex:1;padding:5px 0;border-radius:7px;border:1px solid rgba(255,255,255,.14);',
    'background:rgba(255,255,255,.05);color:#dfe4ef;cursor:pointer;font-size:12px;}',
    '.cf-quick .r2 button:hover{background:rgba(255,255,255,.13);}',
    '.cf-dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(255,255,255,.25);cursor:pointer;flex:none;}',
    '.cf-dot.on{box-shadow:0 0 0 2px rgba(255,255,255,.35);}',
    '.cf-foot{display:flex;gap:6px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.08);}',
    '.cf-foot button{flex:1;padding:5px 0;border-radius:7px;border:1px solid rgba(255,255,255,.12);',
    'background:rgba(255,255,255,.04);color:#aab2c6;cursor:pointer;font-size:11px;}',
    '.cf-foot button:hover{background:rgba(255,255,255,.12);color:#fff;}',
    '.cf-tip{padding:6px 12px;font-size:11px;color:#6f7893;border-top:1px solid rgba(255,255,255,.07);}',
    /* ---------- 按钮统一手感：按下回弹 + 过渡 + 键盘聚焦环 ----------
       放在各按钮基础样式之后，同权重靠顺序覆盖，不去改上面已经调好的配色 */
    '.cf-hd button{width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:8px;',
    'transition:background .15s,color .15s,transform .12s;}',
    '.cf-hd button:active{transform:scale(.88);}',
    '.cf-hd button.on{background:rgba(255,201,60,.16);color:#ffc93c;}',
    '.cf-tg label,.cf-tabs button,.cf-mini,.cf-quick .r2 button,.cf-foot button,.cf-filter button,.cf-dlbar button,.cf-tg .cf-bd{',
    'transition:background .15s,border-color .15s,color .15s,transform .12s;}',
    '.cf-tg label:active,.cf-tabs button:active,.cf-mini:active,.cf-tg .cf-bd:active,',
    '.cf-quick .r2 button:active,.cf-foot button:active,.cf-filter button:active{transform:scale(.94);}',
    '.cf-hd button:focus-visible,.cf-tabs button:focus-visible,.cf-mini:focus-visible,.cf-tg .cf-bd:focus-visible,',
    '.cf-quick .r2 button:focus-visible,.cf-foot button:focus-visible,.cf-filter button:focus-visible{',
    'outline:2px solid rgba(0,229,255,.75);outline-offset:1px;}',
    /* 推荐卡片墙 */
    '.cf-wall{display:grid;grid-template-columns:1fr 1fr;gap:7px;}',
    '.cf-vcard{position:relative;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:9px 9px 8px;cursor:pointer;',
    'background:rgba(255,255,255,.04);transition:transform .1s,border-color .15s,background .15s;overflow:hidden;min-height:54px;}',
    '.cf-vcard:hover{transform:translateY(-1px);border-color:rgba(0,229,255,.45);}',
    '.cf-vcard .vn{font-size:12px;color:#dfe4ef;font-weight:600;line-height:1.32;word-break:break-word;padding-right:26px;}',
    '.cf-vcard .vm{display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:4px;}',
    '.cf-vcard .vt{font-size:10px;color:#7a8399;}',
    '.cf-vcard .vc{font-size:10px;color:#5d6580;}',
    '.cf-vcard .pill{font-size:10px;padding:1px 6px;border-radius:10px;color:#0b0d14;font-weight:700;flex:none;}',
    '.cf-vcard .new{position:absolute;top:7px;right:7px;font-size:9px;padding:1px 5px;border-radius:9px;background:#ff4d6d;color:#fff;font-weight:700;}',
    '.cf-vcard.s-block{border-color:#ff4d6d;background:rgba(255,77,109,.13);}',
    '.cf-vcard.s-favorite{border-color:#ffc93c;background:rgba(255,201,60,.13);}',
    '.cf-vcard.s-highlight{border-color:#00e5ff;background:rgba(0,229,255,.13);}',
    '.cf-vcard.s-block .pill{background:#ff4d6d;}',
    '.cf-vcard.s-favorite .pill{background:#ffc93c;}',
    '.cf-vcard.s-highlight .pill{background:#00e5ff;}',
    '.cf-badge{display:inline-block;min-width:15px;padding:0 4px;margin-left:3px;border-radius:9px;background:#ff4d6d;color:#fff;font-size:10px;font-weight:700;vertical-align:middle;}',
    '.cf-onboard{margin:8px 10px 0;padding:9px 11px 9px 11px;border-radius:10px;background:rgba(0,229,255,.1);border:1px solid rgba(0,229,255,.35);',
    'font-size:11px;color:#cfeaef;line-height:1.7;position:relative;}',
    '.cf-onboard b{color:#8beeff;}',
    '.cf-onboard button{position:absolute;top:5px;right:7px;background:transparent;border:0;color:#8beeff;cursor:pointer;font-size:11px;}',
    '.cf-batchbar{display:flex;gap:5px;padding:0 0 9px;align-items:center;flex-wrap:wrap;}',
    '.cf-batchbar button{flex:1 1 64px;padding:5px 0;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#dfe4ef;cursor:pointer;font-size:11px;}',
    '.cf-batchbar button:hover{background:rgba(255,255,255,.13);}',
    '.cf-batchbar button.on{background:rgba(0,229,255,.16);border-color:rgba(0,229,255,.5);color:#8beeff;}',
    '.cf-wall.sel .cf-vcard{padding-left:26px;}',
    '.cf-wall.sel .cf-vcard::before{content:"";position:absolute;left:8px;top:50%;transform:translateY(-50%);width:14px;height:14px;border:1px solid rgba(255,255,255,.4);border-radius:4px;}',
    '.cf-wall.sel .cf-vcard.picked::before{background:#00e5ff;border-color:#00e5ff;}',
    /* 评分 / 日期 筛选栏 */
    '.cf-filter{display:flex;align-items:center;gap:6px;padding:6px 12px;border-top:1px solid rgba(255,255,255,.07);font-size:11px;color:#9aa3b8;}',
    '.cf-filter .fl{color:#8b93a7;}',
    '.cf-filter select,.cf-filter input{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#dfe4ef;border-radius:6px;padding:3px 5px;font-size:11px;outline:none;}',
    '.cf-filter button{padding:3px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#dfe4ef;cursor:pointer;font-size:11px;}',
    '.cf-filter button:hover{background:rgba(255,255,255,.13);}',
    /* 今日推荐图片墙 */
    '.cf-dwall{display:grid;grid-template-columns:1fr 1fr;gap:9px;}',
    '.cf-dcard{position:relative;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px;background:rgba(255,255,255,.03);}',
    '.cf-dcard.new{border-color:rgba(255,77,109,.55);background:rgba(255,77,109,.08);}',
    '.cf-dcard .dava{display:block;width:100%;height:96px;border-radius:9px;overflow:hidden;background:rgba(255,255,255,.05);position:relative;}',
    '.cf-dcard .dava img.dav{width:100%;height:100%;object-fit:cover;display:block;}',
    '.cf-dcard .dava .dini{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:30px;color:#7a8399;font-weight:700;}',
    '.cf-dcard .dava:hover{border-color:rgba(0,229,255,.5);}',
    '.cf-dcard .new{position:absolute;top:7px;right:7px;font-size:9px;padding:1px 6px;border-radius:9px;background:#ff4d6d;color:#fff;font-weight:700;z-index:2;}',
    '.cf-dcard .dn{margin-top:7px;font-size:12px;font-weight:600;color:#dfe4ef;line-height:1.3;word-break:break-word;}',
    '.cf-dcard .dm{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;}',
    '.cf-dcard .dm span{font-size:9px;padding:1px 5px;border-radius:8px;background:rgba(255,255,255,.07);color:#9aa3b8;}',
    '.cf-dcard .dm .dr{background:rgba(255,201,60,.16);color:#ffd970;}',
    '.cf-dcard .dm .dw{background:rgba(0,229,255,.14);color:#8beeff;}',
    '.cf-dcard .dm .dtag{background:rgba(124,92,255,.18);color:#bca8ff;padding:1px 5px;border-radius:6px;font-size:10px;}',
    '.cf-dcard .dbtns .cf-mini[data-act]{min-width:auto;}',
    '.cf-dcard .dm .dq{background:rgba(124,92,255,.16);color:#bca8ff;display:inline-flex;align-items:center;gap:5px;}',
    '.cf-dcard .dqbar{display:inline-block;width:42px;height:5px;border-radius:3px;background:rgba(255,255,255,.13);overflow:hidden;vertical-align:middle;}',
    '.cf-dcard .dqbar>span{display:block;height:100%;background:linear-gradient(90deg,#7c5cff,#00e5ff);}',
    '.cf-dcard .dreason{margin-top:5px;font-size:10px;color:#7a8399;line-height:1.4;}',
    '.cf-dcard .dbtns{display:flex;gap:4px;margin-top:7px;}',
    '.cf-dcard .dbtns .cf-mini{flex:1;padding:3px 0;font-size:10px;}',
    /* 全局搜索 */
    '.cf-searchwrap{padding:8px 12px 0;}',
    '.cf-search{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);',
    'color:#fff;border-radius:8px;padding:6px 9px;font-size:12px;outline:none;}',
    '.cf-search:focus{border-color:rgba(0,229,255,.5);}',
    '.cf-srow{display:flex;align-items:center;gap:6px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.07);margin-bottom:5px;}',
    '.cf-srow:hover{background:rgba(255,255,255,.05);}',
    '.cf-srow .st{font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(124,92,255,.18);color:#bca8ff;flex:none;}',
    '.cf-srow .sn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dfe4ef;font-size:12px;}',
    /* 冲突提示 */
    '.cf-warn{margin:8px 10px 0;padding:8px 10px;border-radius:10px;background:rgba(255,159,28,.12);border:1px solid rgba(255,159,28,.4);',
    'font-size:11px;color:#ffd9a3;line-height:1.6;}',
    '.cf-warn b{color:#ffc078;}',
    /* 点选卡片横幅 */
    '.cf-pick{margin:8px 10px 0;padding:8px 10px;border-radius:10px;background:rgba(0,229,255,.12);border:1px dashed rgba(0,229,255,.6);',
    'font-size:11px;color:#cfeaef;line-height:1.6;}',
    /* 相似推荐卡 */
    '.cf-simcard{display:flex;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:10px;margin-bottom:6px;background:rgba(255,255,255,.03);}',
    '.cf-simcard .sav{width:52px;height:64px;flex:none;border-radius:8px;overflow:hidden;background:rgba(255,255,255,.05);position:relative;}',
    '.cf-simcard .sav img{width:100%;height:100%;object-fit:cover;display:block;}',
    '.cf-simcard .sav .ini{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;color:#7a8399;font-weight:700;}',
    '.cf-simcard .sbody{flex:1;min-width:0;}',
    '.cf-simcard .snm{font-size:12px;font-weight:600;color:#dfe4ef;}',
    '.cf-simcard .srs{font-size:10px;color:#7a8399;line-height:1.45;margin-top:3px;word-break:break-word;}',
    '.cf-simcard .sbtns{display:flex;gap:4px;margin-top:6px;}',
    '.cf-simcard .sbtns .cf-mini{flex:1;padding:3px 0;font-size:10px;}',
    '.cf-simbadge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(124,92,255,.22);color:#c3b0ff;margin-left:5px;}',
    /* 相似度进度条 */
    '.cf-simcard .sbar{height:6px;border-radius:3px;background:rgba(255,255,255,.09);margin-top:6px;overflow:hidden;}',
    '.cf-simcard .sbar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#7c5cff,#00e5ff);}',
    /* 展开详情开关 */
    '.cf-simcard .stog{margin-top:5px;font-size:10px;color:#8beeff;cursor:pointer;user-select:none;}',
    '.cf-simcard .stog:hover{text-decoration:underline;}',
    /* 展开后的详情 */
    '.cf-simcard .sdetail{margin-top:6px;border-top:1px dashed rgba(255,255,255,.13);padding-top:5px;}',
    '.cf-simcard .sdh{font-size:10px;color:#7a8399;margin:6px 0 4px;letter-spacing:.3px;}',
    '.cf-simcard .sdb{display:flex;align-items:center;gap:5px;margin-bottom:3px;font-size:10px;color:#aab2c6;}',
    '.cf-simcard .sdb .l{width:30px;flex:none;color:#8b93a7;}',
    '.cf-simcard .sdb .t{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;}',
    '.cf-simcard .sdb .t i{display:block;height:100%;background:#00e5ff;}',
    '.cf-simcard .sdb .v{width:32px;flex:none;text-align:right;color:#dfe4ef;}',
    '.cf-simcard .sfr{display:flex;align-items:baseline;gap:5px;font-size:10px;padding:1px 0;}',
    '.cf-simcard .sfr .c1{flex:none;font-size:9px;padding:0 5px;border-radius:4px;background:rgba(124,92,255,.18);color:#bca8ff;}',
    '.cf-simcard .sfr .c2{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dfe4ef;}',
    '.cf-simcard .sfr .c3{flex:none;color:#6f7893;}',
    '.cf-simcard .swk{display:flex;align-items:baseline;gap:5px;font-size:10px;padding:1px 0;text-decoration:none;}',
    '.cf-simcard .swk .sc{flex:none;color:#8beeff;font-weight:600;}',
    '.cf-simcard .swk .st2{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7a8399;}',
    '.cf-simcard a.swk:hover .sc{text-decoration:underline;}',
    /* 待看看板（按优先级分栏） */
    '.cf-wstat{font-size:10px;color:#8b93a7;padding:0 0 7px;line-height:1.6;}',
    '.cf-wstat b{color:#dfe4ef;}',
    '.cf-wcol{border:1px solid rgba(255,255,255,.07);border-left:3px solid var(--pc);border-radius:9px;padding:6px;margin-bottom:7px;background:rgba(255,255,255,.02);}',
    '.cf-wcol .wchd{display:flex;align-items:center;gap:5px;font-size:11px;color:#dfe4ef;font-weight:600;margin-bottom:5px;}',
    '.cf-wcol .wdot{width:7px;height:7px;border-radius:50%;background:var(--pc);flex:none;}',
    '.cf-wcol .wcn{margin-left:auto;font-size:10px;color:#8b93a7;background:rgba(255,255,255,.06);border-radius:8px;padding:0 6px;}',
    '.cf-wempty{font-size:10px;color:#5d6580;padding:3px 2px;}',
    '.cf-wcard{border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px 7px;margin-bottom:5px;background:rgba(255,255,255,.03);}',
    '.cf-wcard:hover{background:rgba(255,255,255,.06);}',
    '.cf-wcard .wtop{display:flex;align-items:center;gap:5px;}',
    '.cf-wcard .wcode{font-size:12px;font-weight:600;color:#dfe4ef;}',
    '.cf-wcard .sp{flex:1;}',
    '.cf-wcard .wp{flex:none;padding:1px 7px;font-size:10px;}',
    '.cf-wcard .wtitle{font-size:10px;color:#7a8399;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.cf-wcard .wnote{display:block;margin-top:4px;font-size:10px;color:#cfd6e4;background:rgba(255,255,255,.05);',
    'border:1px dashed rgba(255,255,255,.14);border-radius:6px;padding:3px 6px;cursor:pointer;line-height:1.45;word-break:break-word;}',
    '.cf-wcard .wnote:hover{border-color:rgba(0,229,255,.45);}',
    '.cf-wcard .wnote.empty{color:#5d6580;}',
    '.cf-wcard .wnote-in{display:block;width:100%;box-sizing:border-box;margin-top:4px;font-size:10px;color:#fff;',
    'background:rgba(255,255,255,.08);border:1px solid rgba(0,229,255,.5);border-radius:6px;padding:3px 6px;outline:none;font-family:inherit;}',
    '.cf-wcard .wbtns{display:flex;gap:4px;margin-top:5px;}',
    '.cf-wcard .wbtns .cf-mini{flex:1;padding:3px 0;font-size:10px;text-align:center;text-decoration:none;line-height:1.5;}',
    '.cf-prio{flex:none;font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(255,77,109,.18);color:#ffb3c1;}',
    '.cf-prio.seen{background:rgba(122,131,153,.22);color:#aab2c6;}',
    /* XChina Collector 插槽位于 Shadow DOM，样式需随面板本体注入。 */
    '.cf-xchina-panel-slot:empty{display:none;}',
    '.cf-xchina-panel-slot{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.08);}',
    '.cf-xchina-panel-slot .sf-xchina-controls{display:flex;flex-direction:column;gap:4px;margin:0;position:relative;color:#dfe4ef;font:12px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
    '.cf-xchina-panel-slot .sf-xchina-control-row{display:flex;gap:3px;}',
    '.cf-xchina-panel-slot button{border:1px solid rgba(85,214,255,.65);border-radius:6px;background:#172433;color:#eafaff;padding:6px 9px;cursor:pointer;font:inherit;}',
    '.cf-xchina-panel-slot .sf-xchina-primary{flex:1;}',
    '.cf-xchina-panel-slot button:disabled{cursor:wait;opacity:.6;}',
    '.cf-xchina-panel-slot .sf-xchina-menu{position:absolute;top:100%;right:0;z-index:5;min-width:150px;padding:4px;border:1px solid rgba(140,190,220,.45);border-radius:7px;background:#101923;box-shadow:0 8px 24px rgba(0,0,0,.45);}',
    '.cf-xchina-panel-slot .sf-xchina-menu[hidden]{display:none;}',
    '.cf-xchina-panel-slot .sf-xchina-menu button{display:block;width:100%;border:0;text-align:left;background:transparent;}',
    '.cf-xchina-panel-slot .sf-xchina-status{color:#9ee6ff;font-size:11px;overflow-wrap:anywhere;}'
  ].join('');

  function buildUI() {
    if (ui) return;
    var host = document.createElement('div');
    host.className = 'cf-host';
    var sr = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = UI_CSS;

    var wrap = document.createElement('div');
    wrap.innerHTML = [
      '<div class="cf-ball" id="ball" title="SiteFilter（Alt+F 开合，可拖动）">◈</div>',
      '<div class="cf-panel" id="panel">',
      '  <div class="cf-hd"><span class="t">SiteFilter</span><span class="sp"></span>',
      '    <button data-act="opt" title="完整设置">⚙</button>',
      '    <button data-act="lock" id="lockBtn" title="锁定 / 解锁悬浮球位置">🔓</button>',
      '    <button data-act="close" title="关闭">✕</button></div>',
      '  <div class="cf-tg">',
      '    <label data-tg="enabled"><input type="checkbox" data-cb="enabled">过滤</label>',
      '    <label data-tg="sfw"><input type="checkbox" data-cb="sfw">SFW</label>',
      '    <label data-tg="onlyFav"><input type="checkbox" data-cb="onlyFav">只看收藏</label>',
      '    <label data-tg="onlyFavCode"><input type="checkbox" data-cb="onlyFavCode">只看★番号</label>',
      '    <button type="button" class="cf-bd" id="bdBtn" title="切换屏蔽后的显示方式"></button>',
      '    <label data-tg="previewMode"><input type="checkbox" data-cb="previewMode">规则预览</label>',
      '    <label data-tg="boss"><input type="checkbox" data-cb="boss">老板键</label>',
      '  </div>',
      '  <div class="cf-st" id="stats"></div>',
      '  <div class="cf-searchwrap"><input id="search" class="cf-search" placeholder="🔍 全局搜索：女优 / 标签 / 番号 / 规则…" /></div>',
      '  <div class="cf-filter" id="filter">',
      '    <span class="fl">筛选</span>',
      '    <select id="flRating" title="按评分下限筛选"><option value="">评分不限</option><option value="3">≥3.0</option><option value="4">≥4.0</option><option value="4.5">≥4.5</option></select>',
      '    <input id="flDate" type="date" title="只看此日期之后发行（YYYY-MM-DD）">',
      '    <button data-act="flClear">清除</button>',
      '  </div>',
      '  <div class="cf-tabs" id="tabs"></div>',
      '  <div class="cf-warn" id="warn" style="display:none"></div>',
      '  <div class="cf-pick" id="pick" style="display:none">🎯 <b>点选卡片模式</b>：请点击列表里任意一张卡片，扩展会记住它的选择器并保存到本页站点。</div>',
      '  <div class="cf-onboard" id="onboard" style="display:none"></div>',
      '  <div class="cf-list" id="list"></div>',
      '  <div class="cf-quick">',
      '    <div class="r1">',
      '      <input id="qin" placeholder="输入名称，回车快速屏蔽" />',
      '      <select id="qtype"><option value="actress">女优</option><option value="tag">标签</option>',
      '      <option value="maker">片商</option><option value="series">系列</option><option value="director">导演</option>',
      '      <option value="keyword">标题词</option><option value="code">番号</option></select>',
      '    </div>',
      '    <div class="r2">',
      '      <button data-add="block">屏蔽</button>',
      '      <button data-add="favorite">收藏</button>',
      '      <button data-add="highlight">高亮</button>',
      '      <span id="dots"></span>',
      '    </div>',
      '  </div>',
      '  <div class="cf-foot">',
      '    <button data-act="blockAll">本页女优全屏蔽</button>',
      '    <button data-act="clearAll">清空本页规则</button>',
      '    <button data-act="undo" title="撤销上一次规则修改">↶ 撤销</button>',
      '    <button data-act="revealHidden" title="临时显示被屏蔽的卡片，看清被隐藏了什么（不改规则）">👁 显示被隐藏</button>',
      '    <button data-act="importColl" id="importColl" class="cf-imp">📥导入本页收藏</button>',
      '    <button data-act="opt">完整设置</button>',
      '  </div>',
      '  <div class="cf-tip">Alt+F 开合面板 · Alt+S 模糊 · Alt+B 老板键 · <span data-act="lock" id="tipLock" style="cursor:pointer">Alt+L 锁定球</span></div>',
      '</div>'
    ].join('');

    sr.appendChild(style);
    sr.appendChild(wrap);
    document.documentElement.appendChild(host);

    var ball = sr.getElementById('ball');
    var panel = sr.getElementById('panel');
    var list = sr.getElementById('list');
    var statsEl = sr.getElementById('stats');
    var qin = sr.getElementById('qin');
    var qtype = sr.getElementById('qtype');
    var dots = sr.getElementById('dots');
    var tabsEl = sr.getElementById('tabs');
    var flRating = sr.getElementById('flRating');
    var flDate = sr.getElementById('flDate');
    var importBtn = sr.getElementById('importColl');
    var lockBtn = sr.getElementById('lockBtn');
    var searchEl = sr.getElementById('search');
    var warnEl = sr.getElementById('warn');
    var bdBtn = sr.getElementById('bdBtn');
    var pickEl = sr.getElementById('pick');

    var TABS = [
      { k: 'actress', t: '女优' }, { k: 'tag', t: '标签' }, { k: 'maker', t: '片商' },
      { k: 'series', t: '系列' }, { k: 'director', t: '导演' }, { k: 'keyword', t: '标题词' },
      { k: 'daily', t: '📅 今日' }, { k: 'recommend', t: '🆕推荐' }, { k: 'similar', t: '🔗相似' },
      { k: 'watch', t: '⏳待看' }, { k: 'favcode', t: '★番号' }, { k: 'download', t: '下载' }, { k: 'site', t: '本页' }
    ];
    tabsEl.innerHTML = TABS.map(function (x) {
      return '<button data-tab="' + x.k + '">' + x.t + '</button>';
    }).join('');

    COLORS.forEach(function (c) {
      var d = document.createElement('span');
      d.className = 'cf-dot' + (c === S.settings.hlColor ? ' on' : '');
      d.style.background = c;
      d.dataset.color = c;
      dots.appendChild(d);
    });

    ui = { host: host, sr: sr, ball: ball, panel: panel, list: list, stats: statsEl, qin: qin, qtype: qtype, dots: dots, tabs: tabsEl, tabDefs: TABS, flRating: flRating, flDate: flDate, importBtn: importBtn, lockBtn: lockBtn, search: searchEl, warn: warnEl, pick: pickEl, bdBtn: bdBtn };

    flRating.addEventListener('change', applyFilter);
    flDate.addEventListener('change', applyFilter);
    searchEl.addEventListener('input', function () {
      searchQuery = (searchEl.value || '').trim();
      renderList();
    });
    searchEl.addEventListener('keydown', function (e) { e.stopPropagation(); });
    searchEl.addEventListener('keyup', function (e) { e.stopPropagation(); });

    /* 待看备注：Enter 保存 / Esc 取消 / 失焦保存（就地还原，不整页重渲染） */
    sr.addEventListener('keydown', function (e) {
      var el = e.target;
      if (!el || el.id !== 'wnoteInput') return;
      if (e.key === 'Enter') { watchCommitInput(el, false); e.preventDefault(); }
      else if (e.key === 'Escape') { watchCommitInput(el, true); e.preventDefault(); }
      e.stopPropagation();
    });
    sr.addEventListener('keyup', function (e) {
      if (e.target && e.target.id === 'wnoteInput') e.stopPropagation();
    });
    sr.addEventListener('focusout', function (e) {
      var el = e.target;
      if (el && el.id === 'wnoteInput') watchCommitInput(el, false);
    });

    /* 事件绑定 */
    ball.addEventListener('click', function (e) {
      if (ball.dataset.moved === '1') { ball.dataset.moved = '0'; return; }
      togglePanel();
    });

    sr.addEventListener('click', function (e) {
      var t = e.target;
      if (t.tagName === 'INPUT' && t.dataset.cb) {
        var k = t.dataset.cb;
        S.settings[k] = t.checked;
        saveSettings();
        syncToggles();
        schedulePass();
        return;
      }
      if (t.dataset && t.dataset.tab) { activeTab = t.dataset.tab; renderList(); return; }
      if (t.id === 'bdBtn' || (t.dataset && t.dataset.bdcycle)) { cycleBd(); return; }
      if (t.dataset && t.dataset.fcv) { favFilter = t.dataset.fcv; renderFavCodes(); return; }
      if (t.dataset && t.dataset.watch) { watchDone(t.dataset.watch); return; }
      if (t.dataset && t.dataset.wdel) { watchRemove(t.dataset.wdel); return; }
      if (t.dataset && t.dataset.wprio) { watchSetPrio(t.dataset.wprio); return; }
      if (t.dataset && t.dataset.wnote) { watchStartEdit(t.dataset.wnote); return; }
      if (t.dataset && t.dataset.pickcard) { startPick(); return; }
      if (t.dataset && t.dataset.sjump) {
        var jt = t.dataset.sjump;
        if (jt === 'rule') { try { chrome.runtime.sendMessage({ type: 'sf_open_options' }); } catch (e) { } return; }
        activeTab = jt; searchQuery = ''; if (ui.search) ui.search.value = ''; renderList(); return;
      }
      if (t.dataset && t.dataset.sdet) {
        var sn = t.dataset.sdet;
        if (simOpen[sn]) delete simOpen[sn]; else simOpen[sn] = 1;
        renderSimilar();
        return;
      }
      if (t.dataset && t.dataset.act) {
        if (t.dataset.act === 'dailySeen') { dailySeen(t.dataset.name, t.dataset.type); return; }
        handleAct(t.dataset.act); return;
      }
      if (t.dataset && t.dataset.add) { quickAdd(t.dataset.add); return; }
      if (t.dataset && t.dataset.bact) { handleBatch(t.dataset.bact); return; }
      // 推荐卡片墙：点卡片循环 / 批量选择
      var vc = t.closest ? t.closest('.cf-vcard') : null;
      if (vc && vc.dataset.v) {
        if (recommendBatch) {
          var key = vc.dataset.t + '||' + vc.dataset.v;
          if (recommendSel.has(key)) recommendSel.delete(key); else recommendSel.add(key);
          vc.classList.toggle('picked');
        } else {
          cycleAction(vc.dataset.v, vc.dataset.t);
        }
        return;
      }
      if (t.dataset && t.dataset.color) {
        S.settings.hlColor = t.dataset.color; saveSettings(); syncDots(); return;
      }
      var mini = t.closest ? t.closest('.cf-mini') : null;
      if (mini && mini.dataset.a) {
        toggleRule(mini.dataset.name, mini.dataset.type || activeTab, mini.dataset.a);
        return;
      }
      // 下载链接：用本机下载工具打开磁力
      if (mini && mini.dataset.open != null) {
        var od = dlLinks[parseInt(mini.dataset.open, 10)];
        if (od) openInClient(od.raw);
        return;
      }
      // 下载链接：单条复制
      if (mini && mini.dataset.dl != null) {
        var d = dlLinks[parseInt(mini.dataset.dl, 10)];
        if (d) copyText(d.raw);
        return;
      }
      // 番号收藏：移除
      if (mini && mini.dataset.unfav) {
        toggleFavCode(mini.dataset.unfav, null);
        return;
      }
      // 多站比价：打开比价浮层
      if (mini && mini.dataset.shop) {
        showShopPanel(mini.dataset.shop);
        return;
      }
    });

    qin.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') quickAdd('block');
      e.stopPropagation();
    });
    qin.addEventListener('keyup', function (e) { e.stopPropagation(); });

    /* 拖动（锁定位置时整个拖动链路不启动，但仍然能点击开合面板） */
    var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    ball.addEventListener('mousedown', function (e) {
      if (S.settings.ballLock) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      ox = S.settings.ball.right; oy = S.settings.ball.bottom;
      ball.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dx = sx - e.clientX, dy = sy - e.clientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      S.settings.ball.right = clampBall(ox + dx, window.innerWidth);
      S.settings.ball.bottom = clampBall(oy + dy, window.innerHeight);
      applyPos();
    });
    window.addEventListener('mouseup', function (e) {
      if (dragging) {
        dragging = false;
        ball.classList.remove('dragging');
        if (moved) { ball.dataset.moved = '1'; saveSettings(); }
      }
    });
    applyPos();
    syncToggles();
    syncLockBtn();
    syncDots();
  }

  /* ---------------- 悬浮球位置：锁定 / 解锁 ---------------- */
  function ballLocked() { return !!S.settings.ballLock; }

  function toggleBallLock(force) {
    S.settings.ballLock = force != null ? !!force : !ballLocked();
    saveSettings();
    syncLockBtn();
    flashBall(ballLocked() ? '🔒' : '🔓', 900);
  }

  // 悬浮球锁定状态 → 按钮图标 / 提示 / 球体角标 / 底部提示文案
  function syncLockBtn() {
    if (!ui) return;
    var on = ballLocked();
    ui.ball.classList.toggle('locked', on);
    if (ui.lockBtn) {
      ui.lockBtn.textContent = on ? '🔒' : '🔓';
      ui.lockBtn.classList.toggle('on', on);
      ui.lockBtn.title = on ? '悬浮球位置已锁定（点此解锁，可重新拖动）' : '锁定悬浮球位置（锁定后拖不动）';
    }
    var tip = ui.sr && ui.sr.getElementById('tipLock');
    if (tip) tip.textContent = on ? 'Alt+L 解锁球' : 'Alt+L 锁定球';
    ui.ball.title = probeMode ? ui.ball.title
      : ('SiteFilter（Alt+F 开合' + (on ? '，位置已锁定' : '，可拖动') + '）');
  }

  // 悬浮球尺寸：48px，再留 12px 边距，保证缩小窗口后不会半个球飘到屏幕外
  var BALL_SIZE = 48, BALL_MARGIN = 12;
  function clampBall(v, viewport) {
    var max = Math.max(0, viewport - BALL_SIZE - BALL_MARGIN);
    return Math.max(0, Math.min(max, Number(v) || 0));
  }
  // 当前应显示的球位置（含越界收敛；不写回设置，避免 resize 时静默改掉用户存的位置）
  function ballBox() {
    var b = S.settings.ball || DEFAULT_SETTINGS.ball;
    return {
      right: clampBall(b.right, window.innerWidth),
      bottom: clampBall(b.bottom, window.innerHeight)
    };
  }

  function applyPos() {
    if (!ui) return;
    var b = ballBox();
    // 主色跟随「高亮色」设置，让球和卡片高亮描边是一套颜色
    ui.host.style.setProperty('--hl', S.settings.hlColor || DEFAULT_SETTINGS.hlColor);
    ui.ball.style.right = b.right + 'px';
    ui.ball.style.bottom = b.bottom + 'px';
    // 面板跟随悬浮球，贴右下角
    var pr = Math.max(8, b.right - 6);
    var pb = Math.max(8, b.bottom + 54);
    ui.panel.style.right = pr + 'px';
    ui.panel.style.bottom = pb + 'px';
    var maxH = window.innerHeight - pb - 20;
    ui.panel.style.maxHeight = Math.max(240, Math.min(600, maxH)) + 'px';
  }

  function togglePanel(force) {
    if (!ui) return;
    var open = force != null ? force : !ui.panel.classList.contains('open');
    ui.panel.classList.toggle('open', open);
    if (open) {
      // 当日有新人且还未看过推荐页 → 自动切到「🆕推荐」
      if (!probeMode && (!S.settings.lastRecDay || S.settings.lastRecDay !== todayStr())) {
        var nf = (recommendList(0).filter(function (d) { return d.isNew; })).length;
        if (nf > 0) { activeTab = 'recommend'; S.settings.lastRecDay = todayStr(); saveSettings(); }
      }
      renderOnboard();
      renderList();
    }
  }

  function syncToggles() {
    if (!ui) return;
    var cbs = ui.sr.querySelectorAll('input[data-cb]');
    for (var i = 0; i < cbs.length; i++) {
      var k = cbs[i].dataset.cb;
      cbs[i].checked = !!S.settings[k];
      var lab = cbs[i].parentElement;
      if (lab) lab.classList.toggle('on', !!S.settings[k]);
    }
    syncBdBtn();
  }

  /* 屏蔽显示方式：面板里用一枚按钮循环三档（设置页是下拉，见 options.html）。
     三档的顺序按「看得见的程度」递增：隐藏 → 占位 → 灰化。 */
  var BD_ORDER = ['hide', 'placeholder', 'soft'];
  function bdLabel(v) {
    if (v === 'hide') return '隐藏';
    if (v === 'soft') return '灰化';
    return '占位';
  }
  function syncBdBtn() {
    if (!ui || !ui.bdBtn) return;
    var cur = S.settings.blockDisplay || 'placeholder';
    if (BD_ORDER.indexOf(cur) === -1) cur = 'placeholder';
    ui.bdBtn.textContent = '屏蔽后：' + bdLabel(cur);
    ui.bdBtn.title = '屏蔽后的显示方式（点击循环切换）\n' +
      '隐藏 = 完全隐藏，格数会减少\n' +
      '占位 = 保留位置，格数不变（默认）\n' +
      '灰化 = 灰化遮罩 + 「仍然查看」临时放行';
    ui.bdBtn.classList.toggle('cf-bd-on', cur !== 'hide');
  }
  function cycleBd() {
    var cur = S.settings.blockDisplay || 'placeholder';
    var i = BD_ORDER.indexOf(cur);
    if (i === -1) i = 1;
    S.settings.blockDisplay = BD_ORDER[(i + 1) % BD_ORDER.length];
    saveSettings();
    syncBdBtn();
    schedulePass();
    flashBall(bdLabel(S.settings.blockDisplay));
  }

  function syncDots() {
    if (!ui) return;
    var ds = ui.dots.querySelectorAll('.cf-dot');
    for (var i = 0; i < ds.length; i++) ds[i].classList.toggle('on', ds[i].dataset.color === S.settings.hlColor);
  }

  function renderStats() {
    if (!ui) return;
    ui.stats.innerHTML = '卡片 <b>' + stats.cards + '</b> · 屏蔽 <b>' + stats.blocked + '</b>' +
      (stats.soft ? '（软 <b>' + stats.soft + '</b>）' : '') +
      (stats.preview ? '（预览 <b>' + stats.preview + '</b>）' : '') +
      ' · 收藏 <b>' + stats.fav + '</b> · 高亮 <b>' + stats.hl + '</b>' +
      (stats.dl ? ' · 下载 <b>' + stats.dl + '</b>' : '');
    ui.ball.classList.toggle('off', !S.settings.enabled || !!S.settings.boss);
    ui.ball.classList.toggle('hot', (stats.blocked > 0 || stats.dl > 0) && S.settings.enabled && !S.settings.boss);
    // 「显示被隐藏」按钮：无屏蔽时隐藏（避免占位与误导）；有屏蔽时显示计数并随揭示态切换文案
    var rb = ui.sr && ui.sr.querySelector('[data-act="revealHidden"]');
    if (rb) {
      rb.style.display = stats.blocked ? '' : 'none';
      rb.textContent = (revealHidden ? '🙈 恢复隐藏（' : '👁 显示被隐藏（') + stats.blocked + '）';
    }
    updateTabBadges();
  }

  // 面板「评分 / 日期」快速筛选：对未被屏蔽的卡片按 dataset 隐藏不匹配项（尽力而为）
  function applyFilter() {
    if (!ui || !ui.flRating || !ui.flDate) return;
    var rMin = parseFloat(ui.flRating.value) || 0;
    var dMin = ui.flDate.value || '';
    var cards = document.querySelectorAll('.cf-card');
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.classList.contains('cf-blocked')) continue;  // 已被规则屏蔽的不动
      var ok = true;
      if (rMin) {
        var r = parseFloat(c.dataset.cfRating);
        if (!(r >= rMin)) ok = false;
      }
      if (dMin) {
        var d = c.dataset.cfDate || '';
        if (!d || d < dMin) ok = false;
      }
      c.classList.toggle('cf-filt-out', !ok);
    }
  }

  // 推荐标签上的红色新人徽标
  function updateTabBadges() {
    if (!ui) return;
    // 实时统计「7 天内新面孔且未建规则」的数量
    var n = 0;
    var disc = S.discovered || {};
    var now = Date.now();
    Object.keys(disc).forEach(function (k) {
      var d = disc[k];
      if (d && d.v && !findRule(d.v, d.type) && (now - (d.first || 0)) < 7 * 864e5) n++;
    });
    stats.newFaces = n;
    var btns = ui.sr.querySelectorAll('.cf-tabs button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.dataset.tab !== 'recommend') continue;
      b.innerHTML = '🆕推荐' + (n ? '<span class="cf-badge">' + n + '</span>' : '');
    }
  }

  // 首次使用引导
  function renderOnboard() {
    if (!ui) return;
    var el = ui.sr.getElementById('onboard');
    if (!el) return;
    if (S.settings.onboarded) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<button data-act="onboardClose" title="不再提示">知道了 ✕</button>' +
      '👋 欢迎使用！把鼠标移到卡片上，左上角会出现 <b>♥</b> 收藏按钮；' +
      '点右下角 <b>🆕推荐</b> 看每日新人，点一下卡片就能「屏蔽 / 收藏 / 高亮」。' +
      '所有数据只存在你这台电脑上。';
  }

  var TAB_LABEL = {
    actress: '女优', tag: '标签', maker: '片商', series: '系列', director: '导演',
    keyword: '标题关键词', code: '番号', expr: '表达式'
  };

  function mapOf(tab) {
    if (tab === 'actress') return foundActress;
    if (tab === 'tag') return foundTag;
    if (tab === 'maker') return foundMaker;
    if (tab === 'series') return foundSeries;
    if (tab === 'director') return foundDirector;
    return null;
  }

  function renderList() {
    if (!ui) return;

    // 探测模式下只保留「下载」页
    var tabs = ui.sr.querySelectorAll('.cf-tabs button');
    for (var i = 0; i < tabs.length; i++) {
      var k = tabs[i].dataset.tab;
      tabs[i].classList.toggle('on', k === activeTab);
      tabs[i].classList.toggle('hide', probeMode && k !== 'download');
    }
    if (probeMode && activeTab !== 'download') activeTab = 'download';

    renderWarn();
    renderPickBanner();

    // 全局搜索优先于任何页签
    if (searchQuery) { renderSearch(); return; }

    if (activeTab === 'download') { renderDownloads(); return; }
    if (activeTab === 'favcode') { renderFavCodes(); return; }
    if (activeTab === 'recommend') { renderRecommend(); return; }
    if (activeTab === 'daily') { renderDaily(); return; }
    if (activeTab === 'similar') { renderSimilar(); return; }
    if (activeTab === 'watch') { renderWatch(); return; }

    if (activeTab === 'site') {
      var sel = (currentSite && currentSite.selector) || '自动识别';
      var cnt = 0;
      S.rules.forEach(function (r) { if (r.enabled) cnt++; });
      var kinds = ['女优 ' + foundActress.size, '标签 ' + foundTag.size, '片商 ' + foundMaker.size,
        '系列 ' + foundSeries.size, '导演 ' + foundDirector.size].join(' · ');
      ui.list.innerHTML =
        '<div class="cf-dlbar"><button data-pickcard="1">🎯 点选卡片（自动记住选择器）</button></div>' +
        '<div class="cf-empty" style="text-align:left;line-height:1.9">' +
        '站点：<b style="color:#8beeff">' + escapeHtml(currentSite ? (currentSite.note || currentSite.pattern) : '未纳入监管') + '</b><br>' +
        '匹配规则：<b style="color:#8beeff">' + escapeHtml(currentSite ? currentSite.pattern : '-') + '</b><br>' +
        '卡片选择器：<b style="color:#8beeff">' + escapeHtml(sel) + '</b><br>' +
        '生效规则数：<b style="color:#8beeff">' + cnt + '</b> / ' + S.rules.length + '<br>' +
        '本页识别：' + escapeHtml(kinds) +
        '</div>';
      return;
    }

    if (activeTab === 'keyword' || activeTab === 'code') {
      ui.list.innerHTML = '<div class="cf-empty">在下方输入框直接输入' +
        (activeTab === 'code' ? '番号 / 番号前缀（如 SSNI、ABC-123）' : '标题关键词') +
        '，回车 = 屏蔽，或点「收藏 / 高亮」</div>';
      return;
    }

    var map = mapOf(activeTab);
    if (!map) { ui.list.innerHTML = '<div class="cf-empty">未知维度</div>'; return; }

    var names = Array.from(map.keys()).sort(function (a, b) { return map.get(b) - map.get(a); }).slice(0, 150);
    if (!names.length) {
      ui.list.innerHTML = '<div class="cf-empty">本页未识别到' + (TAB_LABEL[activeTab] || activeTab) +
        '。<br>该维度依赖站点把链接写成 /studio/、/series/ 这类路径；<br>也可在「完整设置」里为站点指定卡片选择器。</div>';
      return;
    }

    var html = names.map(function (n) {
      var cur = findRule(n, activeTab);
      return '<div class="cf-row">' +
        '<span class="n" title="' + escapeHtml(n) + '">' + escapeHtml(n) + '</span>' +
        '<span class="c">' + map.get(n) + '</span>' +
        miniBtn('block', n, activeTab, cur && cur.action === 'block') +
        miniBtn('favorite', n, activeTab, cur && cur.action === 'favorite') +
        miniBtn('highlight', n, activeTab, cur && cur.action === 'highlight') +
        '</div>';
    }).join('');
    ui.list.innerHTML = html;
  }

  /* ---------------- 磁力交给本机下载工具 ----------------
   * 扩展不下载磁力（那是 P2P，得靠迅雷/μTorrent/qBittorrent 等），只负责把
   * magnet: 交给本机下载工具。两种方式：
   *   · Tier A（默认）：造一个隐形 <a href="magnet:"> 并 click，浏览器把它路由给
   *     系统里**已注册的默认 magnet 处理程序**。不需要本机桥。
   *   · Tier B（填了 magnetClient 才走）：把磁力发给本机桥，由它用**你指定的 exe** 打开。
   *     扩展自身无法启动任意 exe，所以必须有本机桥（见 native-host/）。
   * Tier B 失败（桥没装/路径错/超时）时**自动回退 Tier A**，保证「点了总有反应」，
   * 同时在面板内说明失败原因。 */
  var magnetHintShown = false;
  function openViaSystemDefault(raw) {
    try {
      var a = document.createElement('a');
      a.href = raw;
      a.rel = 'noreferrer';
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      if (a.parentNode) a.parentNode.removeChild(a);
    } catch (e) { /* 唤起失败绝不影响主流程 */ }
  }
  function openViaNative(raw, client) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage({ type: 'sf_magnet_open', magnet: raw, client: client }, function (resp) {
          try { void chrome.runtime.lastError; } catch (e) { }   // 读一下，避免 "Unchecked runtime.lastError"
          if (resp && resp.ok) resolve(resp.result || {});
          else reject((resp && resp.error) || { code: 'no-response', message: '本机桥无响应。' });
        });
      } catch (e) {
        reject({ code: 'send-failed', message: String((e && e.message) || e) });
      }
    });
  }
  function openInClient(raw) {
    if (!raw || !/^magnet:/i.test(raw)) return;
    var client = String((S.settings && S.settings.magnetClient) || '').trim();
    if (!client) {
      openViaSystemDefault(raw);
      if (!magnetHintShown) { magnetHintShown = true; magnetOpenHint(); }
      return;
    }
    openViaNative(raw, client).catch(function (err) {
      openViaSystemDefault(raw);   // 回退：本机桥不可用时仍用系统默认打开
      magnetOpenHint(err);
    });
  }
  function magnetOpenHint(err) {
    try {
      var sr = ui && ui.host && ui.host.shadowRoot;
      var bar = sr && sr.querySelector('.cf-dlbar');
      if (!bar || !bar.parentNode) return;
      var prev = bar.parentNode.querySelector('.cf-maghint');
      // 通用提示只给一次；失败提示每次都更新（用户需要看到具体原因）
      if (prev && !err) return;
      if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
      var tip = document.createElement('div');
      tip.className = 'cf-maghint cf-tip';
      tip.style.cssText = 'margin-top:6px;color:#ffd27f';
      tip.textContent = (err && err.message)
        ? ('自定义下载器没打开（' + err.message + '），已回退到系统默认 magnet 处理程序。')
        : '已尝试用本机下载工具打开；若没反应，请确认已安装迅雷/μTorrent/qBittorrent 并设为系统默认 magnet 处理程序。';
      bar.parentNode.insertBefore(tip, bar.nextSibling);
    } catch (e) { }
  }

  /* ---------------- 下载链接页 ---------------- */
  function renderDownloads() {
    if (!dlLinks.length) {
      ui.list.innerHTML = '<div class="cf-empty">本页未探测到磁力 / 电驴 / 迅雷 / 种子 / 网盘链接。<br><br>' +
        '支持的来源：&lt;a href&gt;、data-clipboard-text 属性、页面正文里的纯文本 magnet: 串。<br>' +
        '同一种子（infohash 相同）会自动归并，保留最全的文件名与全部 tracker。<br>' +
        '任意网页都会自动探测（可在「通用设置」关闭）。</div>';
      return;
    }
    var ma = S.settings.magnetAction || 'copy';
    var showOpen = ma !== 'copy';
    var showCopy = ma !== 'open';
    var bar = '<div class="cf-dlbar">' +
      '<button data-act="copyAllMagnet">复制全部磁力</button>' +
      '<button data-act="copyAll">复制全部链接</button>' +
      (showOpen ? '<button data-act="openAllMagnet">用下载工具打开全部磁力</button>' : '') +
      '</div>';

    var rows = dlLinks.map(function (d, i) {
      var meta = [];
      if (d.size) meta.push(d.size);
      if (d.quality) meta.push(d.quality);
      if (d.pan) meta.push(d.pan);
      // 磁力特有信息：v2 标记 / tracker 条数（同 infohash 已归并，这个数=可用线路数）
      var m = d.magnet;
      if (m) {
        if (m.algo === 'btmh') meta.push('v2');
        if (m.trs && m.trs.length > 1) meta.push(m.trs.length + ' trackers');
      }
      var badge = d.type === 'magnet' && m
        ? '<span class="k magnet">' + (m.algo === 'btmh' ? 'MAGNET·V2' : 'MAGNET') + '</span>'
        : '<span class="k ' + d.type + '">' + d.type.toUpperCase() + '</span>';
      var btns = '';
      if (d.type === 'magnet' && showOpen) btns += '<button class="cf-mini" data-open="' + i + '">打开</button>';
      if (showCopy) btns += '<button class="cf-mini" data-dl="' + i + '">复制</button>';
      return '<div class="cf-dlrow">' +
        badge +
        '<span class="info"><span class="n" title="' + escapeHtml(d.raw) + '">' + escapeHtml(d.label) + '</span>' +
        (meta.length ? '<span class="m">' + escapeHtml(meta.join(' · ')) + '</span>' : '') + '</span>' +
        btns +
        '</div>';
    }).join('');
    ui.list.innerHTML = bar + rows;
  }

  /* ---------------- 推荐页（见过但还没建规则 · 可视化卡片墙） ---------------- */
  function renderRecommend() {
    var all = recommendList(0);
    if (!all.length) {
      ui.list.innerHTML = '<div class="cf-empty">还没有推荐。<br><br>正常浏览几页后，扩展会自动记下见过的女优 / 标签 / 片商 / 系列，' +
        '并把「还没建规则」的推荐到这里，点一下卡片就能加。<br><br>被屏蔽规则命中的内容不会被记录。</div>';
      return;
    }
    var fresh = all.filter(function (d) { return d.isNew; });
    var today = all.filter(function (d) { return d.isToday; });
    var list = all.slice(0, 80);   // 全部待标记，新面孔已排在前面

    var head = '<div class="cf-empty" style="padding:4px 4px 10px;text-align:left;line-height:1.7">' +
      '今日新发现 <b style="color:#8beeff">' + today.length + '</b> · 7 天内新面孔 <b style="color:#8beeff">' + fresh.length + '</b> · 待标记共 <b style="color:#8beeff">' + all.length + '</b> 个' +
      '<br><span style="color:#5d6580">点卡片循环：无→屏蔽→收藏→高亮；开「批量选择」可一次处理多个</span></div>';

    var bar = '';
    if (recommendBatch) {
      bar = '<div class="cf-batchbar">' +
        '<button data-bact="selmode" class="on">退出选择</button>' +
        '<button data-bact="batchBlock">选中全屏蔽</button>' +
        '<button data-bact="batchFav">选中全收藏</button>' +
        '<button data-bact="batchClear">清空选择</button>' +
        '</div>';
    } else {
      bar = '<div class="cf-batchbar"><button data-bact="selmode">批量选择（' + recommendSel.size + '）</button></div>';
    }

    var wall = '<div class="cf-wall' + (recommendBatch ? ' sel' : '') + '">' +
      list.map(function (d) {
        var cur = findRule(d.v, d.type);
        var st = cur ? cur.action : '';
        var pill = st === 'block' ? '屏蔽' : (st === 'favorite' ? '★收藏' : (st === 'highlight' ? '高亮' : ''));
        var cls = st ? (' s-' + st) : '';
        var picked = recommendBatch && recommendSel.has(d.type + '||' + d.v) ? ' picked' : '';
        return '<div class="cf-vcard' + cls + picked + '" data-v="' + escapeHtml(d.v) + '" data-t="' + d.type + '">' +
          (d.isNew ? '<span class="new">NEW</span>' : '') +
          '<div class="vn">' + escapeHtml(d.v) + '</div>' +
          '<div class="vm"><span class="vt">' + (TAB_LABEL[d.type] || d.type) + ' · ' + d.n + '次</span>' +
          (pill ? '<span class="pill">' + pill + '</span>' : '') + '</div>' +
          '</div>';
      }).join('') + '</div>';

    ui.list.innerHTML = head + bar + wall;
  }

  /* ---------------- 今日推荐页（图片墙 + 每日自动生成） ---------------- */
  function renderDaily() {
    var today = todayStr();
    var recs = (S.dailyRecs && S.dailyRecs[today]) || [];
    if (!recs.length) {
      ui.list.innerHTML =
        '<div class="cf-empty">今日推荐还是空的。<br><br>' +
        '推荐基于你「发现库」里见过的女优自动生成——需要先浏览过含女优的页面（扩展会默默记下）。<br>' +
        '点下面按钮可立即生成；也可在「完整设置 → 每日推荐」里调整数量、开关。</div>' +
        '<div class="cf-dlbar"><button data-act="genDaily">立即生成今日推荐</button></div>' +
        '<div class="cf-empty" style="margin-top:10px;color:#5d6580">想让推荐更准：多浏览几个含女优的列表/详情页（头像也会被一并记下），' +
        '或在设置里把「每日推荐上限」调高、勾选「纳入旧高质量用户」。</div>';
      return;
    }

    var newN = recs.filter(function (r) { return r.reasonType === 'new'; }).length;
    var head = '<div class="cf-empty" style="padding:4px 4px 8px;text-align:left;line-height:1.6">' +
      '今日推荐 <b style="color:#8beeff">' + recs.length + '</b> 位 · <b style="color:#8beeff">' + newN + '</b> 位新人 · 其余按质量排序' +
      '<br><span style="color:#5d6580">缺头像的，点「补全头像资料」从对应站点页拉取（需先浏览过该站）</span></div>';

    var bar = '<div class="cf-dlbar">' +
      '<button data-act="genDaily">重新生成</button>' +
      '<button data-act="enrichDaily">补全头像资料</button>' +
      '<button data-act="dailyAllFav">全部收藏</button></div>';

    var wall = '<div class="cf-dwall">' + recs.map(function (r) {
      var ty = r.type || 'actress';
      var ini = escapeHtml((r.name || '?').slice(0, 1));
      var inner = r.avatar
        ? '<span class="dini">' + ini + '</span><img class="dav" src="' + escapeHtml(r.avatar) +
          '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
        : '<span class="dini">' + ini + '</span>';
      var ava = r.href
        ? '<a class="dava" href="' + escapeHtml(r.href) + '" target="_blank" rel="noopener">' + inner + '</a>'
        : '<div class="dava">' + inner + '</div>';
      var meta = [];
      if (ty !== 'actress') meta.push('<span class="dtag">' + (ty === 'maker' ? '片商' : '系列') + '</span>');
      if (r.rating) meta.push('<span class="dr">★' + Number(r.rating).toFixed(1) + '</span>');
      if (r.works) meta.push('<span class="dw">' + r.works + '作</span>');
      var q = r.quality || 0;
      meta.push('<span class="dq">质量 ' + q +
        '<span class="dqbar"><span style="width:' + q + '%"></span></span></span>');
      return '<div class="cf-dcard' + (r.reasonType === 'new' ? ' new' : '') + '">' +
        ava +
        (r.reasonType === 'new' ? '<span class="new">NEW</span>' : '') +
        '<div class="dn">' + escapeHtml(r.name) + '</div>' +
        '<div class="dm">' + meta.join('') + '</div>' +
        '<div class="dreason">' + escapeHtml(r.reason) + '</div>' +
        '<div class="dbtns">' +
          miniBtn('block', r.name, ty, false) +
          miniBtn('favorite', r.name, ty, false) +
          miniBtn('highlight', r.name, ty, false) +
          (r.href ? '<a class="cf-mini" href="' + escapeHtml(r.href) + '" target="_blank" rel="noopener">去看</a>' : '') +
          '<button class="cf-mini" data-act="dailySeen" data-name="' + escapeHtml(r.name) + '" data-type="' + ty + '">我看过了</button>' +
        '</div>' +
        '</div>';
    }).join('') + '</div>';

    ui.list.innerHTML = head + bar + wall;
  }

  // 用户手动触发：从对应 star 页补全头像/评分/作品数（同源 fetch，仅点击时执行）
  // 今日推荐：标记「我看过了」→ 记女优/片商已看反馈 + 从今日流移除
  function dailySeen(name, type) {
    if (!name) return;
    var ty = type || 'actress';
    if (ty === 'actress') bumpActressSeen(name);   // 同时计入发现库已看
    recordFeedback(ty, name, 'seen');
    var today = todayStr();
    S.dailyRecs = S.dailyRecs || {};
    S.dailyRecs[today] = (S.dailyRecs[today] || []).filter(function (r) {
      return !(r.name === name && (r.type || 'actress') === ty);
    });
    saveState({ dailyRecs: S.dailyRecs, recFeedback: S.recFeedback });
    if (activeTab === 'daily') renderDaily();
  }

  // 记录对每日推荐的操作反馈（供后台调权/排除）
  function recordFeedback(type, name, kind) {
    S.recFeedback = S.recFeedback || {};
    var k = type + '|' + name;
    var e = S.recFeedback[k] || { blocked: 0, faved: 0, seen: 0, last: 0 };
    e[kind] = (e[kind] || 0) + 1; e.last = Date.now();
    S.recFeedback[k] = e;
    bumpFeedbackDaily(kind);   // 同时按天累计，供看板画采纳率曲线
  }

  function enrichDaily() {
    if (!ui) return;
    var today = todayStr();
    var recs = (S.dailyRecs && S.dailyRecs[today]) || [];
    var pending = recs.filter(function (r) { return r.href && r.href.indexOf('http') === 0; });
    if (!pending.length) {
      ui.list.innerHTML = '<div class="cf-empty">没有可补全的条目（需要先浏览过对应站点、且推荐项带有链接）。</div>' + ui.list.innerHTML;
      return;
    }
    ui.list.innerHTML = '<div class="cf-empty">正在从站点页补全资料（' + pending.length + ' 位）…请在当前已打开的对应站点页面上操作，否则会被跨域拦截。</div>';
    var done = 0, hadErr = false;
    pending.forEach(function (r) {
      fetch(r.href, { credentials: 'omit' }).then(function (res) { return res.text(); }).then(function (html) {
        var p = new DOMParser().parseFromString(html, 'text/html');
        // 头像：star 页上通常是 <img> 在带 avatar / photo 的容器里
        var imgs = p.querySelectorAll('img');
        var av = '';
        for (var i = 0; i < imgs.length; i++) {
          var im = imgs[i], cls = (im.className || '') + ' ' + ((im.parentElement && im.parentElement.className) || '');
          if (/avatar|photo|star|actress|big|profile/i.test(cls) && im.getAttribute('src')) { av = im.getAttribute('src'); break; }
        }
        if (av && av.charAt(0) === '/') av = location.origin + av;
        if (av && av.indexOf('//') === 0) av = location.protocol + av;
        // 评分 / 作品数（尽力提取，站点结构不同可能为空）
        var rt = (p.querySelector('.star-info .score, [class*="rating"]') || {}).textContent || '';
        var m = rt.match(/(\d+(?:\.\d+)?)/);
        var rating = m ? Number(m[1]) : 0;
        var wk = (p.documentElement.textContent || '').match(/(\d{2,5})\s*(?:部|作品|影片)/);
        var works = wk ? Number(wk[1]) : 0;
        // 更新发现库源 + 今日推荐条目
        var key = 'actress|' + r.name;
        S.discovered = S.discovered || {};
        if (S.discovered[key]) {
          S.discovered[key].avatar = av || S.discovered[key].avatar;
          if (rating) S.discovered[key].rating = rating;
          if (works) S.discovered[key].works = works;
        }
        r.avatar = av || r.avatar;
        if (rating) r.rating = rating;
        if (works) r.works = works;
        if (r.reasonType !== 'new') r.reason = (rating ? '评分 ' + rating.toFixed(1) : '') + (works ? ' · 作品 ' + works : '') || r.reason;
      }).catch(function () { hadErr = true; }).then(function () {
        done++;
        if (done >= pending.length) {
          S.dailyRecs = S.dailyRecs || {};
          S.dailyRecs[today] = recs;
          saveState({ dailyRecs: S.dailyRecs, discovered: S.discovered });
          if (activeTab === 'daily') renderDaily();
        }
      });
    });
  }

  /* ---------------- 番号收藏页 ---------------- */
  function renderFavCodes() {
    var keys = Object.keys(S.favCodes || {});
    var onPage = keys.filter(function (c) { return dlSeenCodes[c]; });

    if (!keys.length) {
      ui.list.innerHTML = '<div class="cf-empty">番号收藏夹是空的。<br><br>把鼠标移到卡片上，' +
        '左上角会出现 ♥ 按钮，点一下即可收藏该番号（会自动带上标题和链接）。</div>';
      return;
    }
    // 已看 / 未看 交叉筛选
    var list = (onPage.length && favFilter === 'all') ? onPage : keys;
    if (favFilter === 'seen') list = keys.filter(function (c) { return !!S.seen[c]; });
    else if (favFilter === 'unseen') list = keys.filter(function (c) { return !S.seen[c]; });
    var seenN = keys.filter(function (c) { return !!S.seen[c]; }).length;

    var bar = '<div class="cf-dlbar">' +
      '<button data-fcv="all"' + (favFilter === 'all' ? ' style="border-color:rgba(0,229,255,.5);color:#8beeff"' : '') + '>全部 ' + keys.length + '</button>' +
      '<button data-fcv="unseen"' + (favFilter === 'unseen' ? ' style="border-color:rgba(0,229,255,.5);color:#8beeff"' : '') + '>未看 ' + (keys.length - seenN) + '</button>' +
      '<button data-fcv="seen"' + (favFilter === 'seen' ? ' style="border-color:rgba(0,229,255,.5);color:#8beeff"' : '') + '>已看 ' + seenN + '</button>' +
      '</div>' +
      '<div class="cf-dlbar"><button data-act="exportFavCodes">复制全部番号</button>' +
      '<button data-act="clearFavCodes">清空收藏夹</button></div>';

    if (!list.length) { ui.list.innerHTML = bar + '<div class="cf-empty">该筛选下没有番号。</div>'; return; }

    var rows = list.slice(0, 200).map(function (c) {
      var it = S.favCodes[c];
      var mk = shopMarkCount(c);
      return '<div class="cf-dlrow">' +
        '<span class="k">★</span>' +
        '<span class="info"><span class="n">' + escapeHtml(c) + (S.seen[c] ? ' <span style="color:#6f7893;font-size:10px">已看</span>' : '') +
        (mk ? ' <span class="cf-shopbadge" title="你在 ' + mk + ' 个站点做过标记">比价 ' + mk + '</span>' : '') + '</span>' +
        '<span class="m">' + escapeHtml((it && it.t) || '') + '</span></span>' +
        '<button class="cf-mini" data-shop="' + escapeHtml(c) + '" title="多站比价：一键齐开 + 本地标记">比价</button>' +
        '<button class="cf-mini" data-unfav="' + escapeHtml(c) + '">移除</button>' +
        '</div>' +
        (S.settings.codeSearchBtns === false ? '' : '<div class="cf-gosrow">' + codeSearchBtns(c) + '</div>');
    }).join('');
    ui.list.innerHTML = bar + rows;
  }

  /* ---------------- 比价浮层：一键齐开 + 逐站标记 ---------------- */
  function showShopPanel(code) {
    hideShopPanel();
    if (!code) return;
    var m = shopMarkOf(code) || {};
    var el = document.createElement('div');
    el.className = 'cf-shoppanel';
    var rows = CODE_SITES.map(function (cs) {
      var e = m[cs.n] || {};
      var marks = SHOP_FIELDS.map(function (f) {
        var on = !!e[f[0]];
        return '<button class="cf-shopmk' + (on ? ' on' : '') + '" data-shopmk="' + f[0] + '" data-site="' + escapeHtml(cs.n) + '" ' +
          'style="' + (on ? ('color:' + f[2] + ';border-color:' + f[2]) : '') + '">' + f[1] + '</button>';
      }).join('');
      var u = cs.tpl.replace('{q}', encodeURIComponent(code));
      return '<div class="cf-shoprow">' +
        '<a class="cf-shopname" href="' + escapeHtml(u) + '" target="_blank" rel="noopener">' + escapeHtml(cs.n) + '</a>' +
        '<span class="cf-shopmks">' + marks + '</span></div>';
    }).join('');
    el.innerHTML =
      '<div class="cf-shopphd"><b>' + escapeHtml(code) + '</b> · 多站比价' +
      '<button class="cf-mini" id="cfShopClose" style="float:right">✕</button></div>' +
      '<div class="cf-shopptip">各站是否有货 / 有磁力，要靠你自己看 —— 扩展不代你抓取（这些站有反爬，抓了也常失效）。' +
      '看到的情况勾在这里，会累积成本地记录，下次一眼可见。</div>' +
      '<div class="cf-shoppgrid">' + rows + '</div>' +
      '<div class="cf-shoppf"><button class="cf-mini" id="cfShopAll">一键齐开全部站点</button>' +
      '<button class="cf-mini" id="cfShopClear">清空本番号标记</button></div>';
    document.documentElement.appendChild(el);

    // 位置：面板左侧；贴边则改到右侧
    try {
      var pr = ui && ui.panel ? ui.panel.getBoundingClientRect() : null;
      var w = el.getBoundingClientRect().width || 260;
      var left = pr ? (pr.left - w - 10) : 20;
      if (left < 8) left = pr ? (pr.right + 10) : 20;
      el.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + 'px';
      el.style.top = Math.max(8, (pr ? pr.top : 60)) + 'px';
    } catch (e) { }

    el.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.id === 'cfShopClose') { hideShopPanel(); return; }
      if (t.id === 'cfShopAll') { openAllSites(code); return; }
      if (t.id === 'cfShopClear') {
        if (S.shopMarks) delete S.shopMarks[code];
        saveState({ shopMarks: S.shopMarks || {} });
        flashBall('已清空 ' + code + ' 的标记');
        hideShopPanel();
        renderFavCodes();
        return;
      }
      var f = t.dataset && t.dataset.shopmk;
      if (f) { toggleShopMark(code, t.dataset.site, f); showShopPanel(code); }
    });
  }
  function hideShopPanel() {
    try {
      var old = document.querySelector('.cf-shoppanel');
      if (old) old.remove();
    } catch (e) { }
  }

  /* ---------------- 面板内全局搜索 ---------------- */
  function renderSearch() {
    var q = searchQuery.toLowerCase();
    var out = [];

    // 1) 规则
    (S.rules || []).forEach(function (r) {
      if (String(r.value).toLowerCase().indexOf(q) === -1) return;
      out.push({ kind: 'rule', label: r.value, type: r.type, action: r.action, on: r.enabled !== false });
    });
    // 2) 发现库
    Object.keys(S.discovered || {}).forEach(function (k) {
      var d = S.discovered[k];
      if (!d || !d.v || String(d.v).toLowerCase().indexOf(q) === -1) return;
      out.push({ kind: 'disc', label: d.v, type: d.type, n: d.n });
    });
    // 3) 番号收藏
    Object.keys(S.favCodes || {}).forEach(function (c) {
      if (String(c).toLowerCase().indexOf(q) === -1) return;
      out.push({ kind: 'code', label: c, type: 'code' });
    });
    // 4) 待看队列
    Object.keys(S.watchlist || {}).forEach(function (c) {
      if (String(c).toLowerCase().indexOf(q) === -1) return;
      out.push({ kind: 'watch', label: c, type: 'code' });
    });

    if (!out.length) {
      ui.list.innerHTML = '<div class="cf-empty">没有匹配「' + escapeHtml(searchQuery) + '」的结果。<br>可搜索：规则 / 发现库女优标签 / 番号收藏 / 待看队列。</div>';
      return;
    }
    var seen = {};
    var rows = out.filter(function (x) {
      var k = x.kind + '|' + x.label;
      if (seen[k]) return false; seen[k] = 1; return true;
    }).slice(0, 80).map(function (x) {
      var chip = x.kind === 'rule' ? ('规则·' + (TAB_LABEL[x.type] || x.type)) :
        (x.kind === 'code' ? '★番号' : (x.kind === 'watch' ? '⏳待看' : (TAB_LABEL[x.type] || x.type)));
      var btns;
      if (x.kind === 'code' || x.kind === 'watch') {
        btns = '<button class="cf-mini" data-sjump="' + (x.kind === 'code' ? 'favcode' : 'watch') + '">定位</button>';
      } else {
        btns = miniBtn('block', x.label, x.type, x.action === 'block') +
          miniBtn('favorite', x.label, x.type, x.action === 'favorite') +
          miniBtn('highlight', x.label, x.type, x.action === 'highlight');
      }
      return '<div class="cf-srow">' +
        '<span class="st">' + escapeHtml(chip) + '</span>' +
        '<span class="sn" title="' + escapeHtml(x.label) + '">' + escapeHtml(x.label) +
        (x.n ? ' <span style="color:#6f7893;font-size:10px">·' + x.n + '次</span>' : '') + '</span>' +
        btns + '</div>';
    }).join('');
    ui.list.innerHTML = '<div class="cf-empty" style="padding:2px 4px 8px;text-align:left">搜索「' + escapeHtml(searchQuery) + '」共 ' + out.length + ' 条</div>' + rows;
  }

  /* ---------------- 相似推荐页（基于收藏女优的 IDF 加权相似度） ---------------- */
  var DIM_LABEL = { tag: '标签', series: '系列', maker: '片商', director: '导演' };
  var simOpen = {};   // 名字 -> 1 表示展开「为什么像」详情

  function simWorkRow(x) {
    var inner = '<span class="sc">' + escapeHtml(x.code) + '</span>' +
      '<span class="st2">' + escapeHtml(x.t || '') + '</span>';
    return x.u
      ? '<a class="swk swk2" href="' + escapeHtml(x.u) + '" target="_blank" rel="noopener">' + inner + '</a>'
      : '<div class="swk swk2">' + inner + '</div>';
  }

  // 展开后的详情：相似度构成 / 共同点明细 / 共同出演作品 / 她的其他作品
  function simDetailHtml(r) {
    var h = '<div class="sdetail">';

    var parts = r.parts || {};
    var dims = Object.keys(parts).filter(function (d) { return parts[d] > 0; })
      .sort(function (a, b) { return parts[b] - parts[a]; });
    if (dims.length) {
      h += '<div class="sdh">相似度构成</div>';
      dims.forEach(function (d) {
        h += '<div class="sdb"><span class="l">' + escapeHtml(DIM_LABEL[d] || d) + '</span>' +
          '<span class="t"><i style="width:' + parts[d] + '%"></i></span>' +
          '<span class="v">' + parts[d] + '%</span></div>';
      });
    }

    var sh = r.shared || [];
    if (sh.length) {
      h += '<div class="sdh">共同点明细（稀有度越高，越能说明"像"）</div>';
      sh.slice(0, 8).forEach(function (x) {
        h += '<div class="sfr"><span class="c1">' + escapeHtml(DIM_LABEL[x.dim] || x.dim) + '</span>' +
          '<span class="c2" title="' + escapeHtml(x.f) + '">' + escapeHtml(x.f) + '</span>' +
          '<span class="c3">稀有 ' + x.idf + ' · 种子' + x.s + '/她' + x.c + '</span></div>';
      });
    }

    var both = (r.works || []).filter(function (x) { return x.both; });
    if (both.length) {
      h += '<div class="sdh">共同出演作品（同一部里都出现过）</div>';
      both.slice(0, 6).forEach(function (x) { h += simWorkRow(x); });
    }

    var other = (r.works || []).filter(function (x) { return !x.both; });
    if (other.length) {
      h += '<div class="sdh">她的其他作品（你浏览过的）</div>';
      other.slice(0, 6).forEach(function (x) { h += simWorkRow(x); });
    }

    if (!dims.length && !sh.length && !(r.works || []).length) {
      h += '<div class="sdh">暂无明细：需要更多浏览数据（含女优 + 标签的列表/详情页）。</div>';
    }
    h += '<div class="sdh">种子：' + escapeHtml(r.seed || '-') + '</div>';
    return h + '</div>';
  }

  function renderSimilar() {
    var today = todayStr();
    var recs = (S.similarRecs && S.similarRecs[today]) || [];
    var seeds = (S.rules || []).filter(function (r) {
      return r.enabled !== false && r.type === 'actress' && (r.action === 'favorite' || r.action === 'highlight');
    });
    var head = '<div class="cf-empty" style="padding:4px 4px 8px;text-align:left;line-height:1.6">' +
      '以你<b style="color:#ffd970">收藏 / 高亮</b>的女优为种子（当前 <b style="color:#8beeff">' + seeds.length + '</b> 位），' +
      '用「共同标签 / 片商 / 系列 / 导演」的 IDF 加权相似度推荐。<br>' +
      '<span style="color:#5d6580">罕见标签权重更高，"跟谁都像的热门标签"会被自动压低。点每张卡的「为什么？」可看相似度构成与共同出演作品。</span></div>';

    if (!seeds.length) {
      ui.list.innerHTML = head + '<div class="cf-empty">还没有收藏任何女优。<br><br>先把几位喜欢的女优设为 <b>★收藏</b>，再回来点「重新计算」。</div>';
      return;
    }
    if (!recs.length) {
      ui.list.innerHTML = head + '<div class="cf-empty">暂无可推荐的相似女优。<br><br>相似度依赖「共现数据」——需要你先浏览过含女优 + 标签的列表/详情页。' +
        '点下面按钮立即计算。</div>' +
        '<div class="cf-dlbar"><button data-act="genSimilar">重新计算相似推荐</button></div>';
      return;
    }
    var bar = '<div class="cf-dlbar"><button data-act="genSimilar">重新计算</button>' +
      '<button data-act="similarAllFav">全部收藏</button></div>';
    var cards = recs.map(function (r) {
      var ini = escapeHtml((r.name || '?').slice(0, 1));
      var ava = '<div class="sav">' + (r.avatar
        ? '<span class="ini">' + ini + '</span><img src="' + escapeHtml(r.avatar) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
        : '<span class="ini">' + ini + '</span>') + '</div>';
      var pct = Math.max(1, Math.min(100, Math.round((r.sim || 0) * 100)));
      var open = !!simOpen[r.name];
      return '<div class="cf-simcard">' + ava +
        '<div class="sbody">' +
        '<div class="snm">' + escapeHtml(r.name) + '<span class="cf-simbadge">相似 ' + pct + '%</span></div>' +
        '<div class="sbar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="srs">' + escapeHtml(r.reason || '') + '</div>' +
        '<div class="stog" data-sdet="' + escapeHtml(r.name) + '">' + (open ? '收起详情 ▲' : '为什么？展开详情 ▼') + '</div>' +
        (open ? simDetailHtml(r) : '') +
        '<div class="sbtns">' +
        miniBtn('block', r.name, 'actress', false) +
        miniBtn('favorite', r.name, 'actress', false) +
        miniBtn('highlight', r.name, 'actress', false) +
        (r.href ? '<a class="cf-mini" href="' + escapeHtml(r.href) + '" target="_blank" rel="noopener">去看</a>' : '') +
        '</div></div></div>';
    }).join('');
    ui.list.innerHTML = head + bar + cards;
  }

  /* ---------------- 待看队列页（优先级看板 + 备注） ---------------- */
  function watchMd() {
    var keys = Object.keys(S.watchlist || {});
    var lines = ['# 待看队列片单', '', '导出时间：' + new Date().toLocaleString('zh-CN'),
      '共 ' + keys.length + ' 部', ''];
    PRIO.forEach(function (p) {
      var mine = keys.filter(function (c) { return prioOf(S.watchlist[c]) === p.v; })
        .sort(function (a, b) { return (S.watchlist[b].at || 0) - (S.watchlist[a].at || 0); });
      if (!mine.length) return;
      lines.push('## ' + p.t + '优先级（' + mine.length + ' 部）');
      mine.forEach(function (c) {
        var it = S.watchlist[c] || {};
        lines.push('- [ ] **' + c + '**' + (it.t ? ' ' + it.t : '') + (S.seen[c] ? ' `已看`' : '') + (it.u ? ' — ' + it.u : ''));
        if (it.note) lines.push('  - 备注：' + it.note);
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function watchCard(c, p) {
    var it = S.watchlist[c] || {};
    var note = it.note || '';
    var tags = (dlSeenCodes[c] ? '<span class="cf-prio">本页</span>' : '') +
      (S.seen[c] ? '<span class="cf-prio seen">已看</span>' : '');
    return '<div class="cf-wcard" data-wcode="' + escapeHtml(c) + '">' +
      '<div class="wtop"><span class="wcode">' + escapeHtml(c) + '</span>' + tags +
      '<span class="sp"></span>' +
      '<button class="cf-mini wp" data-wprio="' + escapeHtml(c) + '" title="切换优先级（低 → 中 → 高）">' + p.t + '</button></div>' +
      '<div class="wtitle" title="' + escapeHtml(it.t || '') + '">' + escapeHtml(it.t || '(无标题)') + '</div>' +
      '<span class="wnote' + (note ? '' : ' empty') + '" data-wnote="' + escapeHtml(c) + '" title="点击编辑备注">' +
      escapeHtml(note || '＋备注') + '</span>' +
      '<div class="wbtns">' +
      '<button class="cf-mini" data-watch="' + escapeHtml(c) + '" title="标记已看并移出队列">已看</button>' +
      (it.u ? '<a class="cf-mini" href="' + escapeHtml(it.u) + '" target="_blank" rel="noopener">打开</a>' : '') +
      '<button class="cf-mini" data-wdel="' + escapeHtml(c) + '" title="仅移除">移除</button>' +
      '</div></div>';
  }

  function renderWatch() {
    var keys = Object.keys(S.watchlist || {});
    if (!keys.length) {
      ui.list.innerHTML = '<div class="cf-empty">待看队列是空的。<br><br>把鼠标移到卡片上，点左上角的 <b>⏳</b> 按钮，' +
        '把「想看但还没决定收藏」的片子先丢进来。<br><br>进来后可以按<b>优先级</b>分栏、给每部写<b>备注</b>。</div>';
      return;
    }
    var counts = { 0: 0, 1: 0, 2: 0 };
    keys.forEach(function (c) { counts[prioOf(S.watchlist[c])]++; });

    var head = '<div class="cf-dlbar">' +
      '<button data-act="copyWatch">复制番号</button>' +
      '<button data-act="exportWatchMd">导出片单</button>' +
      '<button data-act="clearWatch">清空</button></div>' +
      '<div class="cf-wstat">共 <b>' + keys.length + '</b> 部 · ' +
      PRIO.map(function (p) { return '<span style="color:' + p.c + '">' + p.t + ' ' + counts[p.v] + '</span>'; }).join(' · ') +
      '</div>';

    var board = PRIO.map(function (p) {
      var mine = keys.filter(function (c) { return prioOf(S.watchlist[c]) === p.v; })
        .sort(function (a, b) { return (S.watchlist[b].at || 0) - (S.watchlist[a].at || 0); });
      return '<div class="cf-wcol" style="--pc:' + p.c + '">' +
        '<div class="wchd"><span class="wdot"></span>' + p.t + '优先级<span class="wcn">' + mine.length + '</span></div>' +
        (mine.length ? mine.map(function (c) { return watchCard(c, p); }).join('') : '<div class="cf-wempty">暂无</div>') +
        '</div>';
    }).join('');
    ui.list.innerHTML = head + board;
  }

  /* ---------------- 冲突提示 / 点选横幅 ---------------- */
  function renderWarn() {
    if (!ui || !ui.warn) return;
    var cs = computeConflicts();
    if (!cs.length) { ui.warn.style.display = 'none'; return; }
    ui.warn.style.display = '';
    var names = cs.slice(0, 6).map(function (c) { return escapeHtml(c.value); }).join('、');
    ui.warn.innerHTML = '⚠️ 有 <b>' + cs.length + '</b> 个目标同时被「屏蔽」和「收藏/高亮」：' + names +
      (cs.length > 6 ? ' 等' : '') + '。<br>屏蔽优先生效，收藏/高亮不会显示。点「↶ 撤销」或到设置页调整。';
  }
  function renderPickBanner() {
    if (!ui || !ui.pick) return;
    ui.pick.style.display = pickMode ? '' : 'none';
  }
  function startPick() {
    if (!currentSite) { alert('请先在监管站点上使用「点选卡片」。'); return; }
    pickMode = true;
    renderPickBanner();
    togglePanel(false);
  }

  function miniBtn(action, name, type, on) {
    var label = action === 'block' ? '屏蔽' : (action === 'favorite' ? '★' : '高亮');
    var color = '';
    if (action === 'highlight' && on) {
      var r = findRule(name, type);
      color = ';color:' + (r && r.color ? r.color : S.settings.hlColor);
    }
    return '<button class="cf-mini' + (on ? ' act' : '') + '" data-a="' + action + '" data-name="' +
      escapeHtml(name) + '" data-type="' + type + '" style="' + color + '">' + label + '</button>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function findRule(value, type) {
    for (var i = 0; i < S.rules.length; i++) {
      var r = S.rules[i];
      if (r.type === type && String(r.value).toLowerCase() === String(value).toLowerCase()) return r;
    }
    return null;
  }

  /* ---------------- 规则增删改 ---------------- */
  function addRule(opt) {
    var value = String(opt.value || '').trim();
    if (!value) return;
    var type = opt.type || 'actress';
    var existing = findRule(value, type);
    if (existing) {
      existing.action = opt.action || existing.action;
      existing.enabled = true;
      if (opt.color) existing.color = opt.color;
      existing.scope = opt.scope || existing.scope || (SCOPE_OF[type] || 'all');
    } else {
      S.rules.push({
        id: uid(),
        type: type,
        value: value,
        aliases: opt.aliases || [],
        action: opt.action || 'block',
        match: opt.match || 'contains',
        scope: opt.scope || (SCOPE_OF[type] || 'all'),
        color: opt.color || S.settings.hlColor || '#00e5ff',
        sites: opt.sites || [],
        enabled: true,
        hits: 0, createdAt: Date.now()
      });
    }
    saveRules();
    schedulePass();
  }

  function toggleRule(name, type, action) {
    var cur = findRule(name, type);
    if (!cur && !confirmImpact(name, type, action)) return;
    snapshot(cur ? '修改规则' : '新增规则');
    if (cur && cur.action === action) {
      cur.enabled = false;
      S.rules = S.rules.filter(function (r) { return r.id !== cur.id; });
    } else {
      addRule({ value: name, type: type, action: action });
    }
    // 来自今日推荐的操作 → 记反馈
    var ty = type || 'actress';
    if (isDailyRec(name, ty)) recordFeedback(ty, name, action === 'block' ? 'blocked' : (action === 'favorite' ? 'faved' : 'seen'));
    saveRules();
    schedulePass();
    setTimeout(renderList, 60);
  }

  /* ---------------- 临时规则（带有效期） ----------------
     右键卡片选「临时屏蔽 N 天」即可；到期后后台自动移除，不用记得回来关。 */
  function addTempRule(name, type, days) {
    var cur = findRule(name, type);
    snapshot(cur ? '修改规则' : '新增临时规则');
    // addRule 不返回规则对象（它只负责 push + 落盘），建完再取一次
    if (!cur) addRule({ value: name, type: type, action: 'block' });
    var r = findRule(name, type);
    if (!r) return;
    r.action = 'block';
    r.enabled = true;
    r.expiresAt = Date.now() + Math.max(1, Number(days) || 7) * 86400000;
    saveRules();
    schedulePass();
    setTimeout(renderList, 60);
    flashBall('临时屏蔽 ' + (Math.round((r.expiresAt - Date.now()) / 86400000)) + ' 天');
  }

  /* ---------------- 建规则前的影响面预估 ----------------
     用发现库估算这条规则会波及多少条目，过宽时先问一句，避免一键误杀一大片。 */
  function estimateImpact(value, type) {
    var disc = S.discovered || {};
    var v = String(value || '').toLowerCase();
    var t = type || 'actress';
    var n = 0, total = 0, samples = [];
    Object.keys(disc).forEach(function (k) {
      var it = disc[k] || {};
      if ((it.type || '') !== t) return;
      total++;
      if (String(it.v || '').toLowerCase().indexOf(v) !== -1) {
        n++;
        if (samples.length < 6) samples.push(it.v);
      }
    });
    return { n: n, total: total, samples: samples };
  }

  // 返回 true = 继续建规则；false = 用户取消了
  function confirmImpact(value, type, action) {
    if (!S.settings.auditWarn) return true;
    if (action !== 'block') return true;
    var est = estimateImpact(value, type);
    if (est.n < 8 || (est.total && est.n / est.total < 0.25)) return true;
    if (typeof confirm !== 'function') return true;
    var msg = '这条屏蔽规则会影响发现库里 ' + est.n + ' 个' + TYPE_LABEL_OF(type) +
      '条目（共 ' + est.total + ' 个）：\n\n  ' + est.samples.join('、') +
      (est.n > est.samples.length ? ' …等' : '') + '\n\n确定要屏蔽吗？\n\n' +
      '（可在设置 → 通用设置里关掉「建屏蔽规则前先确认影响面」）';
    try { return !!confirm(msg); } catch (e) { return true; }
  }

  function TYPE_LABEL_OF(t) {
    var m = { actress: '女优', tag: '标签', maker: '片商', series: '系列', director: '导演', keyword: '标题词', code: '番号', expr: '表达式' };
    return m[t] || '条目';
  }

  /* ---------------- 规则调试器 ----------------
     选中一张卡片，把每条规则对它的判定过程逐步列出来。
     用的是 matchRuleDetail + decideCard —— 与页面真正跑的完全是同一份逻辑。 */
  function showDebugPanel(card) {
    hideCardMenu();
    try { document.querySelector('.cf-dbgpanel') && document.querySelector('.cf-dbgpanel').remove(); } catch (e) { }

    var ctx = extractCache.get(card) || extract(card);
    var groupOn = {};
    (S.groups || []).forEach(function (g) { groupOn[g.id] = g.enabled !== false; });
    var bk = buildBuckets(groupOn, S.settings);
    var dec = decideCard(ctx, bk);
    var winner = dec.blockRule || dec.favRule || dec.hlRule || null;

    var rows = '';
    S.rules.forEach(function (r, i) {
      var steps = [];
      var hit = matchRuleDetail(r, ctx, steps);
      var cls = hit ? 'hit' : 'no';
      var tag = '';
      if (!r.enabled) tag = '<span class="cf-dbg-tag">已关闭</span>';
      else if (ruleExpired(r)) tag = '<span class="cf-dbg-tag warn">已过期</span>';
      else if (r.groupId && !groupOn[r.groupId]) tag = '<span class="cf-dbg-tag">分组关闭</span>';
      else if (hit && winner && r.id === winner.id) tag = '<span class="cf-dbg-tag ok">★ 生效</span>';
      else if (hit) tag = '<span class="cf-dbg-tag dim">命中但被压过</span>';
      var detail = steps.map(function (st2) {
        return '<span class="cf-dbg-step ' + (st2.ok ? 'ok' : 'no') + '">' + escapeHtml(st2.t) +
          '：' + (st2.ok ? '通过' : '不通过') + (st2.note ? '（' + escapeHtml(String(st2.note)) + '）' : '') + '</span>';
      }).join('');
      rows += '<div class="cf-dbg-row ' + cls + '">' +
        '<div class="cf-dbg-hd"><b>' + (i + 1) + '</b> ' + escapeHtml(TYPE_LABEL_OF(r.type)) +
        ' · ' + escapeHtml(String(r.value || '')) + ' → ' + escapeHtml(ACTION_LABEL_OF(r.action)) + ' ' + tag + '</div>' +
        '<div class="cf-dbg-steps">' + (detail || '<span class="cf-dbg-step">未参与判定</span>') + '</div>' +
        (r.expiresAt ? '<div class="cf-dbg-exp">有效期至 ' + escapeHtml(fmtTime(r.expiresAt)) + '</div>' : '') +
        '</div>';
    });

    var el = document.createElement('div');
    el.className = 'cf-dbgpanel';
    el.innerHTML =
      '<div class="cf-dbg-hdbar"><b>规则调试器</b>' +
      '<span class="cf-dbg-code">' + escapeHtml(ctx.code || '（无番号）') + '</span>' +
      '<button class="cf-dbg-x" type="button">关闭</button></div>' +
      '<div class="cf-dbg-ctx">' +
      '<div><b>标题</b> ' + escapeHtml((ctx.rawTitle || '').slice(0, 80)) + '</div>' +
      '<div><b>女优</b> ' + escapeHtml((ctx.actressList || []).join(' / ') || '—') + '</div>' +
      '<div><b>标签</b> ' + escapeHtml((ctx.tagList || []).join(' / ') || '—') + '</div>' +
      '<div><b>片商</b> ' + escapeHtml((ctx.makerList || []).join(' / ') || '—') +
      '　<b>系列</b> ' + escapeHtml((ctx.seriesList || []).join(' / ') || '—') + '</div>' +
      '<div><b>评分</b> ' + escapeHtml(ctx.rating == null ? '—' : String(ctx.rating)) +
      '　<b>日期</b> ' + escapeHtml(ctx.date || '—') + '</div>' +
      '</div>' +
      '<div class="cf-dbg-result">结论：<b class="' + (winner ? 'ok' : 'no') + '">' +
      (winner ? (ACTION_LABEL_OF(winner.action) + '（来自规则「' + escapeHtml(String(winner.value)) + '」）') : '无任何规则命中') +
      '</b>' + (dec.firstHit && winner && dec.firstHit.id !== winner.id
        ? '<span class="cf-dbg-note">首条命中是「' + escapeHtml(String(dec.firstHit.value)) + '」，但最终动作由它决定</span>' : '') +
      '</div>' +
      '<div class="cf-dbg-list">' + (rows || '<div class="cf-dbg-empty">还没有任何规则。</div>') + '</div>';

    el.querySelector('.cf-dbg-x').addEventListener('click', function () { el.remove(); });
    el.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    document.documentElement.appendChild(el);
  }

  function fmtTime(ts) {
    var d = new Date(Number(ts) || 0);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function ACTION_LABEL_OF(a) {
    return a === 'block' ? '屏蔽' : (a === 'favorite' ? '收藏' : (a === 'highlight' ? '高亮' : String(a || '—')));
  }

  /* ---------------- 已看自动记录 ----------------
     打开详情页就把番号记成已看，不用手动点「我看过了」。
     只对监管站点生效，避免在其他站点上误匹配 URL。 */
  function detailCodeFromUrl() {
    var m = String(location.pathname || '').match(/\/([a-z]{2,10})-?(\d{2,6})(?:[._\/]|$)/i);
    if (!m) return '';
    var c = (m[1] + '-' + m[2]).toUpperCase();
    return /^[A-Z0-9]{2,10}-[0-9]{2,6}$/.test(c) ? c : '';
  }

  // 详情页的内容 ID：番号站还是番号，非番号站回落到站点自己的 ID（ph:xxx / yp:123 / dz:123）
  function detailContentId() {
    return detailCodeFromUrl() || contentIdFromHref(location.href, templateForHost(location.hostname));
  }

  function maybeAutoSeen() {
    try {
      if (!S.settings.autoSeen) return;
      if (!currentSite) return;
      var c = detailContentId();
      if (!c || S.seen[c]) return;
      S.seen[c] = Date.now();
      saveState({ seen: S.seen });
      log('已看自动记录：' + c);
    } catch (e) { logErr('autoSeen', e); }
  }

  function isDailyRec(name, type) {
    var ty = type || 'actress';
    var today = todayStr();
    var recs = (S.dailyRecs && S.dailyRecs[today]) || [];
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].name === name && (recs[i].type || 'actress') === ty) return true;
    }
    return false;
  }

  function quickAdd(action) {
    if (!ui) return;
    var v = (ui.qin.value || '').trim();
    if (!v) return;
    var type = ui.qtype.value;
    if (!confirmImpact(v, type, action)) return;
    snapshot('快速添加规则');
    addRule({ value: v, type: type, action: action, color: S.settings.hlColor });
    ui.qin.value = '';
    setTimeout(renderList, 60);
  }

  // 推荐卡片墙：点击卡片循环切换 无→屏蔽→收藏→高亮
  function cycleAction(name, type) {
    var order = ['', 'block', 'favorite', 'highlight'];
    var cur = findRule(name, type);
    var idx = cur ? order.indexOf(cur.action) : 0;
    var next = order[(idx + 1) % 4];
    snapshot('切换规则状态');
    if (next === '') {
      if (cur) S.rules = S.rules.filter(function (r) { return r.id !== cur.id; });
    } else {
      addRule({ value: name, type: type, action: next, color: S.settings.hlColor });
    }
    saveRules();
    schedulePass();
    setTimeout(function () { if (ui && activeTab === 'recommend') renderRecommend(); }, 40);
  }

  // 推荐卡片墙：批量选择模式下的操作
  function handleBatch(act) {
    if (act === 'selmode') { recommendBatch = !recommendBatch; if (!recommendBatch) recommendSel.clear(); renderRecommend(); return; }
    if (act === 'batchClear') { recommendSel.clear(); renderRecommend(); return; }
    if (!recommendBatch || !recommendSel.size) return;
    var action = act === 'batchBlock' ? 'block' : (act === 'batchFav' ? 'favorite' : 'highlight');
    snapshot('批量操作');
    recommendSel.forEach(function (key) {
      var p = key.split('||');
      addRule({ value: p[1], type: p[0], action: action, color: S.settings.hlColor });
    });
    recommendSel.clear();
    recommendBatch = false;
    saveRules();
    schedulePass();
    setTimeout(renderRecommend, 60);
  }

  /* 「显示被隐藏」：给 <html> 挂/摘 .cf-reveal。
     屏蔽默认让卡片彻底看不见（hide/placeholder 两档），用户时间久了会怀疑
     「是不是误杀了、我是不是漏看了」。揭示态把被屏蔽的卡片以半透明虚线红框
     重新显示，形状位置照旧；纯视图态，不动规则、不落存储、不改 stats 计数。
     新的一轮 pass 会重建卡片，但 .cf-reveal 挂在 <html> 上，所以揭示态会保持。 */
  function toggleRevealHidden() {
    revealHidden = !revealHidden;
    try { document.documentElement.classList.toggle('cf-reveal', revealHidden); } catch (e) { }
    // 就地更新按钮文案（避免整页重渲染）
    try {
      var btn = ui && ui.sr && ui.sr.querySelector('[data-act="revealHidden"]');
      if (btn) btn.textContent = revealHidden ? '🙈 恢复隐藏（' + stats.blocked + '）' : '👁 显示被隐藏（' + stats.blocked + '）';
    } catch (e) { }
    flashBall(revealHidden ? '揭示' : '恢复');
  }

  function handleAct(act) {
    if (act === 'close') { togglePanel(false); return; }
    if (act === 'opt') { try { chrome.runtime.sendMessage({ type: 'sf_open_options' }); } catch (e) { } return; }
    if (act === 'lock') { toggleBallLock(); return; }
    if (act === 'revealHidden') { toggleRevealHidden(); return; }
    if (act === 'onboardClose') { S.settings.onboarded = true; saveSettings(); renderOnboard(); return; }
    if (act === 'flClear') {
      if (ui.flRating) ui.flRating.value = '';
      if (ui.flDate) ui.flDate.value = '';
      applyFilter();
      return;
    }
    if (act === 'copyAllMagnet') {
      var mg = dlLinks.filter(function (d) { return d.type === 'magnet'; }).map(function (d) { return d.raw; });
      copyText(mg.length ? mg.join('\n') : '（本页没有磁力链接）');
      return;
    }
    if (act === 'copyAll') {
      copyText(dlLinks.length ? dlLinks.map(function (d) { return d.raw; }).join('\n') : '（本页没有探测到链接）');
      return;
    }
    if (act === 'openAllMagnet') {
      dlLinks.forEach(function (d) { if (d.type === 'magnet') openInClient(d.raw); });
      return;
    }
    if (act === 'exportFavCodes') {
      var keys = Object.keys(S.favCodes || {});
      copyText(keys.length ? keys.join('\n') : '（收藏夹为空）');
      return;
    }
    if (act === 'clearFavCodes') {
      if (!confirm('清空番号收藏夹？')) return;
      S.favCodes = {};
      saveState({ favCodes: S.favCodes });
      schedulePass();
      renderList();
      return;
    }
    if (act === 'blockAll') {
      var n = 0;
      snapshot('本页女优全屏蔽');
      foundActress.forEach(function (c, name) { addRule({ value: name, type: 'actress', action: 'block' }); n++; });
      renderList();
      return;
    }
    if (act === 'clearAll') {
      if (!confirm('确定清空全部规则？建议先到「完整设置」导出备份。')) return;
      snapshot('清空全部规则');
      S.rules = [];
      saveRules();
      schedulePass();
      renderList();
      return;
    }
    if (act === 'importColl') {
      var r = importCollection();
      if (ui && ui.list) {
        ui.list.innerHTML = '<div class="cf-empty" style="text-align:left;line-height:1.9">' +
          '✅ 已从本页导入到插件收藏：<br>' +
          '女优/演员 <b style="color:#ffd970">' + r.added.actress + '</b> · ' +
          '片商 <b style="color:#ffd970">' + r.added.maker + '</b> · ' +
          '系列 <b style="color:#ffd970">' + r.added.series + '</b> · ' +
          '导演 <b style="color:#ffd970">' + r.added.director + '</b> · ' +
          '番号 <b style="color:#ffd970">' + r.added.code + '</b><br>' +
          '已存在跳过 <b>' + r.skipped + '</b>' +
          (r.total === 0 ? '<br><br>⚠️ 未识别到内容。请确认当前是 <b>javbus / javdb580</b> 的个人收藏页，且页面已完全滚动加载完毕，再重新点击。' : '') +
          '</div>';
      }
      if (ui && ui.ball) { ui.ball.textContent = '✓'; setTimeout(function () { ui.ball.textContent = '◈'; }, 900); }
      return;
    }
    if (act === 'genDaily') {
      ui.list.innerHTML = '<div class="cf-empty">正在生成今日推荐…</div>';
      try { chrome.runtime.sendMessage({ type: 'sf_build_daily', force: true }); }
      catch (e) { renderDaily(); }
      return;
    }
    if (act === 'enrichDaily') { enrichDaily(); return; }
    if (act === 'dailyAllFav') {
      var today = todayStr();
      var recs = (S.dailyRecs && S.dailyRecs[today]) || [];
      if (!recs.length) return;
      snapshot('每日推荐全部收藏');
      recs.forEach(function (r) { addRule({ value: r.name, type: 'actress', action: 'favorite' }); });
      saveRules();
      renderDaily();
      return;
    }
    if (act === 'undo') {
      if (!undoLast()) { if (ui) { ui.list.innerHTML = '<div class="cf-empty">没有可撤销的操作了。</div>'; } }
      return;
    }
    if (act === 'genSimilar') {
      ui.list.innerHTML = '<div class="cf-empty">正在计算相似推荐…</div>';
      try { chrome.runtime.sendMessage({ type: 'sf_build_similar' }); }
      catch (e) { renderSimilar(); }
      return;
    }
    if (act === 'similarAllFav') {
      var st = todayStr();
      var srecs = (S.similarRecs && S.similarRecs[st]) || [];
      if (!srecs.length) return;
      snapshot('相似推荐全部收藏');
      srecs.forEach(function (r) { addRule({ value: r.name, type: 'actress', action: 'favorite' }); });
      saveRules();
      schedulePass();
      renderSimilar();
      return;
    }
    if (act === 'copyWatch') {
      var wk = Object.keys(S.watchlist || {});
      copyText(wk.length ? wk.join('\n') : '（待看队列为空）');
      return;
    }
    if (act === 'exportWatchMd') {
      var wks = Object.keys(S.watchlist || {});
      if (!wks.length) return;
      downloadText('sitefilter-watchlist-' + new Date().toISOString().slice(0, 10) + '.md',
        watchMd(), 'text/markdown;charset=utf-8');
      return;
    }
    if (act === 'clearWatch') {
      if (!confirm('清空待看队列？（不影响番号收藏与规则）')) return;
      S.watchlist = {};
      saveState({ watchlist: S.watchlist });
      renderWatch();
      return;
    }
  }

  function updateHostVisibility() {
    if (!ui) return;
    var probeOk = probeMode && S.settings.probeLinks !== false && S.settings.probeAnySite !== false;
    var show = S.settings.showBall !== false && (!!currentSite || probeOk);
    ui.host.style.display = (show && !S.settings.boss) ? '' : 'none';
    ui.panel.classList.toggle('probe', !!probeMode);
    ui.ball.title = probeMode ? 'SiteFilter · 下载链接探测（本页未纳入监管）' : 'SiteFilter（Alt+F 开合，可拖动）';
    if (ui.importBtn) ui.importBtn.style.display = (currentSite && S.settings.boss !== true) ? '' : 'none';
  }

  /* ---------------- 下载链接探测 ---------------- */
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

  function metaAround(el) {
    var scope = el;
    for (var i = 0; i < 3 && scope; i++) {
      var t = txt(scope);
      if (t && t.length > 4) {
        var sz = t.match(SIZE_RE), q = t.match(QUALITY_RE);
        if (sz || q) return { size: sz ? sz[1] : '', quality: q ? q[1] : '' };
      }
      scope = scope.parentElement;
    }
    return { size: '', quality: '' };
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

  /* pushLink：把探测到的一条候选放进结果集
   * 去重键不再用整串 raw —— 同一部片换 tracker / 换 dn 顺序就是另一个串，
   * 旧写法会把它当两条（列表里出现两行一模一样的片）。按 infohash 归并才是对的。
   * 归并交给后面的 mergeMagnets()（它需要拿到双方才能择优），这里只做「同键合并」。 */
  function pushLink(arr, seen, raw, type, el) {
    raw = String(raw).trim();
    if (!raw) return;
    var d;
    if (type === 'magnet') {
      var m = parseMagnet(raw);
      if (!m) return;                       // 残缺 magnet（无 xt）→ 丢弃
      d = {
        raw: raw, type: type, el: el || null, pan: null, magnet: m,
        name: m.dn || '', size: m.size, quality: m.quality
      };
      // 归并键：algo + hash（大小写无关）；同键的 tr 后面合并、dn 取更长/更完整的
      var key = 'm:' + m.algo + ':' + m.hash.toLowerCase();
      var prev = seen[key];
      if (prev) { mergeMagnet(prev, d); return; }
      seen[key] = d;
    } else {
      var k2 = type + ':' + raw;
      if (seen[k2]) return;
      var meta = el ? metaAround(el) : { size: '', quality: '' };
      d = { raw: raw, type: type, size: meta.size, quality: meta.quality, pan: panOf(raw), el: el || null, name: '' };
      seen[k2] = d;
    }
    d.label = shortLabel(d);
    arr.push(d);
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

  /* 探测源的统一入口（L3）。先过 decodeObfuscated() 解一层混淆，
   * 再按「解码后的真实前缀」重定型别，最后交给 pushLink。
   * hintType 只在「解码失败」时兜底（保留旧行为：原始就是 magnet 但解析不出 hash 仍丢弃）。
   * 解码成功但前缀不认识 → 不强行当磁力推，避免误报。 */
  function dispatchLink(arr, seen, raw, hintType, el) {
    var dec = decodeObfuscated(raw);
    var s = dec || String(raw).trim();
    var type = hintType;
    if (dec) {
      if (/^magnet:/i.test(s)) type = 'magnet';
      else if (/^thunder:/i.test(s)) type = 'thunder';
      else if (/^ed2k:/i.test(s)) type = 'ed2k';
      else if (/\.torrent(\?|$)/i.test(s)) type = 'torrent';
      else if (/^https?:/i.test(s) && panOf(s)) type = 'pan';
    }
    pushLink(arr, seen, s, type, el);
  }

  function probeLinks() {
    var arr = [], seen = {};
    var st = S.settings;
    if (st.probeLinks === false) { dlLinks = arr; stats.dl = 0; return; }
    // 克隆卡片不参与链接探测：它们是「同一页之外」的内容，
    // 探测结果会混进「下载」页签，也会让 stats.dl 虚高。
    var scope = document.querySelectorAll('.cf-cloned');
    var inClone = function (el) {
      for (var k = 0; k < scope.length; k++) { if (scope[k].contains(el)) return true; }
      return false;
    };

    // 1) <a href>
    var as = document.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      if (inClone(a)) continue;
      var h = a.getAttribute('href') || '';
      if (/^magnet:/i.test(h)) dispatchLink(arr, seen, h, 'magnet', a);
      else if (/^ed2k:/i.test(h)) dispatchLink(arr, seen, h, 'ed2k', a);
      else if (/^thunder:/i.test(h)) dispatchLink(arr, seen, h, 'thunder', a);
      else if (/\.torrent(\?|$)/i.test(h)) dispatchLink(arr, seen, h, 'torrent', a);
      else if (/^https?:/i.test(h) && panOf(h)) dispatchLink(arr, seen, h, 'pan', a);
    }

    // 2) data-* 属性（很多站把磁力藏在这里；base64 / 裸 hash 也在此解出）
    var attrs = ['data-clipboard-text', 'data-url', 'data-link', 'data-magnet', 'data-copy',
                 'data-hash', 'data-infohash', 'data-btih'];
    for (var q = 0; q < attrs.length; q++) {
      var els = document.querySelectorAll('[' + attrs[q] + ']');
      for (var j = 0; j < els.length; j++) {
        if (inClone(els[j])) continue;
        var v = els[j].getAttribute(attrs[q]) || '';
        if (/^magnet:/i.test(v)) dispatchLink(arr, seen, v, 'magnet', els[j]);
        else if (/^ed2k:/i.test(v)) dispatchLink(arr, seen, v, 'ed2k', els[j]);
        else if (/^thunder:/i.test(v)) dispatchLink(arr, seen, v, 'thunder', els[j]);
        else if (/\.torrent(\?|$)/i.test(v)) dispatchLink(arr, seen, v, 'torrent', els[j]);
        else if (/^https?:/i.test(v) && panOf(v)) dispatchLink(arr, seen, v, 'pan', els[j]);
        else dispatchLink(arr, seen, v, 'magnet', els[j]);  // 兜底：让 decodeObfuscated 试解（base64 / 裸 hash / 实体）
      }
    }

    // 3) 正文里的裸 magnet: / ed2k: / thunder: 文本
    var bodyText = '';
    if (document.body) bodyText = document.body.innerText || document.body.textContent || '';
    var m;
    MAGNET_RE.lastIndex = 0;
    while ((m = MAGNET_RE.exec(bodyText)) !== null) dispatchLink(arr, seen, m[0], 'magnet', null);
    ED2K_RE.lastIndex = 0;
    while ((m = ED2K_RE.exec(bodyText)) !== null) dispatchLink(arr, seen, m[0], 'ed2k', null);
    THUNDER_RE.lastIndex = 0;
    while ((m = THUNDER_RE.exec(bodyText)) !== null) dispatchLink(arr, seen, m[0], 'thunder', null);

    // 未被 <a> 覆盖到的 .torrent 文本
    TORRENT_RE.lastIndex = 0;
    while ((m = TORRENT_RE.exec(bodyText)) !== null) dispatchLink(arr, seen, m[0], 'torrent', null);

    // L3：正文里「百分号编码」的磁力（magnet%3A%3Fxt%3D...）
    MAGNET_PCT_RE.lastIndex = 0;
    while ((m = MAGNET_PCT_RE.exec(bodyText)) !== null) dispatchLink(arr, seen, m[0], 'magnet', null);
    // L3：正文里 base64 包一层的磁力 token（decodeObfuscated 只会在解出真链接时才推，不误报）
    B64_TOKEN_RE.lastIndex = 0;
    while ((m = B64_TOKEN_RE.exec(bodyText)) !== null) dispatchLink(arr, seen, m[0], 'magnet', null);

    // L4 排序：按「信息完整度」分层，磁力优先（详见 sortLinks）
    sortLinks(arr);

    dlLinks = arr;
    stats.dl = arr.length;

    // 页面内标记
    if (st.probeMark !== false && !st.boss) {
      for (var k = 0; k < arr.length; k++) {
        var el = arr[k].el;
        if (el && !el.classList.contains('cf-dl')) el.classList.add('cf-dl');
      }
    }
  }

  function copyText(t) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      } catch (e) { }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).catch(fallback);
    } else fallback();
    if (ui) {
      var b = ui.ball;
      b.textContent = '✓';
      setTimeout(function () { b.textContent = '◈'; }, 900);
    }
  }

  // 触发本地文件下载；环境不支持（如测试沙箱）时退化为复制到剪贴板
  function downloadText(name, text, mime) {
    try {
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) throw new Error('no blob');
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) { } }, 3000);
      return true;
    } catch (e) {
      copyText(text);
      return false;
    }
  }

  /* ---------------- 番号收藏 ---------------- */
  function toggleFavCode(code, meta) {
    if (!code) return;
    if (S.favCodes[code]) delete S.favCodes[code];
    else S.favCodes[code] = { t: (meta && meta.title) || '', u: (meta && meta.url) || '', s: location.hostname, at: Date.now() };
    saveState({ favCodes: S.favCodes });
    schedulePass();
    if (activeTab === 'favcode') setTimeout(renderList, 80);
  }

  function ensureFavBtn(card, code, title, url) {
    if (!S.settings.favBtn || S.settings.boss || !code) return;
    var btn = card.querySelector(':scope > .cf-favbtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'cf-favbtn';
      btn.type = 'button';
      btn.textContent = '♥';
      btn.title = '收藏 / 取消收藏该番号';
      card.appendChild(btn);
    }
    var on = !!S.favCodes[code];
    btn.classList.toggle('on', on);
    btn.textContent = on ? '♥' : '♡';
    btn.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      toggleFavCode(code, { title: title, url: url });
    };
  }

  // 软屏蔽卡片的「仍然查看」按钮：临时放行该番号
  function ensurePeekBtn(card, code) {
    if (!code) return;
    var btn = card.querySelector(':scope > .cf-peekbtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'cf-peekbtn';
      btn.type = 'button';
      btn.textContent = '仍然查看';
      btn.title = '临时放行（' + (Math.max(1, Number(S.settings.peekHours) || 24)) + ' 小时内不再屏蔽该番号）';
      card.appendChild(btn);
    }
    btn.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      peekCode(code, card);
    };
  }

  // 记录「仍然查看」并立刻恢复该卡片
  function peekCode(code, card) {
    if (!code) return;
    S.peeks = S.peeks || {};
    var now = Date.now();
    // 清掉过期的，避免无限增长
    Object.keys(S.peeks).forEach(function (k) { if (now - S.peeks[k] > peekTtl()) delete S.peeks[k]; });
    S.peeks[code] = now;
    saveState({ peeks: S.peeks });
    if (card) {
      card.classList.remove('cf-soft');
      var b = card.querySelector(':scope > .cf-peekbtn');
      if (b) b.remove();
    }
    flashBall('👁', 900);
    schedulePass();   // 放行后按正常卡片重新走一遍规则（收藏/高亮/已看等）
  }

  // 卡片 hover 的 ⏳ 待看按钮
  function ensureWatchBtn(card, code, title, url) {
    if (!S.settings.watchBtn || S.settings.boss || !code) return;
    var btn = card.querySelector(':scope > .cf-watchbtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'cf-watchbtn';
      btn.type = 'button';
      btn.textContent = '⏳';
      btn.title = '加入 / 移出待看队列';
      card.appendChild(btn);
    }
    var on = !!(S.watchlist && S.watchlist[code]);
    btn.classList.toggle('on', on);
    btn.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      toggleWatch(code, { title: title, url: url });
    };
  }

  /* ---------------- 从站点个人收藏页导入到插件收藏 ----------------
     扫描当前页面里所有女优 / 演员 / 系列 / 片商 / 导演 链接，以及番号，
     返回按类型分类、去重后的结果（含头像）。不依赖卡片识别，直接扫全页链接。 */
  function collectPageFavorites() {
    var buckets = { actress: new Map(), maker: new Map(), series: new Map(), director: new Map(), code: new Map() };
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href') || '';
      var name = txt(a);
      var kind = classify(a);
      if (kind === 'actress' || kind === 'maker' || kind === 'series' || kind === 'director') {
        if (name && name.length <= 40) {
          var key = name.toLowerCase();
          if (!buckets[kind].has(key)) {
            var img = a.querySelector('img');
            var avatar = img ? (img.getAttribute('src') || '') : '';
            if (!avatar) {
              var box = a.closest('li,.box,.item,.card,.movie,.columns,.video,.grid-item');
              if (box) { var bi = box.querySelector('img'); if (bi) avatar = bi.getAttribute('src') || ''; }
            }
            buckets[kind].set(key, { name: name, href: absoluteUrl(href), avatar: avatar });
          }
        }
      }
      var c = codeFromHref(href) || codeFromHref(name) || '';
      if (!c) { var ai = a.querySelector('img'); if (ai) c = codeFromHref(ai.getAttribute('alt') || '') || ''; }
      if (c) { var ck = c.toUpperCase(); if (!buckets.code.has(ck)) buckets.code.set(ck, { code: ck, href: absoluteUrl(href) }); }
    }
    // 缩略图 alt 兜底（javbus 缩略图 alt 即番号）
    var imgs = document.querySelectorAll('img[alt]');
    for (var j = 0; j < imgs.length; j++) {
      var c2 = codeFromHref(imgs[j].getAttribute('alt') || '');
      if (c2) { var k2 = c2.toUpperCase(); if (!buckets.code.has(k2)) buckets.code.set(k2, { code: k2, href: absoluteUrl(imgs[j].getAttribute('src') || '') }); }
    }
    var res = {};
    ['actress', 'maker', 'series', 'director', 'code'].forEach(function (t) { res[t] = Array.from(buckets[t].values()); });
    return res;
  }

  // 把扫描结果去重导入：女优/演员/系列/片商/导演 → favorite 规则；番号 → 番号收藏夹
  function importCollection() {
    var data = collectPageFavorites();
    var added = { actress: 0, maker: 0, series: 0, director: 0, code: 0 };
    var skipped = 0;
    snapshot('导入站点收藏');
    ['actress', 'maker', 'series', 'director'].forEach(function (type) {
      data[type].forEach(function (it) {
        var cur = findRule(it.name, type);
        if (cur && cur.action === 'favorite' && cur.enabled) { skipped++; return; }
        addRule({ value: it.name, type: type, action: 'favorite', scope: SCOPE_OF[type] });
        added[type]++;
      });
    });
    data.code.forEach(function (it) {
      if (S.favCodes[it.code]) { skipped++; return; }
      toggleFavCode(it.code, { url: it.href });
      added.code++;
    });
    saveRules();
    return {
      added: added,
      skipped: skipped,
      total: added.actress + added.maker + added.series + added.director + added.code
    };
  }

  /* ---------------- 发现库：浏览过的页面里出现过谁 / 什么标签 ---------------- */
  var discDelta = new Map();  // key -> {v, type, n}

  function noteDiscovered(type, name, extra) {
    if (!name) return;
    var key = type + '|' + name;
    var cur = discDelta.get(key);
    if (cur) { cur.n++; if (extra) Object.assign(cur, extra); }
    else {
      var e = { v: name, type: type, n: 1, grp: sourceGroup() };
      if (extra) Object.assign(e, extra);
      discDelta.set(key, e);
    }
  }

  // 点击「已看」时，把卡片上的女优也记入 discovered.seen，供每日推荐排除「已看过番号」的人
  function bumpActressSeen(raw) {
    if (!raw) return;
    var names = String(raw).split(' || ');
    var now = Date.now();
    names.forEach(function (nm) {
      if (!nm) return;
      var key = 'actress|' + nm;
      var e = S.discovered[key];
      if (!e) {
        e = S.discovered[key] = { v: nm, type: 'actress', n: 0, first: now, last: now, site: sourceGroup(), seen: 0 };
      }
      e.seen = (e.seen || 0) + 1;
      e.last = now;
    });
    flushDisc();
  }

  // 把相对/协议相对 URL 转成绝对 URL
  function absoluteUrl(href) {
    if (!href) return '';
    try {
      if (/^https?:/i.test(href)) return href;
      if (href.indexOf('//') === 0) return location.protocol + href;
      if (href.charAt(0) === '/') return location.origin + href;
      return new URL(href, location.href).href;
    } catch (e) { return href; }
  }

  var flushDisc = debounce(function () {
    if (!discDelta.size) return;
    var delta = discDelta; discDelta = new Map();
    cfGet(function (o) {
      var d = o || {};
      var disc = d.discovered || {};
      var now = Date.now();
      delta.forEach(function (x, key) {
        var grp = x.grp || sourceGroup();
        var e = disc[key];
        if (e) {
          e.n += x.n; e.last = now;
          // 按「来源组」拆账：三个 JavDB 镜像都记到 javdb 这一格里，site 也用组名，
          // 否则同一个人在镜像站逛一圈会被当成三个来源、出现次数三倍膨胀
          e.site = grp;
          e.sites = e.sites || {};
          e.sites[grp] = (e.sites[grp] || 0) + x.n;
          if (x.href) e.href = x.href;
          if (x.avatar) e.avatar = x.avatar;
          if (x.rating) e.rating = x.rating;
          if (x.works) e.works = x.works;
        } else {
          var sg = {}; sg[grp] = x.n;
          disc[key] = {
            v: x.v, type: x.type, n: x.n, first: now, last: now, site: grp, sites: sg,
            href: x.href || '', avatar: x.avatar || '', rating: x.rating || 0, works: x.works || 0
          };
        }
      });
      // 上限保护：超过 6000 条按最近出现时间淘汰
      var keys = Object.keys(disc);
      if (keys.length > 6000) {
        keys.sort(function (a, b) { return (disc[b].last || 0) - (disc[a].last || 0); });
        keys.slice(6000).forEach(function (k) { delete disc[k]; });
      }
      d.discovered = disc;
      S.discovered = disc;   // 同步内存，使推荐页/徽标即时反映本次会话的新发现
      var p = {}; p[DATA_KEY] = d;
      cfSet(p, function () { });
    });
  }, 5000);

  // 今日日期串（本地时区），用于「每日新人」判断
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // 被动采集女优头像与 star 链接（女优列表页 / 详情页带头像，无额外网络请求）
  function captureActressProfiles() {
    if (probeMode) return;   // 只在监管站点内采集
    var boxes = document.querySelectorAll('a[href*="/star/"], .avatar-box a, [class*="avatar"] a');
    for (var i = 0; i < boxes.length; i++) {
      var a = boxes[i];
      var href = a.getAttribute('href') || '';
      if (!/\/star\//i.test(href)) continue;
      var img = a.querySelector('img');
      var name = txt(a).trim();
      if (!name || name.length > 30) name = (img && (img.getAttribute('alt') || '')) || '';
      name = name.trim();
      if (!name || name.length > 30) continue;
      var avatar = '';
      if (img) avatar = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
      if (avatar && avatar.indexOf('//') === 0) avatar = location.protocol + avatar;
      else if (avatar && avatar.charAt(0) === '/') avatar = location.origin + avatar;
      noteDiscovered('actress', name, { href: absoluteUrl(href), avatar: avatar });
    }
  }

  // 推荐：见过但还没建规则；新的优先，其次高频
  function recommendList(limit) {
    var disc = S.discovered || {};
    var now = Date.now();
    var today = todayStr();
    var out = [];
    Object.keys(disc).forEach(function (k) {
      var d = disc[k];
      if (!d || !d.v) return;
      if (findRule(d.v, d.type)) return;      // 已建规则就不再推荐
      d.isNew = (now - (d.first || 0)) < 7 * 864e5;
      var fd = d.first ? new Date(d.first) : null;
      d.isToday = fd && (fd.getFullYear() + '-' + (fd.getMonth() + 1) + '-' + fd.getDate()) === today;
      out.push(d);
    });
    out.sort(function (a, b) {
      return ((b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)) || (b.n - a.n);
    });
    return limit ? out.slice(0, limit) : out;
  }

  /* ---------------- 已看记录：点击卡片链接时写入番号 ---------------- */
  function codeFromHref(href) {
    if (!href) return '';
    var m = String(href).match(/([A-Za-z]{2,8}-?\d{2,6})/);
    return m ? m[1].toUpperCase() : '';
  }

  function watchSeen() {
    document.addEventListener('click', function (e) {
      if (!S.settings.markSeen || !currentSite || S.settings.boss) return;
      var t = e.target;
      if (!t || !t.closest) return;
      var a = t.closest('a[href]');
      if (!a) return;
      var code = codeFromHref(a.getAttribute('href'));
      if (!code || S.seen[code]) return;
      S.seen[code] = Date.now();
      saveState({ seen: S.seen });
      var card = a.closest('.cf-fav, .cf-hl, .item, .movie-box, .video-item, .card');
      if (card) {
        card.classList.add('cf-seen');
        bumpActressSeen(card.dataset.cfA);
      }
    }, true);
  }

  /* ---------------- 悬停浮层：这张卡为什么被这样处理 ---------------- */
  function ensureWhyEl() {
    if (whyEl) return whyEl;
    whyEl = document.createElement('div');
    whyEl.className = 'cf-why';
    whyEl.style.display = 'none';
    (document.body || document.documentElement).appendChild(whyEl);
    return whyEl;
  }
  var WHY_LABEL = { block: '屏蔽', favorite: '★收藏', highlight: '高亮', filter: '筛选', favcode: '★番号', watch: '⏳待看', peek: '👁临时放行' };
  var WHY_COLOR = { block: '#ff4d6d', favorite: '#ffc93c', highlight: '#00e5ff', filter: '#9aa3b8', favcode: '#ffc93c', watch: '#ff9f1c', peek: '#7ee2a8' };

  function showWhy(card) {
    var rs = whyMap.get(card);
    if (!rs || !rs.length) return;
    var el = ensureWhyEl();
    el.innerHTML = '<div class="cf-whytitle">这张卡为什么被处理</div>' + rs.slice(0, 7).map(function (r) {
      var scope = (TAB_LABEL[r.t] || r.t || '');
      scope = scope ? (scope + (r.s && r.s !== 'all' ? '（' + r.s + '区）' : '')) : (r.s || '');
      return '<div class="cf-whyrow"><span class="cf-whya" style="color:' + (WHY_COLOR[r.a] || '#fff') + '">' +
        (WHY_LABEL[r.a] || r.a) + '</span><span class="cf-whyt">' + escapeHtml(scope) + '</span>' +
        '<span class="cf-whyv">' + escapeHtml(String(r.v == null ? '' : r.v).slice(0, 28)) + '</span></div>';
    }).join('');
    el.style.display = '';
    var rect = card.getBoundingClientRect();
    var x = Math.min(window.innerWidth - 236, Math.max(6, rect.left));
    var y = rect.bottom + 6;
    el.style.left = x + 'px';
    el.style.top = '0px';
    if (y + el.offsetHeight > window.innerHeight - 8) y = Math.max(6, rect.top - el.offsetHeight - 6);
    el.style.top = y + 'px';
  }

  function watchHover() {
    document.addEventListener('mouseover', function (e) {
      if (!S.settings.showWhy || S.settings.boss || pickMode) return;
      var t = e.target;
      if (!t || !t.closest) return;
      var card = t.closest('.cf-card');
      if (!card) return;
      showWhy(card);
    }, true);
    document.addEventListener('mouseout', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (!t.closest('.cf-card')) return;
      var to = e.relatedTarget;
      if (to && to.closest && to.closest('.cf-why')) return;
      if (whyEl) whyEl.style.display = 'none';
    }, true);
    window.addEventListener('scroll', function () { if (whyEl) whyEl.style.display = 'none'; }, true);
  }

  /* ---------------- 点选卡片：记住选择器（引导式自愈） ---------------- */
  function bestSelector(el) {
    var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)
      .filter(function (c) { return c && c.indexOf('cf-') !== 0 && !/^\d/.test(c); });
    var tag = el.tagName ? el.tagName.toLowerCase() : 'div';
    if (cls.length) return tag + '.' + cls[0];
    return tag;
  }

  function watchPick() {
    document.addEventListener('click', function (e) {
      if (!pickMode) return;
      e.preventDefault(); e.stopPropagation();
      var el = e.target;
      if (!el || el === document.documentElement || el === document.body) return;
      var box = (el.closest && el.closest('li,.item,.card,.movie-box,.video-item,.grid-item,.box,.columns,tbody tr')) || el;
      var sel = bestSelector(box);
      var n = 0;
      try { n = document.querySelectorAll(sel).length; } catch (err) { n = 0; }
      if (n < 2) { sel = bestSelector(box.parentElement || box); try { n = document.querySelectorAll(sel).length; } catch (err2) { n = 0; } }
      pickMode = false;
      if (!currentSite) { alert('当前站点未纳入监管，无法保存选择器。'); renderPickBanner(); return; }
      if (n < 2) {
        if (!confirm('这个选择器「' + sel + '」在本页只匹配到 ' + n + ' 个元素，可能不准。仍要保存吗？（可稍后在设置里修改）')) { renderPickBanner(); return; }
      }
      currentSite.selector = sel;
      saveState({ sites: S.sites });
      flashBall('🎯');
      renderPickBanner();
      schedulePass();
      setTimeout(function () { if (ui) togglePanel(true); }, 250);
    }, true);
  }

  /* ---------------- 页面变化监听 ---------------- */
  function observe() {
    // ⚠️ 判别式必须同时看 applying 和 backfilling：
    //    补足的克隆是在 setTimeout 回调里插入的，那时 runPass 的 finally 早已把
    //    applying 置回 false。若只看 applying，克隆插入 → 观察器触发 → schedulePass
    //    → runPass 开头 clearClones() 把刚补的克隆全清掉 → 又判定 need>0 →
    //    再次抓取 …… 死循环打站点，且用户永远看不到补足结果（实测现象：
    //    fetch 计数持续上涨、.cf-cloned 恒为 0）。
    var mo = new MutationObserver(function () { if (!applying && !backfilling) schedulePass(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(function () {
      if (location.href !== lastHref) {
        lastHref = location.href;
        invalidateExtract();
        clearMarks();
        schedulePass();
        updateHostVisibility();
      }
    }, 1200);
    window.addEventListener('popstate', function () { setTimeout(schedulePass, 300); });
  }

  /* ---------------- 快捷键（键位可在设置页「快捷键」卡片里自定义） ----------------
   * 全局键：Alt + 单键（面板 / SFW / 老板键 / 锁球）
   * 面板内键：面板打开时生效，单键操作当前选中的卡片
   * Esc 固定不可改（否则用户可能把自己锁在面板里出不来） */
  function keys() {
    window.addEventListener('keydown', function (e) {
      var k = normKey(e.key);

      // ---- 全局键 ----
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        if (k === keyOf('panel')) { e.preventDefault(); togglePanel(); }
        else if (k === keyOf('sfw')) { e.preventDefault(); S.settings.sfw = !S.settings.sfw; saveSettings(); syncToggles(); schedulePass(); }
        else if (k === keyOf('boss')) { e.preventDefault(); S.settings.boss = !S.settings.boss; saveSettings(); syncToggles(); updateHostVisibility(); schedulePass(); }
        else if (k === keyOf('lock')) { e.preventDefault(); toggleBallLock(); }
      }

      // Esc：关闭面板（固定键）
      if (k === 'escape' && ui && ui.panel.classList.contains('open')) togglePanel(false);

      // ---- 卡片键盘导航（面板打开时）----
      if (!(ui && ui.panel.classList.contains('open'))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.shiftKey) return;   // 带 Shift 的组合留给页面自己

      var kNext = keyOf('next'), kPrev = keyOf('prev'), kOpen = keyOf('open');
      var acts = ['block', 'fav', 'hl', 'watch'];
      var hitAct = '';
      for (var ai = 0; ai < acts.length; ai++) {
        if (k === keyOf(acts[ai])) { hitAct = acts[ai]; break; }
      }
      if (k !== kNext && k !== kPrev && k !== kOpen && !hitAct) return;

      var navCards = [].slice.call(document.querySelectorAll('.cf-card'));
      if (!navCards.length) return;

      if (k === kNext || k === kPrev) {
        e.preventDefault();
        if (navIdx >= navCards.length) navIdx = navCards.length - 1;
        var step = (k === kNext) ? 1 : -1;
        // 还没选中任何卡片时：向后走选第一张，向前走选最后一张（不能先夹到 0 再 +1，否则会跳掉第一张）
        navIdx = (navIdx < 0)
          ? (step > 0 ? 0 : navCards.length - 1)
          : Math.max(0, Math.min(navCards.length - 1, navIdx + step));
        navCards.forEach(function (c) { c.classList.remove('cf-navcur'); });
        var cur = navCards[navIdx];
        cur.classList.add('cf-navcur');
        try { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (er) { try { cur.scrollIntoView(); } catch (er2) { } }
        flashBall(keyLabel('prev') + '/' + keyLabel('next') + '  ' + (navIdx + 1) + '/' + navCards.length);
        return;
      }

      if (navIdx >= navCards.length) navIdx = navCards.length - 1;
      if (navIdx < 0) navIdx = 0;
      var tc = navCards[navIdx];
      if (!tc) return;
      var tCode = tc.dataset.cfCode || '';
      var tActs = (tc.dataset.cfA || '').split('||').map(function (x) { return x.trim(); }).filter(Boolean);
      var tTitle = tc.dataset.cfTitle || '';
      var aEl = tc.querySelector('a[href]');
      var tHref = aEl ? aEl.getAttribute('href') : '';

      if (hitAct === 'block' && tActs.length) { e.preventDefault(); tActs.forEach(function (nm) { toggleRule(nm, 'actress', 'block'); }); flashBall('屏蔽 ' + tActs[0]); return; }
      if (hitAct === 'fav' && tActs.length) { e.preventDefault(); tActs.forEach(function (nm) { toggleRule(nm, 'actress', 'favorite'); }); flashBall('★ ' + tActs[0]); return; }
      if (hitAct === 'hl' && tActs.length) { e.preventDefault(); tActs.forEach(function (nm) { toggleRule(nm, 'actress', 'highlight'); }); flashBall('高亮 ' + tActs[0]); return; }
      if (hitAct === 'watch' && tCode) { e.preventDefault(); toggleWatch(tCode, { title: tTitle, url: tHref }); flashBall('⏳ ' + tCode); return; }
      if (k === kOpen && tHref) { e.preventDefault(); window.open(absoluteUrl(tHref), '_blank', 'noopener'); return; }
    }, true);

    // ---- 卡片右键菜单 ----
    document.addEventListener('contextmenu', function (e) {
      var card = (e.target && e.target.closest) ? e.target.closest('.cf-card') : null;
      if (!card) { hideCardMenu(); return; }
      e.preventDefault();
      showCardMenu(e.clientX, e.clientY, card);
    }, true);
    document.addEventListener('mousedown', function (e) {
      if (ctxMenuEl && !ctxMenuEl.contains(e.target)) hideCardMenu();
    }, true);
    window.addEventListener('scroll', hideCardMenu, true);
  }

  /* ---------------- 卡片右键菜单（页面内自绘，不走 chrome.contextMenus） ---------------- */
  var ctxMenuEl = null;
  function hideCardMenu() {
    if (ctxMenuEl && ctxMenuEl.parentNode) ctxMenuEl.parentNode.removeChild(ctxMenuEl);
    ctxMenuEl = null;
  }
  function showCardMenu(x, y, card) {
    hideCardMenu();
    var code = card.dataset.cfCode || '';
    var title = card.dataset.cfTitle || '';
    var acts = (card.dataset.cfA || '').split('||').map(function (v) { return v.trim(); }).filter(Boolean);
    var href = card.querySelector('a[href]');
    var url = href ? absoluteUrl(href.getAttribute('href')) : '';

    var el = document.createElement('div');
    el.className = 'cf-cardmenu';
    var html = '<div class="ttl">' + escapeHtml((code ? code + ' · ' : '') + (title || '（无标题）')) + '</div>' +
      '<div class="sep"></div>';
    if (acts.length) {
      html += '<button data-cm="block" data-v="' + escapeHtml(acts[0]) + '">屏蔽「' + escapeHtml(acts[0]) + '」</button>';
      html += '<button data-cm="favorite" data-v="' + escapeHtml(acts[0]) + '">收藏「' + escapeHtml(acts[0]) + '」</button>';
      html += '<button data-cm="highlight" data-v="' + escapeHtml(acts[0]) + '">高亮「' + escapeHtml(acts[0]) + '」</button>';
      html += '<div class="sep"></div>';
      html += '<button data-cm="tmpblock" data-v="' + escapeHtml(acts[0]) + '" data-d="1">临时屏蔽 1 天</button>';
      html += '<button data-cm="tmpblock" data-v="' + escapeHtml(acts[0]) + '" data-d="7">临时屏蔽 7 天</button>';
      html += '<button data-cm="tmpblock" data-v="' + escapeHtml(acts[0]) + '" data-d="30">临时屏蔽 30 天</button>';
      html += '<div class="sep"></div>';
    }
    html += '<button data-cm="debug">调试这张卡（看规则判定过程）</button>';
    html += '<div class="sep"></div>';
    if (code) {
      html += '<button data-cm="watch" data-v="' + escapeHtml(code) + '">加入 ⏳ 待看</button>';
      html += '<button data-cm="copycode" data-v="' + escapeHtml(code) + '">复制番号</button>';
    }
    if (title) html += '<button data-cm="copytitle" data-v="' + escapeHtml(title) + '">复制标题</button>';
    if (url) html += '<button data-cm="copyurl" data-v="' + escapeHtml(url) + '">复制链接</button>';
    if (code) {
      html += '<div class="sep"></div>';
      html += '<button data-cm="shoppanel" data-v="' + escapeHtml(code) + '">多站比价（一键齐开 + 标记）</button>';
      html += '<button data-cm="openall" data-v="' + escapeHtml(code) + '">在全部站点打开</button>';
      CODE_SITES.forEach(function (cs) {
        html += '<button data-cm="gosearch" data-v="' + escapeHtml(cs.tpl.replace('{q}', encodeURIComponent(code))) + '">在 ' + cs.n + ' 搜索</button>';
      });
    }
    el.innerHTML = html;
    document.documentElement.appendChild(el);

    // 位置修正：避免超出视口
    var r = el.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - r.width - 8);
    var top = Math.min(y, window.innerHeight - r.height - 8);
    el.style.left = Math.max(4, left) + 'px';
    el.style.top = Math.max(4, top) + 'px';
    ctxMenuEl = el;

    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var cm = b.dataset.cm, v = b.dataset.v;
      hideCardMenu();
      if (cm === 'block' || cm === 'favorite' || cm === 'highlight') {
        toggleRule(v, 'actress', cm);
        flashBall(cm === 'block' ? '已屏蔽' : (cm === 'favorite' ? '已收藏' : '已高亮'));
      } else if (cm === 'tmpblock') {
        addTempRule(v, 'actress', Number(b.dataset.d) || 7);
      } else if (cm === 'debug') {
        showDebugPanel(card);
      } else if (cm === 'watch') {
        toggleWatch(v, { title: title, url: url });
        flashBall('⏳ 已加入待看');
      } else if (cm === 'copycode' || cm === 'copytitle' || cm === 'copyurl') {
        copyText(v);
        flashBall('已复制');
      } else if (cm === 'gosearch') {
        window.open(v, '_blank', 'noopener');
      } else if (cm === 'shoppanel') {
        showShopPanel(v);
      } else if (cm === 'openall') {
        openAllSites(v);
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    loadState().then(function () {
      currentSite = matchSite(location.href);
      maybeAutoSeen();
      probeMode = !currentSite;
      // 非监管站点且未开启跨站探测 → 完全不介入
      if (probeMode && (S.settings.probeLinks === false || S.settings.probeAnySite === false)) {
        log('当前站点未纳入监管且未开启跨站探测，退出');
        return;
      }
      buildUI();
      updateHostVisibility();
      runPass();
      observe();
      keys();
      watchSeen();
      watchHover();
      watchPick();
      window.addEventListener('resize', applyPos);

      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[DATA_KEY]) return;
        var d = changes[DATA_KEY].newValue || {};
        S.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
        S.settings.ball = Object.assign({}, DEFAULT_SETTINGS.ball, (d.settings && d.settings.ball) || {});
        S.settings.keys = normKeys(d.settings && d.settings.keys);
        S.sites = d.sites || DEFAULT_SITES;
        S.rules = d.rules || [];
        S.seen = d.seen || {};
        S.favCodes = d.favCodes || S.favCodes;
        S.watchlist = d.watchlist || S.watchlist;
        S.cooc = d.cooc || S.cooc;
        S.groups = d.groups || S.groups;
        S.dailyRecs = d.dailyRecs || S.dailyRecs;
        S.recHistory = d.recHistory || S.recHistory;
        S.similarRecs = d.similarRecs || S.similarRecs;
        invalidateExtract();
        currentSite = matchSite(location.href);
        syncToggles(); syncDots(); syncLockBtn(); applyPos(); updateHostVisibility();
        schedulePass();
      });

      // 后台生成完今日推荐后刷新「📅 今日」页
      chrome.runtime.onMessage.addListener(function (msg) {
        if (!msg) return;
        // 设置页改了「屏蔽后显示方式」：立刻套用，不必刷新页面。
        // 三档对应三组 class（.cf-blocked / .cf-placeholder / .cf-soft），
        // 直接改 settings 后走一趟完整 pass —— 旧的 class 由 clearMarks/resetPassMarks 负责摘掉。
        if (msg.type === 'sf-block-display-changed') {
          if (msg.value) S.settings.blockDisplay = msg.value;
          delete S.settings.softBlock;
          syncToggles();
          schedulePass();
          return;
        }
        if (msg.type !== 'sf_daily_updated' && msg.type !== 'sf_similar_updated') return;
        cfGet(function (d) {
          S.dailyRecs = d.dailyRecs || {};
          S.recHistory = d.recHistory || [];
          S.similarRecs = d.similarRecs || {};
          if (ui && activeTab === 'daily') renderDaily();
          if (ui && activeTab === 'similar') renderSimilar();
        });
      });
    });
  }

  /* ---------------- 测试钩子（只读） ----------------
   * 内容脚本是个 IIFE，闭包内部函数（如磁力解析器 parseMagnet）从外面够不着，
   * 于是测试只能靠「塞一个 DOM 再读面板文字」间接断言 —— 解析细节（字段口径、
   * 归并策略、排序层级）根本测不到，改坏了也不会红。
   *
   * 这里开一扇只读窗口：**只暴露纯函数与只读快照**，不暴露任何可变状态。
   * 打开条件：window.__siteFilterTestApi 严格等于 'magnet-only'（测试显式声明）。
   * 不接受任意对象 —— 否则页面脚本自己塞个对象进来就能摸到扩展内部。
   * 暴露方式也必须是「框架对象上的只读 getter」，不能挂到 window 上。
   * 测试怎么用它：见 _test_magnet.js 里的 vm Proxy 桩。 */
  try {
    if (window.__siteFilterTestApi === 'magnet-only') {
      var hookApi = {};
      var hookSrc = {
        parseMagnet: parseMagnet,
        fmtBytes: fmtBytes,
        guessFromName: guessFromName,
        magnetRank: magnetRank,
        buildMagnetRaw: buildMagnetRaw,
        decodeObfuscated: decodeObfuscated,
        matchRule: matchRule,
        probeLinks: probeLinks,
        dlLinks: function () { return dlLinks; },
        stats: function () { return stats; }
      };
      Object.keys(hookSrc).forEach(function (k) {
        Object.defineProperty(hookApi, k, { get: function () { return hookSrc[k]; }, enumerable: true });
      });
      Object.defineProperty(window, '__sfHook', { value: hookApi, enumerable: false });
    }
  } catch (e) { /* 测试钩子失败绝不影响主流程 */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
