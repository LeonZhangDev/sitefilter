/* =============================================================
 * SiteFilter —— 站点与维度规则表（全扩展唯一事实来源）
 *
 * 为什么单独一个文件：站点信息曾经散在 5 处 —— content.js 的 DEFAULT_SITES /
 * KNOWN_SELECTORS / SELECTOR_TEMPLATES / CODE_SITES，background.js 的 DEFAULT_SITES，
 * options.js 的 DEFAULT_SITES_OPTIONS / TPL_SELECTORS。加一个站要改 4 个地方，
 * 漏一处就表现为「面板能开、却识别不出卡片」这种静默失效；更糟的是三份 migrate
 * 各自带的补站名单一旦不同，同一份数据会在不同入口被解读成两种行为。
 *
 * 现在整个扩展只有这一张表 + 这里的一组派生。三端共用：
 *   content.js      —— manifest 的 content_scripts（排在 content.js 之前）
 *   background.js   —— service worker，走 importScripts
 *   options.js      —— 设置页，走 options.html 的 <script>
 *
 * 本文件是**纯数据 + 纯派生**：不碰 document / location / chrome.* / UI 状态，
 * 因此可以在 Node 里直接 require 单测（见 _test_sites.js / _test_assembly.js）。
 * 「按 host 取模板、缓存、裸域兜底」这类**依赖 location** 的逻辑仍留在 content.js ——
 * 放进 service worker 会拿 worker 自己的 location 去匹配页面，是个很难查的错。
 *
 * 表字段含义见下方 SITE_TEMPLATES 的注释块（那是全库唯一的字段说明）。
 * ============================================================= */
(function () {
  'use strict';

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

  // 不同维度的默认作用范围
  var SCOPE_OF = {
    actress: 'actress', tag: 'tag', maker: 'maker', series: 'series',
    director: 'director', keyword: 'title', code: 'title'
  };

  /* 番号多站直达：纯本地拼 URL，零网络请求。由站点模板的 sbtn + search 派生 */
  var CODE_SITES = SITE_TEMPLATES.filter(function (t) { return t.sbtn && t.search; })
    .map(function (t) { return { n: t.sbtn, tpl: t.search }; });

  /* 镜像站点归一：javdb.com / javdb571.com / javdb580.com 是同一个站的三个域名。
     发现库按「来源组」记而不是按域名记 —— 否则同一个演员在三个镜像上逛一圈，
     会被当成三个来源，出现次数 n 也会三倍膨胀，进而影响规则体检的「命中面」估算
     和候选规则的覆盖率计算。n 本身的含义（出现次数）不变，只是多了按组拆分的账。 */
  var MIRROR_GROUPS = (function () {
    var m = {};
    SITE_TEMPLATES.forEach(function (t) { if (t.mirror) m[t.mirror] = (m[t.mirror] || 0) + 1; });
    return m;
  })();

  /* 导出单一命名空间。挂 globalThis 而不是 window：
     service worker 里没有 window，但 importScripts 进来的文件与 SW 共享 globalThis。 */
  var SF_SITES = {
    SITE_TEMPLATES: SITE_TEMPLATES,
    LINK_KINDS: LINK_KINDS,
    SCOPE_OF: SCOPE_OF,
    DEFAULT_SITES: DEFAULT_SITES,
    KNOWN_SELECTORS: KNOWN_SELECTORS,
    SELECTOR_TEMPLATES: SELECTOR_TEMPLATES,
    CODE_SITES: CODE_SITES,
    MIRROR_GROUPS: MIRROR_GROUPS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SF_SITES;
  try { if (typeof globalThis !== 'undefined') globalThis.SF_SITES = SF_SITES; } catch (e) { }
})();
