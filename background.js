/* =============================================================
 * SiteFilter —— 后台 Service Worker
 * 职责：初始化默认数据、右键菜单、图标角标、打开设置页
 * ============================================================= */
'use strict';

if (typeof importScripts === 'function') importScripts('collector-native.js');

var DATA_KEY = 'sf_data_v1';
var SCHEMA_VERSION = 4;   // 与 content.js / options.js 保持一致

/* ---------------- 本地错误日志（与 content.js 共用同一份 errLog） ---------------- */
var ERR_MAX = 200;
function logErr(where, e) {
  try {
    var entry = { t: Date.now(), w: String(where || ''), m: String((e && (e.message || e)) || 'unknown').slice(0, 300), s: 'background' };
    chrome.storage.local.get(DATA_KEY, function (o) {
      var d = o[DATA_KEY] || {};
      d.errLog = (d.errLog || []).concat([entry]);
      if (d.errLog.length > ERR_MAX) d.errLog = d.errLog.slice(-ERR_MAX);
      var pl = {}; pl[DATA_KEY] = d;
      try { chrome.storage.local.set(pl, function () { }); } catch (e2) { }
    });
  } catch (_) { }
}

var DEFAULT_SETTINGS = {
  enabled: true,
  sfw: false,
  onlyFav: false,
  onlyFavCode: false,
  boss: false,
  showBall: true,
  pinHighlight: true,
  markSeen: true,
  favBtn: true,
  probeLinks: true,
  probeMark: true,
  probeAnySite: true,
  showWhy: true,
  watchBtn: true,
  softBlock: false,
  previewMode: false,
  peekHours: 24,
  firstMatchWins: false,
  codeSearchBtns: true,
  autoSeen: true,
  auditWarn: true,
  keys: {},
  autoBackup: false,
  hlColor: '#00e5ff',
  ball: { right: 24, bottom: 24 }
};

var DEFAULT_SITES = [
  { id: 's_javbus', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' },
  { id: 's_xchina', pattern: '*://*.xchina.co/*', enabled: true, selector: '', note: 'xchina' },
  { id: 's_javdb571', pattern: '*://*.javdb571.com/*', enabled: true, selector: '', note: 'JavDB 镜像' },
  { id: 's_javdb', pattern: '*://*.javdb.com/*', enabled: true, selector: '', note: 'JavDB' },
  { id: 's_javdb580', pattern: '*://*.javdb580.com/*', enabled: true, selector: '', note: 'JavDB 镜像580' }
];

// 存储区：开启云同步则走 sync，否则 local。两份始终镜像，保证本机读取一致。
function storeArea(d) { return (d && d.settings && d.settings.sync) ? 'sync' : 'local'; }
/* ---------------- 数据迁移 ----------------
 * 任何数据结构变更都要：① SCHEMA_VERSION +1 ② 在 steps 里补一步。
 * migrate 只做「把旧数据补齐成新结构」，必须幂等。 */
function migrate(d) {
  d = d || {};
  var from = Number(d.schemaVersion) || 1;
  if (from > SCHEMA_VERSION) logErr('migrate', new Error('数据来自更高版本 (' + from + ')'));
  var steps = {
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
    // v3 → v4：临时规则有效期 + 自动学习候选规则 + 场景档位
    4: function (x) {
      x.settings = x.settings || {};
      if (x.settings.autoSeen == null) x.settings.autoSeen = true;
      if (x.settings.auditWarn == null) x.settings.auditWarn = true;
      // 规则补 expiresAt（0 / 缺省 = 永久）；不动用户已有的任何字段
      x.rules = (x.rules || []).map(function (r) {
        if (r && r.expiresAt == null) r.expiresAt = 0;
        return r;
      });
      x.learned = x.learned || {};
      x.dismissedLearn = x.dismissedLearn || {};
      x.profiles = x.profiles || [];
      x.activeProfile = x.activeProfile || '';
      x.expiredLog = x.expiredLog || [];
    }
  };
  for (var v = from + 1; v <= SCHEMA_VERSION; v++) {
    if (steps[v]) { try { steps[v](d); } catch (e) { logErr('migrate.v' + v, e); } }
  }
  d.schemaVersion = SCHEMA_VERSION;
  return d;
}

function getData() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(DATA_KEY, function (o) {
      var d = o[DATA_KEY] || {};
      var useSync = !!(d.settings && d.settings.sync);
      var read = useSync ? chrome.storage.sync : chrome.storage.local;
      read.get(DATA_KEY, function (oS) {
        var src = (useSync && oS[DATA_KEY]) ? oS[DATA_KEY] : d;
        src = migrate(src);
        resolve({
          schemaVersion: src.schemaVersion || SCHEMA_VERSION,
          settings: Object.assign({}, DEFAULT_SETTINGS, src.settings || {}),
          sites: (src.sites && src.sites.length) ? src.sites : DEFAULT_SITES.slice(),
          rules: src.rules || [],
          seen: src.seen || {},
          favCodes: src.favCodes || {},
          groups: src.groups || [],
          statsLog: src.statsLog || {},
          discovered: src.discovered || {},
          dailyRecs: src.dailyRecs || {},
          recHistory: src.recHistory || [],
          recFeedback: src.recFeedback || {},
          recFeedbackDaily: src.recFeedbackDaily || {},
          recSettings: src.recSettings || {},
          watchlist: src.watchlist || {},
          cooc: src.cooc || {},
          similarRecs: src.similarRecs || {},
          peeks: src.peeks || {},
          errLog: src.errLog || [],
          learned: src.learned || {},
          dismissedLearn: src.dismissedLearn || {},
          profiles: src.profiles || [],
          activeProfile: src.activeProfile || ''
        });
      });
    });
  });
}

function setData(d) {
  var p = {}; p[DATA_KEY] = d;
  var area = storeArea(d);
  return new Promise(function (resolve) {
    if (area === 'sync') {
      chrome.storage.sync.set(p, function () {
        chrome.storage.local.set(p, function () { resolve(); });
      });
    } else {
      chrome.storage.local.set(p, resolve);
    }
  });
}

/* ---------------- 右键菜单 ---------------- */
function buildMenus() {
  try { chrome.contextMenus.removeAll(function () { createMenus(); }); }
  catch (e) { createMenus(); }
}

function createMenus() {
  getData().then(function (d) {
    var patterns = d.sites.filter(function (s) { return s.enabled && s.pattern; })
      .map(function (s) { return s.pattern; });
    if (!patterns.length) return;

    var items = [
      { id: 'sf_sel_block', title: 'SiteFilter：屏蔽选中内容' },
      { id: 'sf_sel_favorite', title: 'SiteFilter：收藏选中内容' },
      { id: 'sf_sel_highlight', title: 'SiteFilter：高亮选中内容' }
    ];
    items.forEach(function (it) {
      try {
        chrome.contextMenus.create({
          id: it.id,
          title: it.title,
          contexts: ['selection'],
          documentUrlPatterns: patterns
        });
      } catch (e) { /* 重复创建忽略 */ }
    });
  });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  var text = (info.selectionText || '').trim();
  if (!text) return;
  var action = String(info.menuItemId).replace('sf_sel_', '');
  getData().then(function (d) {
    var value = text.split(/\s+/)[0];
    var existing = null;
    for (var i = 0; i < d.rules.length; i++) {
      if (d.rules[i].value.toLowerCase() === value.toLowerCase()) { existing = d.rules[i]; break; }
    }
    if (existing) { existing.action = action; existing.enabled = true; }
    else {
      d.rules.push({
        id: 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'keyword',
        value: value,
        aliases: [],
        action: action,
        match: 'contains',
        scope: 'all',
        color: d.settings.hlColor || '#00e5ff',
        sites: [],
        enabled: true,
        hits: 0
      });
    }
    setData(d);
  });
});

/* ---------------- 每日自动推荐 ---------------- */
// 推荐维度：默认只推女优；可加片商(maker)/系列(series)
var REC_DEFAULTS = {
  enabled: true, max: 12, newMax: 6, minQuality: 0, windowDays: 14,
  excludeSeen: true, dim: ['actress'], notify: true, autoWeights: false, watch: true,
  seenWorkRatio: 0.75,
  weights: { rating: 0.4, works: 0.25, pop: 0.2, recency: 0.15 }
};
var REC_WEIGHTS = REC_DEFAULTS.weights;

function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function daysBetween(a, b) {
  // a,b 均为 YYYY-M-D 串，返回 b - a 的天数
  var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  var da = new Date(pa[0], pa[1] - 1, pa[2]).getTime();
  var db = new Date(pb[0], pb[1] - 1, pb[2]).getTime();
  return Math.round((db - da) / 864e5);
}

// 质量分（0~100）：评分/作品数/人气(出现次数)/近期活跃，权重可在设置页调
function qualityScore(x, w) {
  w = w || REC_WEIGHTS;
  var sum = (Number(w.rating) || 0) + (Number(w.works) || 0) + (Number(w.pop) || 0) + (Number(w.recency) || 0);
  if (sum <= 0) sum = 1;
  var rating = Number(x.rating) || 0;                       // 假设 0~10
  var works = Number(x.works) || 0;
  var pop = Number(x.n) || 0;
  var recency = x.last ? Math.max(0, 1 - (Date.now() - (x.last || 0)) / (90 * 864e5)) : 0;
  var s = 0;
  s += (Math.min(10, rating) / 10) * w.rating;
  s += (Math.min(1, Math.log10(1 + works) / Math.log10(1 + 500))) * w.works;
  s += (Math.min(1, Math.log10(1 + pop) / Math.log10(1 + 100))) * w.pop;
  s += recency * w.recency;
  return Math.min(100, Math.max(0, Math.round(s / sum * 100)));
}

// 根据采纳率反推权重：你屏蔽得多 → 压低被屏蔽项的维度；收藏得多 → 抬高对应维度
function autoWeights(fb) {
  fb = fb || {};
  var w = { rating: 0.4, works: 0.25, pop: 0.2, recency: 0.15 };
  var blocked = 0, faved = 0;
  Object.keys(fb).forEach(function (k) { blocked += fb[k].blocked || 0; faved += fb[k].faved || 0; });
  if (blocked >= 3) { w.rating += 0.1; w.works += 0.05; w.recency -= 0.15; }   // 更看重硬质量，少推同类
  if (faved >= 3) { w.pop += 0.15; w.recency += 0.1; w.rating -= 0.1; w.works -= 0.05; } // 更看重人气/活跃
  ['rating', 'works', 'pop', 'recency'].forEach(function (k) { if (w[k] < 0) w[k] = 0; });
  return w;
}

function reasonOf(x, isNew) {
  if (isNew) {
    var d = x.first ? new Date(x.first) : null;
    var when = d ? (d.getMonth() + 1) + '月' + d.getDate() + '日' : '近期';
    return '新面孔 · 首次见于 ' + when;
  }
  var parts = [];
  if (x.rating) parts.push('评分 ' + (Number(x.rating).toFixed(1)));
  if (x.works) parts.push('作品 ' + x.works);
  if (x.n) parts.push('人气(见过 ' + x.n + ' 次)');
  if (!parts.length) parts.push('近期活跃');
  return parts.join(' · ');
}

// 生成「今日推荐」：新面孔 + 旧高质量，排除收藏/屏蔽/近期已推荐；支持片商/系列维度与反馈调权
function buildDaily(force) {
  getData().then(function (d) {
   try {
    var today = todayStr();
    d.dailyRecs = d.dailyRecs || {};
    d.recHistory = d.recHistory || [];
    d.recFeedback = d.recFeedback || {};
    var rs = Object.assign({}, REC_DEFAULTS, d.recSettings || {});
    if (rs.enabled === false) return;
    if (!force && d.dailyRecs[today]) return;   // 当天已生成

    var dim = (rs.dim && rs.dim.length) ? rs.dim : ['actress'];
    var w = rs.autoWeights ? autoWeights(d.recFeedback) : (rs.weights || REC_WEIGHTS);
    var disc = d.discovered || {};
    var rules = d.rules || [];
    var fb = d.recFeedback;
    var recentShown = {};
    d.recHistory.forEach(function (h) { if (daysBetween(h.date, today) <= rs.windowDays) recentShown[h.name] = true; });

    var now = Date.now();
    var pool = [];
    Object.keys(disc).forEach(function (k) {
      var x = disc[k];
      if (!x || dim.indexOf(x.type) === -1 || !x.v) return;
      // 已被任何规则（屏蔽/收藏/高亮）覆盖 → 不算「未处理」
      if (rules.some(function (r) { return r.type === x.type && String(r.value).toLowerCase() === x.v.toLowerCase(); })) return;
      if (recentShown[x.v]) return;
      // 反馈闭环：被每日推荐后手动屏蔽过 → 不再推荐
      var fk = x.type + '|' + x.v;
      var f = fb[fk];
      if (f && f.blocked > 0) return;
      // 已看维度（细化到「她的具体片子」）：
      //   优先看她在共现库里出现过的番号中，有多少已被你点开过；
      //   数据不足（已知作品 < 3 部）时才退回按整体点击比例判断。
      if (rs.excludeSeen !== false && x.type === 'actress') {
        var cw = (d.cooc && d.cooc[x.v] && d.cooc[x.v].w) || {};
        var known = Object.keys(cw);
        if (known.length >= 3) {
          var sw = known.filter(function (c) { return d.seen && d.seen[c]; });
          x._seenW = sw.length; x._knownW = known.length;
          var wr = sw.length / known.length;
          if (wr >= (rs.seenWorkRatio != null ? rs.seenWorkRatio : 0.75)) return;
        } else {
          var seenN = Number(x.seen) || 0;
          var seenRatio = seenN / Math.max(1, Number(x.n) || 1);
          if (seenN >= 3 && seenRatio >= 0.5) return;
        }
      }
      var ageDays = (now - (x.first || 0)) / 864e5;
      x._isNew = ageDays <= 30;
      x._q = qualityScore(x, w);
      if (f) x._q = Math.max(0, Math.min(100, x._q + (f.faved > 0 ? 5 : 0) - (f.seen > 0 ? 3 : 0)));
      pool.push(x);
    });

    pool.sort(function (a, b) {
      return ((b._isNew ? 1 : 0) - (a._isNew ? 1 : 0)) || (b._q - a._q);
    });

    var newOnes = pool.filter(function (x) { return x._isNew; });
    var oldOnes = pool.filter(function (x) { return !x._isNew && x._q >= (rs.minQuality || 0); });
    var takeNew = Math.min(rs.newMax, newOnes.length);
    var takeOld = Math.max(0, rs.max - takeNew);
    var picks = newOnes.slice(0, takeNew).concat(oldOnes.slice(0, takeOld)).slice(0, rs.max);

    var recs = picks.map(function (x) {
      var reason = reasonOf(x, x._isNew);
      if (x._knownW) reason += ' · 你已看 ' + x._seenW + '/' + x._knownW + ' 部';
      return {
        name: x.v, type: x.type,
        avatar: x.avatar || '', href: x.href || '', site: x.site || '',
        reason: reason,
        reasonType: x._isNew ? 'new' : 'quality',
        quality: Math.round(x._q),
        seenW: x._seenW || 0, knownW: x._knownW || 0,
        first: x.first || 0, last: x.last || 0, n: x.n || 0, rating: Number(x.rating) || 0, works: Number(x.works) || 0
      };
    });

    // 追更提醒：你收藏/高亮的 片商·系列 近期有新作 → 置顶析出
    if (rs.watch !== false) {
      var favMS = {};
      rules.forEach(function (r) {
        if (r.enabled === false) return;
        if ((r.type === 'maker' || r.type === 'series') && (r.action === 'favorite' || r.action === 'highlight')) {
          favMS[r.type + '|' + String(r.value).toLowerCase()] = r;
        }
      });
      var watchHits = [];
      Object.keys(favMS).forEach(function (k) {
        var e = disc[k];
        if (!e || !e.v) return;
        if ((now - (e.last || 0)) > 7 * 864e5) return;      // 只在近 7 天有活动时提醒
        if (recentShown[e.v]) return;
        watchHits.push({
          name: e.v, type: e.type,
          avatar: e.avatar || '', href: e.href || '', site: e.site || '',
          reason: '⭐ 你关注的' + (e.type === 'maker' ? '片商' : '系列') + '近期有新作（累计见过 ' + (e.n || 0) + ' 次）',
          reasonType: 'watch', quality: qualityScore(e, w),
          first: e.first || 0, last: e.last || 0, n: e.n || 0, rating: Number(e.rating) || 0, works: Number(e.works) || 0
        });
      });
      var seenName = {};
      recs.forEach(function (r) { seenName[r.type + '|' + r.name] = 1; });
      watchHits.forEach(function (r) {
        var k = r.type + '|' + r.name;
        if (seenName[k]) return;
        seenName[k] = 1;
        recs.unshift(r);      // 追更优先展示
      });
      recs = recs.slice(0, rs.max + watchHits.length);
    }

    d.dailyRecs[today] = recs;
    recs.forEach(function (r) { d.recHistory.push({ name: r.name, date: today }); });
    d.recHistory = d.recHistory.filter(function (h) { return daysBetween(h.date, today) <= 30; });

    setData(d).then(function () {
      try { chrome.runtime.sendMessage({ type: 'sf_daily_updated', date: today, count: recs.length }); } catch (e) { }
      if (rs.notify !== false && recs.length) {
        try {
          chrome.notifications.create('sf_daily_' + today, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: 'SiteFilter · 今日推荐已就绪',
            message: '为你挑选了 ' + recs.length + ' 条' + (dim.length > 1 ? '（含片商/系列）' : '女优') + '，点开查看 →'
          });
        } catch (e) { }
      }
    });
   } catch (e) { logErr('buildDaily', e); }
  });
}

/* ---------------- 相似女优推荐 ----------------
 * 算法说明（相比朴素"共同标签计数"的改进）：
 *  1) 多信号融合：标签 + 片商 + 系列 + 导演，各维度带权重（片商/系列比通用标签更有区分度）。
 *  2) IDF 加权：某个特征被越多人共享，权重越低 —— "高清""中文字幕"这类满大街的标签会被自动压低，
 *     而"某冷门题材"这种只有少数人共享的特征权重高，相似度因此更有区分度。
 *  3) 频次对数压缩：同一特征共现 10 次不等于比 1 次像 10 倍，用 log(1+c) 抑制头部。
 *  4) 余弦归一化：除以两人各自的特征模长，避免"作品多的女优跟谁都像"。
 *  5) 种子聚合：以你收藏(权重1.0)/高亮(0.7)的女优为种子，候选得分 = 0.6×最像的种子 + 0.4×平均相似度，
 *     既保留"和某一位极像"又兼顾"整体品味一致"。
 *  6) 排除已被任何规则覆盖的人、以及你手动屏蔽过的推荐项。
 */
function buildSimilar() {
  getData().then(function (d) {
   try {
    var cooc = d.cooc || {};
    var rules = d.rules || [];
    var fb = d.recFeedback || {};
    var today = todayStr();
    d.similarRecs = d.similarRecs || {};

    // 种子：收藏 / 高亮的女优
    var seeds = [];
    rules.forEach(function (r) {
      if (r.enabled === false) return;
      if (r.type !== 'actress') return;
      if (r.action !== 'favorite' && r.action !== 'highlight') return;
      var name = String(r.value);
      if (cooc[name]) seeds.push({ name: name, w: r.action === 'favorite' ? 1 : 0.7 });
    });
    if (!seeds.length) {
      d.similarRecs[today] = [];
      return setData(d).then(function () {
        try { chrome.runtime.sendMessage({ type: 'sf_similar_updated', count: 0 }); } catch (e) { }
      });
    }

    var ruled = {};
    rules.forEach(function (r) { if (r.type === 'actress') ruled[String(r.value).toLowerCase()] = 1; });

    // 全局特征文档频率（用于 IDF）与总人数
    var df = { tag: {}, maker: {}, series: {}, director: {} };
    var N = 0;
    Object.keys(cooc).forEach(function (nm) {
      var e = cooc[nm]; if (!e) return; N++;
      ['tag', 'maker', 'series', 'director'].forEach(function (dim) {
        Object.keys(e[dim] || {}).forEach(function (f) { df[dim][f] = (df[dim][f] || 0) + 1; });
      });
    });
    function idf(dim, f) { var n = df[dim][f] || 1; return Math.log(1 + N / n); }

    var DIM_W = { tag: 1.0, maker: 0.8, series: 0.9, director: 0.6 };
    var vecCache = {};
    function buildVec(nm) {
      var e = cooc[nm] || {};
      var vec = {}, norm = 0;
      ['tag', 'maker', 'series', 'director'].forEach(function (dim) {
        var m = e[dim] || {};
        Object.keys(m).forEach(function (f) {
          var v = DIM_W[dim] * Math.log(1 + m[f]) * idf(dim, f);
          if (v > 0) { vec[dim + '\u0001' + f] = v; norm += v * v; }
        });
      });
      return { vec: vec, norm: Math.sqrt(norm) || 1 };
    }
    function getVec(nm) { return vecCache[nm] || (vecCache[nm] = buildVec(nm)); }
    function cosine(a, b) {
      var va = getVec(a), vb = getVec(b);
      if (va.norm <= 1e-6 || vb.norm <= 1e-6) return 0;
      var keys = Object.keys(va.vec), dot = 0;
      for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (vb.vec[k]) dot += va.vec[k] * vb.vec[k]; }
      return dot / (va.norm * vb.norm);
    }
    // 相似度按维度分解（用于可视化「像在哪」）
    function dimParts(a, b) {
      var va = getVec(a), vb = getVec(b);
      if (va.norm <= 1e-6 || vb.norm <= 1e-6) return null;
      var denom = va.norm * vb.norm, raw = { tag: 0, series: 0, maker: 0, director: 0 }, total = 0;
      Object.keys(va.vec).forEach(function (k) {
        if (!vb.vec[k]) return;
        var dot = va.vec[k] * vb.vec[k];
        var dim = k.split('\u0001')[0];
        raw[dim] = (raw[dim] || 0) + dot; total += dot;
      });
      if (total <= 1e-9) return null;
      var pct = {};
      Object.keys(raw).forEach(function (d) { pct[d] = Math.round((raw[d] / total) * 100); });
      return { sim: total / denom, pct: pct };
    }
    // 共同点明细：每个共同特征在双方各出现多少次、稀有度(IDF)、对相似度的贡献
    function sharedDetail(a, b) {
      var ea = cooc[a] || {}, eb = cooc[b] || {}, out = [];
      ['tag', 'series', 'maker', 'director'].forEach(function (dim) {
        var ma = ea[dim] || {}, mb = eb[dim] || {};
        Object.keys(ma).forEach(function (f) {
          if (!mb[f]) return;
          var i = idf(dim, f);
          out.push({
            dim: dim, f: f, c: ma[f], s: mb[f],
            idf: Math.round(i * 100) / 100,
            w: Math.pow(DIM_W[dim], 2) * Math.log(1 + ma[f]) * Math.log(1 + mb[f]) * i * i
          });
        });
      });
      out.sort(function (x, y) { return y.w - x.w; });
      return out;
    }
    // 共同出演作品：两位女优出现在同一张卡片（同一部作品）里的番号
    function worksOf(nm) {
      var w = (cooc[nm] || {}).w || {}, out = [];
      Object.keys(w).forEach(function (code) {
        out.push({ code: code, t: (w[code] && w[code].t) || '', u: (w[code] && w[code].u) || '', at: (w[code] && w[code].at) || 0 });
      });
      out.sort(function (x, y) { return y.at - x.at; });
      return out;
    }

    var cands = [];
    Object.keys(cooc).forEach(function (nm) {
      if (ruled[nm.toLowerCase()]) return;
      var f = fb['actress|' + nm];
      if (f && f.blocked > 0) return;
      var best = 0, sum = 0, cnt = 0, bestSeed = '';
      for (var i = 0; i < seeds.length; i++) {
        var s = seeds[i];
        if (s.name === nm) continue;
        var sim = cosine(s.name, nm);
        sum += sim * s.w; cnt += s.w;
        if (sim * s.w > best) { best = sim * s.w; bestSeed = s.name; }
      }
      if (!cnt) return;
      var score = 0.6 * best + 0.4 * (sum / cnt);
      if (score < 0.05) return;
      cands.push({ name: nm, sim: score, seed: bestSeed });
    });

    cands.sort(function (a, b) { return b.sim - a.sim; });
    var disc = d.discovered || {};
    var recs = cands.slice(0, 24).map(function (c) {
      var info = disc['actress|' + c.name] || {};
      var seedInfo = disc['actress|' + c.seed] || {};
      var shared = sharedDetail(c.name, c.seed);
      var bp = dimParts(c.name, c.seed);
      var mine = worksOf(c.name), seedWorks = worksOf(c.seed);
      var seedCodes = {};
      seedWorks.forEach(function (x) { seedCodes[x.code] = 1; });
      var both = [];
      mine.forEach(function (x) { x.both = !!seedCodes[x.code]; if (x.both) both.push(x.code); });
      // 共同出演的作品排在最前，其次按最近出现
      mine.sort(function (x, y) { return (y.both ? 1 : 0) - (x.both ? 1 : 0) || (y.at - x.at); });

      var reason = '因为你收藏了 ' + c.seed +
        (shared.length ? ' · 共同点：' + shared.slice(0, 4).map(function (x) { return x.f; }).join('、') : ' · 品味相近');
      if (both.length) reason += ' · 共同出演 ' + both.length + ' 部';

      return {
        name: c.name, type: 'actress', sim: c.sim,
        avatar: info.avatar || '', href: info.href || '', site: info.site || '',
        rating: Number(info.rating) || 0, works: Number(info.works) || 0,
        reason: reason, seed: c.seed, seedAvatar: seedInfo.avatar || '',
        parts: bp ? bp.pct : {},
        shared: shared.slice(0, 12),
        works: mine.slice(0, 10),
        sharedWorks: both.slice(0, 8),
        quality: qualityScore(info)
      };
    });

    d.similarRecs[today] = recs;
    setData(d).then(function () {
      try { chrome.runtime.sendMessage({ type: 'sf_similar_updated', count: recs.length }); } catch (e) { }
    });
   } catch (e) { logErr('buildSimilar', e); }
  });
}

/* ---------------- 本地定时自动备份（写入浏览器下载目录） ---------------- */
function autoBackup() {
  getData().then(function (d) {
    if (!(d.settings && d.settings.autoBackup)) return;
    try {
      var json = JSON.stringify(d);
      var url = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
      chrome.downloads.download({
        url: url,
        filename: 'sitefilter-backup/sitefilter-' + todayStr() + '.json',
        conflictAction: 'overwrite',
        saveAs: false
      }, function () { });
    } catch (e) { }
  });
}

/* ---------------- 消息 ---------------- */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;
  if (typeof msg.type === 'string' && msg.type.indexOf('sf_collector_') === 0) {
    SiteFilterCollectorBridge.routeMessage(msg).then(function (result) {
      sendResponse({ ok: true, result: result });
    }).catch(function (e) {
      sendResponse({ ok: false, error: { code: e.code || 'collector-error', message: e.message || 'Collector 请求失败。', retriable: !!e.retriable } });
    });
    return true;
  }
  try { handleMsg(msg); } catch (e) { logErr('onMessage:' + (msg && msg.type), e); }
});

function handleMsg(msg) {
  if (msg.type === 'sf_open_options') {
    try { chrome.runtime.openOptionsPage(); } catch (e) { }
  } else if (msg.type === 'sf_stats' && typeof msg.blocked === 'number') {
    try {
      chrome.action.setBadgeBackgroundColor({ color: '#ff4d6d' });
      chrome.action.setBadgeText({ text: msg.blocked > 0 ? String(msg.blocked) : '' });
    } catch (e) { }
  } else if (msg.type === 'sf_build_daily') {
    buildDaily(!!msg.force);
  } else if (msg.type === 'sf_build_similar') {
    buildSimilar();
  } else if (msg.type === 'sf_build_learned') {
    // 设置页点「立刻归纳一次」时走这里；MV3 里页面拿不到 service worker 的函数
    buildLearned();
  } else if (msg.type === 'sf_purge_expired') {
    purgeExpiredRules();
  } else if (msg.type === 'sf_log_err') {
    logErr(msg.where || 'content', new Error(msg.message || 'unknown'));
  }
}

/* ---------------- 临时规则清理 ----------------
 规则带 expiresAt（毫秒）。到期后不再是"仍生效但被跳过"，而是直接移除，
 免得规则库越来越长；移除的会记进 expiredLog 方便回查。
 只在真正有到期规则时写盘，避免每天空跑一次 IO。 */
function purgeExpiredRules() {
  return getData().then(function (d) {
    var now = Date.now();
    var rules = d.rules || [];
    var dead = [], alive = [];
    rules.forEach(function (r) {
      if (r && r.expiresAt && Number(r.expiresAt) > 0 && now >= Number(r.expiresAt)) dead.push(r);
      else alive.push(r);
    });
    if (!dead.length) return { removed: 0 };
    d.rules = alive;
    d.expiredLog = (d.expiredLog || []).concat(dead.map(function (r) {
      return { value: r.value, type: r.type, action: r.action, expiredAt: now };
    })).slice(-200);
    return setData(d).then(function () {
      try { chrome.runtime.sendMessage({ type: 'sf_rules_updated', removed: dead.length }); } catch (e) { }
      return { removed: dead.length };
    });
  }).catch(function (e) { logErr('purgeExpired', e); return { removed: 0 }; });
}

/* ---------------- 自动学习候选规则 ----------------
 思路：你屏蔽了 A/B/C 三位，她们的共同标签/片商/系列是 X → 建议"把 X 也屏蔽"。
 与「相似女优」互补：那个推人，这个推规则。
 判定用「覆盖率 + 精确率」两个指标，两者都够高才推 —— 只看覆盖率会推出"高清"这种没意义的词。 */
function buildLearned() {
  return getData().then(function (d) {
    try {
      var cooc = d.cooc || {};
      var rules = (d.rules || []).filter(function (r) { return r && r.enabled !== false && !isExpired(r); });
      var dismissed = d.dismissedLearn || {};
      var out = {};

      // 同一动作 + 同一维度的规则，才拿来归纳
      var byActType = {};
      rules.forEach(function (r) {
        if (r.type === 'expr' || r.type === 'code' || r.type === 'keyword') return;   // 这几类不适合归纳
        var k = r.action + '|' + r.type;
        (byActType[k] = byActType[k] || []).push(String(r.value));
      });

      var totalPeople = Object.keys(cooc).length;
      if (totalPeople < 6) {
        d.learned = { at: Date.now(), total: totalPeople, items: [] };
        return setData(d);
      }

      Object.keys(byActType).forEach(function (k) {
        var parts = k.split('|');
        var action = parts[0], rtype = parts[1];
        var seeds = byActType[k];
        if (seeds.length < 3) return;                      // 少于 3 条归纳不出稳定共性

        var seedSet = {};
        seeds.forEach(function (n) { seedSet[String(n).toLowerCase()] = 1; });

        // 统计每个特征的覆盖（多少种子身上有）与全局出现人数（算精确率）
        var stat = { tag: {}, maker: {}, series: {}, director: {} };
        var globalCnt = { tag: {}, maker: {}, series: {}, director: {} };
        Object.keys(cooc).forEach(function (nm) {
          var e = cooc[nm]; if (!e) return;
          var isSeed = !!seedSet[String(nm).toLowerCase()];
          ['tag', 'maker', 'series', 'director'].forEach(function (dim) {
            Object.keys(e[dim] || {}).forEach(function (f) {
              globalCnt[dim][f] = (globalCnt[dim][f] || 0) + 1;
              if (isSeed) {
                var t = stat[dim][f] || (stat[dim][f] = { cov: 0, who: [] });
                t.cov++;
                if (t.who.length < 5) t.who.push(nm);
              }
            });
          });
        });

        ['series', 'maker', 'tag'].forEach(function (dim) {
          Object.keys(stat[dim]).forEach(function (f) {
            var t = stat[dim][f];
            var coverage = t.cov / seeds.length;                 // 你屏蔽的人里有多少带这个特征
            var precision = t.cov / (globalCnt[dim][f] || 1);    // 带这个特征的人里有多少被屏蔽
            if (coverage < 0.5 || precision < 0.6) return;       // 两个都够高才推
            if (isCoveredByRules(rules, f)) return;              // 已经被规则覆盖就别重复推
            var key = action + '|' + dim + '|' + f.toLowerCase();
            if (dismissed[key]) return;
            if (out[key]) return;
            out[key] = {
              at: Date.now(), action: action, dim: dim, value: f,
              coverage: Math.round(coverage * 100),
              precision: Math.round(precision * 100),
              score: Math.round((coverage * 0.55 + precision * 0.45) * 100),
              evidence: t.who, seedCount: seeds.length
            };
          });
        });
      });

      d.learned = {
        at: Date.now(), total: totalPeople,
        items: Object.keys(out).map(function (x) { return out[x]; })
          .sort(function (a, b) { return b.score - a.score; }).slice(0, 12)
      };
      return setData(d).then(function () {
        try { chrome.runtime.sendMessage({ type: 'sf_learned_updated', count: d.learned.items.length }); } catch (e) { }
      });
    } catch (e) {
      logErr('buildLearned', e);
      return d;
    }
  });
}

function isExpired(r) { return !!(r && r.expiresAt && Number(r.expiresAt) > 0 && Date.now() >= Number(r.expiresAt)); }

function isCoveredByRules(rules, feature) {
  var low = String(feature).toLowerCase();
  return rules.some(function (r) {
    if (!r || r.type === 'expr') return false;
    var v = String(r.value || '').toLowerCase();
    return v === low || (r.aliases || []).some(function (a) { return String(a).toLowerCase() === low; });
  });
}

/* ---------------- 生命周期 ---------------- */
function ensureAlarm() {
  try {
    chrome.alarms.create('sf_daily_rec', { periodInMinutes: 1440 });
    chrome.alarms.create('sf_backup', { periodInMinutes: 1440, delayInMinutes: 30 });
    chrome.alarms.create('sf_collector_tasks', { periodInMinutes: 1 });
  } catch (e) { }
}

function pollCollectorTasks() {
  SiteFilterCollectorBridge.restoreAndPoll().catch(function (e) { logErr('collector.poll', e); });
}

chrome.runtime.onInstalled.addListener(function () {
  getData().then(function (d) { return setData(d); }).then(buildMenus);
  ensureAlarm();
  buildDaily(false);   // 安装当天也先生成一版
  buildSimilar();
  purgeExpiredRules();
  buildLearned();
  pollCollectorTasks();
});
chrome.runtime.onStartup.addListener(function () {
  buildMenus(); ensureAlarm(); purgeExpiredRules().then(function () {
    buildDaily(false); buildSimilar(); buildLearned();
  }); autoBackup(); pollCollectorTasks();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (!alarm) return;
  if (alarm.name === 'sf_daily_rec') { purgeExpiredRules().then(function () { buildDaily(false); buildSimilar(); buildLearned(); }); }
  else if (alarm.name === 'sf_backup') autoBackup();
  else if (alarm.name === 'sf_collector_tasks') pollCollectorTasks();
});

chrome.notifications.onClicked.addListener(function (notificationId) {
  if (/^sf_collector_task_\d+$/.test(String(notificationId || ''))) {
    SiteFilterCollectorBridge.openNotification(notificationId).catch(function (e) { logErr('collector.notification', e); });
    return;
  }
  try { chrome.runtime.openOptionsPage(); } catch (e) { }
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes[DATA_KEY]) buildMenus();
});
