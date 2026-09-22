'use strict';
var DATA_KEY = 'sf_data_v1';
var SCHEMA_VERSION = 6;   // 与 content.js / background.js 保持一致

/* ---------------- 错误日志（与 content/background 共用同一份 errLog） ---------------- */
var ERR_MAX = 200;
function logErr(where, e) {
  try {
    D.errLog = D.errLog || [];
    D.errLog.push({ t: Date.now(), w: String(where || ''), m: String((e && (e.message || e)) || 'unknown').slice(0, 300), s: 'options' });
    if (D.errLog.length > ERR_MAX) D.errLog = D.errLog.slice(-ERR_MAX);
  } catch (_) { }
}
window.addEventListener('error', function (ev) {
  logErr('window', ev.error || new Error(ev.message || 'error'));
  save();
});
var COLORS = ['#00e5ff', '#ff4d6d', '#7c5cff', '#22c55e', '#ff9f1c', '#ffc93c'];

var DEFAULT_SETTINGS = {
  enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
  showBall: true, pinHighlight: true, markSeen: true, favBtn: true,
  watchBtn: true, showWhy: true, softBlock: false, autoBackup: false,
  backupKeep: 7,               // 自动备份快照轮换份数：0 = 不轮换（无限累积）
  backfill: 'off',             // 番号站数量补足：'off' / 'same' / 正整数（唯一会联网的开关）
  blockDisplay: 'placeholder', // 屏蔽后显示方式：'hide' 完全隐藏 / 'placeholder' 保留占位（默认）/ 'soft' 灰化遮罩
  probeLinks: true, probeMark: true, probeAnySite: true,
  hlColor: '#00e5ff', ball: { right: 24, bottom: 24 },
  ballLock: false,     // 锁定悬浮球位置（锁定后拖不动）
  onboarded: false, lastRecDay: '',
  previewMode: false, peekHours: 24,
  firstMatchWins: false, codeSearchBtns: true,
  keys: {},
  autoSeen: true,        // 打开详情页时自动把该番号标为已看
  auditWarn: true        // 建屏蔽规则前先估算影响面，过宽时先确认
};
var SWITCHES = [
  ['enabled', '启用过滤'], ['sfw', 'SFW 缩略图模糊'], ['onlyFav', '只看收藏（女优/标签等）'],
  ['onlyFavCode', '只看★番号收藏'], ['boss', '老板键'], ['showBall', '显示悬浮球'],
  ['ballLock', '锁定悬浮球位置（锁定后拖不动，点击仍可开合面板）'],
  ['pinHighlight', '高亮卡片置顶'], ['markSeen', '标记已看'], ['favBtn', '卡片 ♥ 收藏按钮'],
  ['watchBtn', '卡片 ⏳ 待看按钮'], ['showWhy', '悬停显示「为什么被处理」浮层'],
  // 注意：softBlock 已并入下面的 SELECTS（三档「屏蔽后显示方式」），别再加回这里
  ['previewMode', '规则预览（不真正隐藏，只描边提示「将会被屏蔽」）'],
  ['firstMatchWins', '规则按顺序、首个命中生效（关闭则屏蔽 > 收藏 > 高亮）'],
  ['codeSearchBtns', '番号处显示多站直达（Bus / DB / 580 / XC）'],
  ['autoSeen', '打开详情页自动记录「已看」'],
  ['auditWarn', '建屏蔽规则前先估算影响面（过宽时先确认）'],
  ['probeLinks', '下载链接探测'], ['probeMark', '页面内标记下载链接'], ['probeAnySite', '非监管站点也探测']
];
var TYPE_LABEL = { actress: '女优', tag: '标签', maker: '片商', series: '系列', director: '导演', keyword: '标题词', code: '番号', expr: '表达式' };
var SCOPE_OF = {
  actress: 'actress', tag: 'tag', maker: 'maker', series: 'series',
  director: 'director', keyword: 'title', code: 'title'
};
var MATCH_LABEL = { contains: '包含', exact: '精确', regex: '正则' };

/* 默认监管站点：content.js 的 SITE_TEMPLATES 是唯一事实来源，这里是同一份数据的副本
   （设置页是独立页面，拿不到 content script 的全局变量）。
   由 _test_sites.js 断言两边 id / pattern / note 必须一致 —— 别只改一处。 */
var DEFAULT_SITES_OPTIONS = [
  { id: 's_javbus', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' },
  { id: 's_xchina', pattern: '*://*.xchina.co/*', enabled: true, selector: '', note: 'xchina' },
  { id: 's_javdb571', pattern: '*://*.javdb571.com/*', enabled: true, selector: '', note: 'JavDB 镜像' },
  { id: 's_javdb', pattern: '*://*.javdb.com/*', enabled: true, selector: '', note: 'JavDB' },
  { id: 's_javdb580', pattern: '*://*.javdb580.com/*', enabled: true, selector: '', note: 'JavDB 镜像580' },
  { id: 's_pornhub', pattern: '*://*.pornhub.com/*', enabled: true, selector: '', note: 'PornHub' },
  { id: 's_youporn', pattern: '*://*.youporn.com/*', enabled: true, selector: '', note: 'YouPorn' },
  { id: 's_xsijishe', pattern: '*://*.xsijishe.net/*', enabled: true, selector: '', note: 'xsijishe（求出处）' }
];

var D = {
  schemaVersion: SCHEMA_VERSION,
  settings: {}, sites: [], rules: [], seen: {}, favCodes: {}, discovered: {}, groups: [],
  statsLog: {}, recSettings: {}, recHistory: [], dailyRecs: {}, recFeedback: {},
  watchlist: {}, cooc: {}, similarRecs: {}, recFeedbackDaily: {}, peeks: {}, errLog: [],
  learned: {}, dismissedLearn: {}, profiles: [], activeProfile: '', expiredLog: []
};

/* ---------------- 数据迁移 ----------------
 * 与 content.js / background.js 同一套规则：改结构就 +1 并补一步。幂等。 */
function migrate(d) {
  d = d || {};
  var from = Number(d.schemaVersion) || 1;
  var steps = {
    2: function (x) {
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
    // v3 → v4：① 临时规则有效期（rule.expiresAt）② 自动学习候选规则 ③ 场景档位 Profile
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
    // v4 → v5：站点模板化。按 id 把缺的默认站点补齐（与 content.js / background.js 同一份逻辑）
    5: function (x) {
      x.sites = x.sites || [];
      var have = {};
      x.sites.forEach(function (s) { if (s && s.id) have[s.id] = 1; });
      DEFAULT_SITES_OPTIONS.forEach(function (s) {
        if (have[s.id]) return;
        x.sites.push({ id: s.id, pattern: s.pattern, enabled: true, selector: '', note: s.note });
      });
    },
    // v5 → v6：屏蔽显示方式从二元开关 softBlock 升级为三档 blockDisplay。
    // 必须与 content.js / background.js 的 step 6 逐字一致 —— 三份迁移结果不同
    // 会让同一份数据在不同入口被解读成两种行为。迁移尊重老用户既有行为：
    // 勾过软屏蔽 → 'soft'，没勾的 → 'hide'；'placeholder' 只是全新安装的默认。
    6: function (x) {
      x.settings = x.settings || {};
      if (!x.settings.blockDisplay) {
        x.settings.blockDisplay = x.settings.softBlock ? 'soft' : 'hide';
      }
      delete x.settings.softBlock;
    }
  };
  for (var v = from + 1; v <= SCHEMA_VERSION; v++) {
    if (steps[v]) { try { steps[v](d); } catch (e) { logErr('migrate.v' + v, e); } }
  }
  d.schemaVersion = SCHEMA_VERSION;
  return d;
}
// 撤销快照（仅 rules + groups，最多 40 步）
var undoStack = [];
var dragId = null;   // 规则拖动排序用
function pushUndo() {
  try {
    undoStack.push({
      rules: JSON.parse(JSON.stringify(D.rules || [])),
      groups: JSON.parse(JSON.stringify(D.groups || []))
    });
    if (undoStack.length > 40) undoStack.shift();
  } catch (e) { }
}
function doUndo() {
  if (!undoStack.length) { alert('没有可撤销的操作了。'); return; }
  var s = undoStack.pop();
  D.rules = s.rules; D.groups = s.groups;
  save().then(function () { renderRules(); renderGroups(); renderConflicts(); });
}

// 同步感知存储：开启云同步则走 sync 并镜像到 local，否则仅 local
function cfGet(cb) {
  var useSync = !!(D.settings && D.settings.sync);
  chrome.storage[useSync ? 'sync' : 'local'].get(DATA_KEY, function (o) { cb(o[DATA_KEY] || {}); });
}
function cfSet(payload, cb) {
  if (D.settings && D.settings.sync) {
    chrome.storage.sync.set(payload, function () { chrome.storage.local.set(payload, function () { if (cb) cb(); }); });
  } else {
    chrome.storage.local.set(payload, function () { if (cb) cb(); });
  }
}

function get() {
  return new Promise(function (res) {
    cfGet(function (d) {
      d = migrate(d);
      D.schemaVersion = d.schemaVersion;
      D.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
      D.sites = d.sites || [];
      D.rules = d.rules || [];
      D.seen = d.seen || {};
      D.favCodes = d.favCodes || {};
      D.discovered = d.discovered || {};
      D.groups = d.groups || [];
      D.statsLog = d.statsLog || {};
      D.recSettings = d.recSettings || {};
      D.recHistory = d.recHistory || [];
      D.dailyRecs = d.dailyRecs || {};
      D.recFeedback = d.recFeedback || {};
      D.watchlist = d.watchlist || {};
      D.cooc = d.cooc || {};
      D.similarRecs = d.similarRecs || {};
      D.recFeedbackDaily = d.recFeedbackDaily || {};
      D.peeks = d.peeks || {};
      D.shopMarks = d.shopMarks || {};
      D.errLog = d.errLog || [];
      D.learned = d.learned || {};
      D.dismissedLearn = d.dismissedLearn || {};
      D.profiles = d.profiles || [];
      D.activeProfile = d.activeProfile || '';
      D.expiredLog = d.expiredLog || [];
      res(D);
    });
  });
}
function save() {
  var p = {}; p[DATA_KEY] = D;
  return new Promise(function (res) { cfSet(p, res); });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid() { return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------------- Tab ---------------- */
document.querySelectorAll('.tabs button').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('on'); });
    document.querySelectorAll('.pane').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    document.getElementById('pane-' + b.dataset.pane).classList.add('on');
  });
});

/* ---------------- 规则表 ---------------- */
function filteredRules() {
  var q = (document.getElementById('search').value || '').trim().toLowerCase();
  var ft = document.getElementById('fType').value;
  var fa = document.getElementById('fAction').value;
  return D.rules.filter(function (r) {
    if (ft && r.type !== ft) return false;
    if (fa && r.action !== fa) return false;
    if (q) {
      var hay = (r.value + ' ' + (r.aliases || []).join(' ')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function renderRules() {
  var list = filteredRules();
  document.getElementById('ruleCount').textContent =
    '共 ' + D.rules.length + ' 条 · 当前显示 ' + list.length + ' 条';

  if (!list.length) {
    document.getElementById('ruleTable').innerHTML = '<div class="empty">暂无规则。可在上方批量添加，或到页面悬浮面板一键添加。</div>';
    return;
  }

  var siteOpts = D.sites.map(function (s) { return s.pattern; });

  var canDrag = list.length === D.rules.length;   // 有筛选时顺序不可拖（避免歧义）
  var html = '<table><thead><tr>' +
    '<th style="width:26px" title="拖动排序">⠿</th>' +
    '<th style="width:40px">启用</th><th style="width:70px">类型</th><th>名称</th>' +
    '<th style="width:96px">动作</th><th style="width:74px">匹配</th><th style="width:100px">作用范围</th>' +
    '<th style="width:60px">颜色</th><th style="width:74px">有效期</th><th style="width:46px">命中</th><th style="width:132px">操作</th>' +
    '</tr></thead><tbody>';

  list.forEach(function (r) {
    var aliases = (r.aliases || []).filter(Boolean);
    var condChips = '';
    if (r.expr) condChips += '<span class="chip" style="background:rgba(124,92,255,.22);color:#c9bdff">表达式</span> ';
    if (r.ratingMin != null && r.ratingMin !== '') condChips += '<span class="chip" style="background:rgba(255,201,60,.18);color:#ffd970">评分≥' + esc(r.ratingMin) + '</span> ';
    if (r.dateFrom) condChips += '<span class="chip" style="background:rgba(0,229,255,.16);color:#8beeff">' + esc(r.dateFrom) + ' 起</span> ';
    if (r.dateTo) condChips += '<span class="chip" style="background:rgba(0,229,255,.16);color:#8beeff">至 ' + esc(r.dateTo) + '</span> ';
    var isTemp = !!(r.expiresAt && Number(r.expiresAt) > 0);
    var tempDead = isTemp && Date.now() >= Number(r.expiresAt);
    html += '<tr class="' + (r.enabled ? '' : 'off') + '" data-id="' + r.id + '"' + (canDrag ? ' draggable="true"' : '') + '>' +
      '<td class="dgh" title="拖动排序">⠿</td>' +
      '<td><input type="checkbox" data-f="enabled" ' + (r.enabled ? 'checked' : '') + '></td>' +
      '<td><span class="chip type">' + (TYPE_LABEL[r.type] || r.type) + '</span></td>' +
      '<td><span class="val">' + esc(r.value || (r.expr ? '（纯表达式规则）' : '')) + '</span>' +
      (r.expr ? '<br><span class="alias">⚙ ' + esc(r.expr) + '</span>' : '') +
      (aliases.length ? '<br><span class="alias">' + esc(aliases.join(' / ')) + '</span>' : '') +
      ((r.sites && r.sites.length) ? '<br><span class="alias">限定站点：' + esc(r.sites.join(', ')) + '</span>' : '') +
      (groupName(r.groupId) ? '<br><span class="alias">分组：' + esc(groupName(r.groupId)) + '</span>' : '') +
      (condChips ? '<br>' + condChips : '') +
      '</td>' +
      '<td><select data-f="action">' +
      opt('block', '屏蔽', r.action) + opt('favorite', '收藏', r.action) + opt('highlight', '高亮', r.action) +
      '</select></td>' +
      '<td><select data-f="match">' +
      opt('contains', '包含', r.match) + opt('exact', '精确', r.match) + opt('regex', '正则', r.match) +
      '</select></td>' +
      '<td><select data-f="scope">' +
      opt('all', '整卡文本', r.scope) + opt('actress', '仅女优', r.scope) + opt('tag', '仅标签', r.scope) +
      opt('maker', '仅片商', r.scope) + opt('series', '仅系列', r.scope) + opt('director', '仅导演', r.scope) +
      opt('title', '标题/番号', r.scope) +
      '</select></td>' +
      '<td><input type="color" data-f="color" value="' + esc(r.color || '#00e5ff') + '" style="width:34px;height:24px;padding:0;border:0;background:none"></td>' +
      '<td>' + (isTemp
        ? '<span class="chip" style="background:' + (tempDead ? 'rgba(255,77,109,.2);color:#ffb3c1' : 'rgba(255,159,28,.18);color:#ffd08a') + '" title="' +
          esc(new Date(r.expiresAt).toLocaleString('zh-CN')) + '">' + (tempDead ? '已过期' : fmtLeft(r.expiresAt)) + '</span>'
        : '<span class="alias">永久</span>') + '</td>' +
      '<td>' + (r.hits || 0) + (r.lastHit ? '<br><span class="alias" title="' + esc(new Date(r.lastHit).toLocaleString('zh-CN')) + '">' + esc(relTime(r.lastHit)) + '</span>' : '') + '</td>' +
      '<td><button class="mini" data-act="up" title="上移（提高优先级）">↑</button>' +
      '<button class="mini" data-act="down" title="下移（降低优先级）">↓</button> ' +
      '<button class="mini" data-act="edit">✎</button> <button class="mini danger" data-act="del">删除</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('ruleTable').innerHTML = html;

  document.getElementById('ruleTable').querySelectorAll('tr[data-id]').forEach(function (tr) {
    var id = tr.dataset.id;
    tr.addEventListener('change', function (e) {
      var f = e.target.dataset.f; if (!f) return;
      var r = D.rules.filter(function (x) { return x.id === id; })[0]; if (!r) return;
      r[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      save().then(renderRules);
    });
    tr.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var r = D.rules.filter(function (x) { return x.id === id; })[0]; if (!r) return;
      if (b.dataset.act === 'del') {
        pushUndo();
        D.rules = D.rules.filter(function (x) { return x.id !== id; });
        save().then(renderRules);
      } else if (b.dataset.act === 'up' || b.dataset.act === 'down') {
        moveRule(id, b.dataset.act === 'up' ? -1 : 1);
      } else if (b.dataset.act === 'edit') {
        var next = tr.nextElementSibling;
        if (next && next.classList.contains('editrow')) { next.remove(); return; }
        var er = document.createElement('tr');
        er.className = 'editrow';
        er.innerHTML = '<td colspan="10"><div class="grid">' +
          '<span>名称</span><input type="text" data-e="value" value="' + esc(r.value) + '" style="width:150px">' +
          '<span>别名（逗号分隔）</span><input type="text" data-e="aliases" value="' + esc((r.aliases || []).join(',')) + '" style="width:220px">' +
          '<span>站点限定</span><select data-e="sites">' + siteOpts.map(function (p) {
            return '<option value="' + esc(p) + '"' + ((r.sites || []).indexOf(p) !== -1 ? ' selected' : '') + '>' + esc(p) + '</option>';
          }).join('') + '</select>' +
          '<span>分组</span><select data-e="groupId"><option value="">未分组</option>' + (D.groups || []).map(function (g) {
            return '<option value="' + esc(g.id) + '"' + (r.groupId === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>';
          }).join('') + '</select>' +
          '<span>评分 ≥</span><input type="number" data-e="ratingMin" min="0" max="10" step="0.1" value="' + esc(r.ratingMin == null ? '' : r.ratingMin) + '" style="width:64px" placeholder="不限">' +
          '<span>发行日 ≥</span><input type="date" data-e="dateFrom" value="' + esc(r.dateFrom || '') + '">' +
          '<span>≤</span><input type="date" data-e="dateTo" value="' + esc(r.dateTo || '') + '">' +
          '<span>有效期至</span><input type="date" data-e="expiresOn" value="' +
          esc(r.expiresAt ? new Date(Number(r.expiresAt)).toISOString().slice(0, 10) : '') + '" title="留空 = 永久生效">' +
          '<button class="mini" data-act="clearExp">设为永久</button>' +
          '<button class="mini" data-act="clearSites">不限站点</button>' +
          '<span style="flex-basis:100%"></span>' +
          '<span>条件表达式</span><input type="text" data-e="expr" value="' + esc(r.expr || '') +
          '" style="flex:1;min-width:340px" placeholder="高级：rating &gt;= 4 &amp;&amp; date &gt;= 2023-01-01（填了就忽略名称/匹配/作用范围）">' +
          '<button class="mini" data-act="testExpr">测试</button>' +
          '<span class="alias" data-e="exprHint"></span>' +
          '<button class="mini primary" data-act="saveEdit">保存</button>' +
          '</div></td>';
        tr.parentNode.insertBefore(er, tr.nextSibling);
        er.addEventListener('click', function (ev) {
          var bb = ev.target.closest('button'); if (!bb) return;
          if (bb.dataset.act === 'saveEdit') {
            pushUndo();
            r.value = er.querySelector('[data-e=value]').value.trim() || r.value;
            r.aliases = er.querySelector('[data-e=aliases]').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
            var sel = er.querySelector('[data-e=sites]');
            r.sites = Array.from(sel.selectedOptions).map(function (o) { return o.value; });
            r.groupId = er.querySelector('[data-e=groupId]').value || '';
            var rmin = er.querySelector('[data-e=ratingMin]').value;
            r.ratingMin = (rmin === '' || rmin == null) ? '' : Number(rmin);
            r.dateFrom = er.querySelector('[data-e=dateFrom]').value || '';
            r.dateTo = er.querySelector('[data-e=dateTo]').value || '';
            r.expr = er.querySelector('[data-e=expr]').value.trim();
            // 有效期：日期输入是本地日历日，取当天 23:59:59 到期，避免"选到今天就已经过期"
            var eo = er.querySelector('[data-e=expiresOn]').value;
            r.expiresAt = eo ? (new Date(eo + 'T23:59:59').getTime() || 0) : 0;
            save().then(renderRules);
          } else if (bb.dataset.act === 'clearExp') {
            r.expiresAt = 0;
            er.querySelector('[data-e=expiresOn]').value = '';
            save().then(renderRules);
          } else if (bb.dataset.act === 'clearSites') {
            r.sites = []; save().then(renderRules);
          } else if (bb.dataset.act === 'testExpr') {
            // 就地测语法：写错的括号/正则立刻可见，不用回到页面上才发现规则没生效
            var hint = er.querySelector('[data-e=exprHint]');
            var src = er.querySelector('[data-e=expr]').value.trim();
            if (!EXPR_ENGINE) { hint.textContent = '⚠️ expr.js 未加载'; hint.style.color = '#ffb3c1'; return; }
            if (!src) { hint.textContent = '留空 = 用上面的名称做普通匹配'; hint.style.color = ''; return; }
            var c = EXPR_ENGINE.check(src);
            hint.textContent = c.ok ? '✅ 语法正确' : ('❌ ' + c.err);
            hint.style.color = c.ok ? '#7ee0a5' : '#ffb3c1';
          }
        });
      }

      /* 拖动排序：只在无筛选时启用，避免"在子集里排全量"的歧义 */
      if (canDrag) {
        tr.addEventListener('dragstart', function (ev) {
          dragId = id;
          tr.classList.add('dragging');
          try { ev.dataTransfer.setData('text/plain', id); ev.dataTransfer.effectAllowed = 'move'; } catch (er) { }
        });
        tr.addEventListener('dragend', function () { tr.classList.remove('dragging'); dragId = null; });
        tr.addEventListener('dragover', function (ev) {
          if (dragId && dragId !== id) { ev.preventDefault(); tr.classList.add('dragover'); }
        });
        tr.addEventListener('dragleave', function () { tr.classList.remove('dragover'); });
        tr.addEventListener('drop', function (ev) {
          ev.preventDefault(); tr.classList.remove('dragover');
          if (!dragId || dragId === id) return;
          var from = D.rules.findIndex(function (x) { return x.id === dragId; });
          var to = D.rules.findIndex(function (x) { return x.id === id; });
          if (from < 0 || to < 0) return;
          pushUndo();
          var moved = D.rules.splice(from, 1)[0];
          D.rules.splice(to, 0, moved);
          dragId = null;
          save().then(renderRules);
        });
      }
    });
  });
}

/* 上移 / 下移规则（改变数组顺序 = 改变优先级） */
function moveRule(id, delta) {
  var i = D.rules.findIndex(function (x) { return x.id === id; });
  if (i < 0) return;
  var j = i + delta;
  if (j < 0 || j >= D.rules.length) return;
  pushUndo();
  var t = D.rules[i]; D.rules[i] = D.rules[j]; D.rules[j] = t;
  save().then(renderRules);
}

function opt(v, label, cur) {
  return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + label + '</option>';
}
function relTime(ts) {
  if (!ts) return '';
  var s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return new Date(ts).toLocaleDateString('zh-CN');
}
// 剩余有效期：到期时间 → 「3 天」「5 小时」这种短标签
function fmtLeft(ts) {
  var left = Number(ts) - Date.now();
  if (left <= 0) return '已过期';
  var d = Math.floor(left / 864e5);
  if (d >= 1) return d + ' 天';
  var h = Math.floor(left / 36e5);
  if (h >= 1) return h + ' 小时';
  return Math.max(1, Math.floor(left / 6e4)) + ' 分钟';
}
function groupName(id) {
  if (!id) return '';
  for (var i = 0; i < (D.groups || []).length; i++) if (D.groups[i].id === id) return D.groups[i].name;
  return '';
}

/* ---------------- 批量添加 ---------------- */
document.getElementById('bulkAdd').addEventListener('click', function () {
  pushUndo();
  var raw = document.getElementById('bulk').value || '';
  var type = document.getElementById('bType').value;
  var action = document.getElementById('bAction').value;
  var color = D.settings.hlColor;
  var lines = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  var n = 0;
  lines.forEach(function (line) {
    var parts = line.split('|');
    var value = parts[0].trim();
    if (!value) return;
    var aliases = parts[1] ? parts[1].split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    var exist = null;
    for (var i = 0; i < D.rules.length; i++) {
      if (D.rules[i].type === type && String(D.rules[i].value).toLowerCase() === value.toLowerCase()) { exist = D.rules[i]; break; }
    }
    var scope = SCOPE_OF[type] || 'all';
    if (exist) { exist.action = action; exist.enabled = true; exist.color = color; if (aliases.length) exist.aliases = aliases; }
    else {
      D.rules.push({
        id: uid(), type: type, value: value, aliases: aliases, action: action,
        match: 'contains', scope: scope, color: color, sites: [], enabled: true, hits: 0, createdAt: Date.now()
      });
    }
    n++;
  });
  document.getElementById('bulk').value = '';
  save().then(renderRules);
});

['search', 'fType', 'fAction'].forEach(function (id) {
  document.getElementById(id).addEventListener('input', renderRules);
  document.getElementById(id).addEventListener('change', renderRules);
});

document.getElementById('delFiltered').addEventListener('click', function () {
  var list = filteredRules();
  if (!list.length) return;
  if (!confirm('确定删除当前筛选出的 ' + list.length + ' 条规则？')) return;
  var ids = {};
  list.forEach(function (r) { ids[r.id] = 1; });
  pushUndo();
  D.rules = D.rules.filter(function (r) { return !ids[r.id]; });
  save().then(renderRules);
});

/* ---------------- 站点 ---------------- */
function renderSites() {
  if (!D.sites.length) {
    document.getElementById('siteTable').innerHTML = '<div class="empty">还没有站点，添加一个吧。</div>';
    return;
  }
  var html = '<table><thead><tr><th style="width:40px">启用</th><th>匹配规则</th><th style="width:150px">备注</th>' +
    '<th style="width:190px">卡片选择器</th><th style="width:60px">操作</th></tr></thead><tbody>';
  D.sites.forEach(function (s) {
    html += '<tr data-id="' + esc(s.id) + '" class="' + (s.enabled ? '' : 'off') + '">' +
      '<td><input type="checkbox" data-f="enabled" ' + (s.enabled ? 'checked' : '') + '></td>' +
      '<td><input type="text" data-f="pattern" value="' + esc(s.pattern) + '" style="width:100%"></td>' +
      '<td><input type="text" data-f="note" value="' + esc(s.note || '') + '" style="width:100%"></td>' +
      '<td><input type="text" data-f="selector" value="' + esc(s.selector || '') + '" placeholder="留空自动识别" style="width:100%"></td>' +
      '<td><button class="mini danger" data-act="del">删除</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('siteTable').innerHTML = html;

  document.getElementById('siteTable').querySelectorAll('tr[data-id]').forEach(function (tr) {
    var id = tr.dataset.id;
    tr.addEventListener('change', function (e) {
      var f = e.target.dataset.f; if (!f) return;
      var s = D.sites.filter(function (x) { return x.id === id; })[0]; if (!s) return;
      s[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
      save();
    });
    tr.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.dataset.act !== 'del') return;
      D.sites = D.sites.filter(function (x) { return x.id !== id; });
      save().then(renderSites);
    });
  });
}

document.getElementById('sAdd').addEventListener('click', function () {
  var p = (document.getElementById('sPattern').value || '').trim();
  if (!p) { alert('请填写匹配规则，例如 *://*.example.com/*'); return; }
  D.sites.push({
    id: 's_' + Date.now().toString(36),
    pattern: p,
    note: (document.getElementById('sNote').value || '').trim(),
    selector: (document.getElementById('sSel').value || '').trim(),
    enabled: true
  });
  document.getElementById('sPattern').value = '';
  document.getElementById('sNote').value = '';
  document.getElementById('sSel').value = '';
  save().then(renderSites);
});

/* ---------------- 设置 ---------------- */
function renderSwitches() {
  var box = document.getElementById('switches');
  box.innerHTML = SWITCHES.map(function (s) {
    return '<label class="sw' + (D.settings[s[0]] ? ' on' : '') + '"><input type="checkbox" data-k="' + s[0] + '"' +
      (D.settings[s[0]] ? ' checked' : '') + '>' + s[1] + '</label>';
  }).join('');
  box.querySelectorAll('input[data-k]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      D.settings[cb.dataset.k] = cb.checked;
      cb.parentElement.classList.toggle('on', cb.checked);
      save();
    });
  });
}

/* 屏蔽后显示方式：三档下拉。
   与 content.js 面板里的 cycleBd 按钮是同一份设置的两种入口，
   取值必须落在 BD_VALUES 内（content.js 的 BD_ORDER 顺序不同，那只是面板轮换顺序）。 */
var BD_VALUES = ['hide', 'placeholder', 'soft'];
function renderBdSel() {
  var sel = document.getElementById('bdSel');
  if (!sel) return;
  var cur = D.settings.blockDisplay;
  if (BD_VALUES.indexOf(cur) === -1) cur = 'placeholder';  // 老数据 / 脏值兜底
  sel.value = cur;
  sel.addEventListener('change', function () {
    if (BD_VALUES.indexOf(sel.value) === -1) return;
    D.settings.blockDisplay = sel.value;
    save().then(notifyBdChange);
  });
}
// 通知已打开的页面立即套用（没有 content script 的标签页会报 lastError，静默吞掉）
function notifyBdChange() {
  var v = D.settings.blockDisplay;
  try {
    chrome.tabs.query({}, function (tabs) {
      (tabs || []).forEach(function (t) {
        if (!t || !t.id) return;
        chrome.tabs.sendMessage(t.id, { type: 'sf-block-display-changed', value: v }, function () {
          void chrome.runtime.lastError;
        });
      });
    });
  } catch (e) { }
}

/* 番号站数量补足（需求 002 L2）。取值口径与 content.js 的 backfillTarget() 一致：
   'off' / 'same' / 正整数。这是全库唯一会联网的开关，默认 off。 */
var BF_VALUES = ['off', 'same', '6', '12', '24'];
function renderBfSel() {
  var sel = document.getElementById('bfSel');
  if (!sel) return;
  var cur = String(D.settings.backfill == null ? 'off' : D.settings.backfill);
  sel.value = (BF_VALUES.indexOf(cur) !== -1) ? cur : 'off';
  sel.addEventListener('change', function () {
    if (BF_VALUES.indexOf(sel.value) === -1) return;
    D.settings.backfill = sel.value;
    save().then(function () {
      if (sel.value !== 'off') {
        // 开这个开关等于允许联网，值得明确告知一次（而不是静默生效）
        var tip = document.getElementById('bfNote');
        if (tip) tip.textContent = '已开启。下次刷新番号站页面时会去下一页抓卡片填满空位。';
      }
    });
  });
}

function renderDots(targetId, current, onPick) {
  var box = document.getElementById(targetId);
  box.innerHTML = COLORS.map(function (c) {
    return '<span class="dot' + (c === current ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></span>';
  }).join('');
  box.querySelectorAll('.dot').forEach(function (d) {
    d.addEventListener('click', function () { onPick(d.dataset.c); });
  });
}

document.getElementById('resetBall').addEventListener('click', function () {
  D.settings.ball = { right: 24, bottom: 24 };
  save().then(function () { alert('已重置悬浮球位置，刷新页面生效。'); });
});

/* =====================================================================
 * 备份文件读写：明文 JSON + 可选口令加密
 * 加密格式（自描述，明文字段便于以后升级参数）：
 *   { fmt: 'sitefilter-enc', v: 1, iter: 250000, salt: b64, iv: b64, data: b64 }
 * 口令不进内存以外的地方，salt/iv 每次导出都重新随机。
 * ===================================================================== */
var ENC_FMT = 'sitefilter-enc';
var ENC_ITER = 250000;

function hasWebCrypto() {
  return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
}
function b64enc(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function b64dec(str) {
  var s = atob(String(str || ''));
  var b = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function deriveKey(pass, salt, iter) {
  var enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(pass), { name: 'PBKDF2' }, false, ['deriveKey'])
    .then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
}

function encryptBackup(obj, pass) {
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var plain = new TextEncoder().encode(JSON.stringify(obj));
  return deriveKey(pass, salt, ENC_ITER).then(function (key) {
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
  }).then(function (ct) {
    return {
      fmt: ENC_FMT, v: 1, iter: ENC_ITER, alg: 'PBKDF2-SHA256/AES-GCM',
      at: new Date().toISOString(),
      salt: b64enc(salt), iv: b64enc(iv), data: b64enc(ct)
    };
  });
}

function decryptBackup(wrap, pass) {
  if (!wrap || wrap.fmt !== ENC_FMT) return Promise.reject(new Error('不是加密备份'));
  var iter = Number(wrap.iter) || ENC_ITER;
  var salt = b64dec(wrap.salt), iv = b64dec(wrap.iv), ct = b64dec(wrap.data);
  return deriveKey(pass, salt, iter).then(function (key) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
  }).then(function (pt) {
    return JSON.parse(new TextDecoder().decode(pt));
  });
}

function isEncryptedBackup(o) {
  return !!(o && typeof o === 'object' && o.fmt === ENC_FMT && o.data);
}

// 触发一次下载
function downloadBlob(blob, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
}

function exportPlain() {
  downloadBlob(new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' }),
    'sitefilter-backup-' + new Date().toISOString().slice(0, 10) + '.json');
}

function exportEncrypted() {
  if (!hasWebCrypto()) { alert('当前环境不支持 WebCrypto，无法加密导出。可改用明文导出。'); return; }
  var p1 = prompt('设置一个导出密码（备份文件会用 AES-GCM 加密；密码丢了就无法恢复，请自行记牢）：');
  if (p1 == null) return;
  if (!p1) { alert('密码不能为空。'); return; }
  if (p1.length < 6) { alert('密码太短，至少 6 位。'); return; }
  var p2 = prompt('再输入一次确认：');
  if (p2 !== p1) { alert('两次输入的密码不一致，已取消。'); return; }
  var tip = document.getElementById('backupTip');
  encryptBackup(D, p1).then(function (wrap) {
    downloadBlob(new Blob([JSON.stringify(wrap, null, 2)], { type: 'application/json' }),
      'sitefilter-backup-enc-' + new Date().toISOString().slice(0, 10) + '.json');
    if (tip) tip.textContent = '已导出加密备份。请记牢密码 —— 扩展本身不保存密码，忘记后无法解密。';
  }).catch(function (e) {
    alert('加密导出失败：' + (e && e.message ? e.message : e));
  });
}

// 把导入对象合并/覆盖进 D（obj 已是解出来的普通数据对象）
function applyImport(obj) {
  var mode = confirm('确定导入？点「确定」= 合并追加；点「取消」= 覆盖现有数据。');
  if (mode) {
    var seen = {};
    D.rules.forEach(function (r) { seen[r.type + '|' + String(r.value).toLowerCase()] = 1; });
    (obj.rules || []).forEach(function (r) {
      var k = r.type + '|' + String(r.value).toLowerCase();
      if (!seen[k]) { r.id = r.id || uid(); D.rules.push(r); }
    });
    (obj.sites || []).forEach(function (s) {
      if (!D.sites.filter(function (x) { return x.pattern === s.pattern; }).length) D.sites.push(s);
    });
    D.seen = Object.assign({}, D.seen || {}, obj.seen || {});
    D.favCodes = Object.assign({}, D.favCodes || {}, obj.favCodes || {});
    D.discovered = Object.assign({}, D.discovered || {}, obj.discovered || {});
    D.groups = (obj.groups || []).concat(D.groups || []).filter(function (g, i, a) {
      return a.findIndex(function (x) { return x.id === g.id; }) === i;
    });
    D.statsLog = Object.assign({}, D.statsLog || {}, obj.statsLog || {});
    D.recSettings = Object.assign({}, D.recSettings || {}, obj.recSettings || {});
    D.recHistory = (obj.recHistory || []).concat(D.recHistory || []).filter(function (h, i, a) {
      return a.findIndex(function (x) { return x.name === h.name; }) === i;
    });
    D.dailyRecs = Object.assign({}, D.dailyRecs || {}, obj.dailyRecs || {});
    D.recFeedback = Object.assign({}, D.recFeedback || {}, obj.recFeedback || {});
    D.watchlist = Object.assign({}, D.watchlist || {}, obj.watchlist || {});
    D.cooc = Object.assign({}, D.cooc || {}, obj.cooc || {});
    D.similarRecs = Object.assign({}, D.similarRecs || {}, obj.similarRecs || {});
    D.recFeedbackDaily = Object.assign({}, D.recFeedbackDaily || {}, obj.recFeedbackDaily || {});
    D.peeks = Object.assign({}, D.peeks || {}, obj.peeks || {});
    D.shopMarks = Object.assign({}, D.shopMarks || {}, obj.shopMarks || {});
    D.dismissedLearn = Object.assign({}, D.dismissedLearn || {}, obj.dismissedLearn || {});
    D.expiredLog = (obj.expiredLog || []).concat(D.expiredLog || []).slice(-200);
    D.profiles = (obj.profiles || []).concat(D.profiles || []).filter(function (p, i, a) {
      return a.findIndex(function (x) { return x.id === p.id; }) === i;
    });
    D.errLog = (obj.errLog || []).concat(D.errLog || []).slice(-ERR_MAX);
  } else {
    D = {
      settings: Object.assign({}, DEFAULT_SETTINGS, obj.settings || {}),
      sites: obj.sites || [], rules: obj.rules || [], seen: obj.seen || {}, favCodes: obj.favCodes || {},
      discovered: obj.discovered || {}, groups: obj.groups || [], statsLog: obj.statsLog || {},
      recSettings: obj.recSettings || {}, recHistory: obj.recHistory || [], dailyRecs: obj.dailyRecs || {}, recFeedback: obj.recFeedback || {},
      watchlist: obj.watchlist || {}, cooc: obj.cooc || {}, similarRecs: obj.similarRecs || {}, recFeedbackDaily: obj.recFeedbackDaily || {},
      peeks: obj.peeks || {}, errLog: obj.errLog || [], shopMarks: obj.shopMarks || {},
      learned: obj.learned || {}, dismissedLearn: obj.dismissedLearn || {},
      profiles: obj.profiles || [], activeProfile: obj.activeProfile || '', expiredLog: obj.expiredLog || [],
      schemaVersion: obj.schemaVersion || SCHEMA_VERSION
    };
  }
  D = migrate(D);
  save().then(function () { renderAll(); alert('导入完成。'); });
}

/* ---------------- 导出按钮 ---------------- */
document.getElementById('expBtn').addEventListener('click', function () {
  if (!hasWebCrypto()) { exportPlain(); return; }
  var enc = confirm('要用密码加密这份备份吗？\n\n点「确定」= 加密导出（AES-GCM，适合放网盘）\n点「取消」= 明文导出（可读，方便手工改）');
  if (enc) exportEncrypted(); else exportPlain();
});
(function () {
  var b = document.getElementById('expEncBtn');
  if (b) b.addEventListener('click', exportEncrypted);
})();

/* ---------------- 导入 ---------------- */
document.getElementById('impBtn').addEventListener('click', function () {
  document.getElementById('impFile').click();
});
document.getElementById('impFile').addEventListener('change', function (e) {
  var f = e.target.files && e.target.files[0];
  if (!f) return;
  var fr = new FileReader();
  fr.onload = function () {
    var obj;
    try {
      obj = JSON.parse(fr.result);
    } catch (err) {
      alert('导入失败：不是有效的 JSON 文件。');
      e.target.value = '';
      return;
    }
    if (isEncryptedBackup(obj)) {
      if (!hasWebCrypto()) { alert('这份备份是加密的，但当前环境不支持 WebCrypto，无法解密。'); e.target.value = ''; return; }
      var pass = prompt('这份备份已加密，请输入导出时设置的密码：');
      if (pass == null) { e.target.value = ''; return; }
      decryptBackup(obj, pass).then(function (inner) {
        if (!inner || typeof inner !== 'object') throw new Error('内容异常');
        applyImport(inner);
      }).catch(function (err) {
        alert('解密失败：密码不对，或文件已损坏。');
      }).then(function () { e.target.value = ''; });
      return;
    }
    try {
      if (!obj || typeof obj !== 'object') throw new Error('bad');
      applyImport(obj);
    } catch (err) { alert('导入失败：不是有效的 JSON 备份文件。'); }
    e.target.value = '';
  };
  fr.readAsText(f);
});


document.getElementById('clearSeen').addEventListener('click', function () {
  if (!confirm('清空全部「已看」记录？')) return;
  D.seen = {}; save().then(renderAll);
});
document.getElementById('clearAll').addEventListener('click', function () {
  if (!confirm('清空全部数据（规则 / 站点 / 已看 / 发现库 / 番号收藏 / 待看）？建议先导出备份。')) return;
  if (!confirm('再确认一次：此操作不可撤销。')) return;
  D = {
    schemaVersion: SCHEMA_VERSION,
    settings: Object.assign({}, DEFAULT_SETTINGS), sites: [], rules: [], seen: {}, favCodes: {}, discovered: {}, groups: [],
    statsLog: {}, recSettings: {}, recHistory: [], dailyRecs: {}, recFeedback: {}, watchlist: {}, cooc: {}, similarRecs: {}, recFeedbackDaily: {}, peeks: {}, errLog: [],
    learned: {}, dismissedLearn: {}, profiles: [], activeProfile: '', expiredLog: []
  };
  undoStack = [];
  save().then(renderAll);
});

/* ---------------- 番号收藏夹 ---------------- */
function renderFavCodes() {
  var all = Object.keys(D.favCodes || {});
  var q = (document.getElementById('fcSearch').value || '').trim().toLowerCase();
  var ff = (document.getElementById('fcFilter') || {}).value || 'all';
  var keys = all.filter(function (c) {
    if (ff === 'seen' && !D.seen[c]) return false;
    if (ff === 'unseen' && D.seen[c]) return false;
    if (!q) return true;
    var it = D.favCodes[c] || {};
    return c.toLowerCase().indexOf(q) !== -1 || String(it.t || '').toLowerCase().indexOf(q) !== -1;
  }).sort().reverse();

  var seenAll = all.filter(function (c) { return !!D.seen[c]; }).length;
  document.getElementById('fcCount').textContent =
    '共 ' + all.length + ' 部 · 已看 ' + seenAll + ' / 未看 ' + (all.length - seenAll) + ' · 当前显示 ' + keys.length + ' 部';

  if (!keys.length) {
    document.getElementById('fcTable').innerHTML = '<div class="empty">没有符合条件的番号。</div>';
    return;
  }
  var html = '<table><thead><tr><th style="width:130px">番号</th><th>标题</th>' +
    '<th style="width:120px">来源站点</th><th style="width:130px">收藏时间</th><th style="width:110px">操作</th></tr></thead><tbody>';
  keys.forEach(function (c) {
    var it = D.favCodes[c] || {};
    var dt = it.at ? new Date(it.at).toLocaleString('zh-CN') : '-';
    html += '<tr data-c="' + esc(c) + '">' +
      '<td><span class="val">' + esc(c) + '</span>' + (D.seen[c] ? ' <span class="alias">已看</span>' : '') + '</td>' +
      '<td>' + (it.u ? '<a href="' + esc(it.u) + '" target="_blank" style="color:#8beeff">' + esc(it.t || '(无标题)') + '</a>' : esc(it.t || '(无标题)')) + '</td>' +
      '<td>' + esc(it.s || '-') + '</td>' +
      '<td>' + esc(dt) + '</td>' +
      '<td><button class="mini" data-act="copy">复制番号</button> ' +
      '<button class="mini danger" data-act="del">删除</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('fcTable').innerHTML = html;

  document.getElementById('fcTable').querySelectorAll('tr[data-c]').forEach(function (tr) {
    var c = tr.dataset.c;
    tr.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'del') {
        delete D.favCodes[c];
        save().then(renderFavCodes);
      } else if (b.dataset.act === 'copy') {
        var ta = document.createElement('textarea');
        ta.value = c; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (err) { }
        ta.remove();
        b.textContent = '已复制';
        setTimeout(function () { b.textContent = '复制番号'; }, 1200);
      }
    });
  });
}

document.getElementById('fcSearch').addEventListener('input', renderFavCodes);
if (document.getElementById('fcFilter')) {
  document.getElementById('fcFilter').addEventListener('change', renderFavCodes);
}

/* 导出为 Markdown 片单 / CSV */
function favCodeRows() {
  var q = (document.getElementById('fcSearch').value || '').trim().toLowerCase();
  var ff = (document.getElementById('fcFilter') || {}).value || 'all';
  return Object.keys(D.favCodes || {}).filter(function (c) {
    if (ff === 'seen' && !D.seen[c]) return false;
    if (ff === 'unseen' && D.seen[c]) return false;
    if (!q) return true;
    var it = D.favCodes[c] || {};
    return c.toLowerCase().indexOf(q) !== -1 || String(it.t || '').toLowerCase().indexOf(q) !== -1;
  }).sort();
}
function favCodeDownload(text, name, mime) {
  var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
}
document.getElementById('fcMd').addEventListener('click', function () {
  var keys = favCodeRows();
  if (!keys.length) { alert('当前没有可导出的番号。'); return; }
  var lines = ['# SiteFilter 番号片单', '', '导出时间：' + new Date().toLocaleString('zh-CN'), '共 ' + keys.length + ' 部', ''];
  keys.forEach(function (c) {
    var it = D.favCodes[c] || {};
    var t = it.t ? ' ' + it.t : '';
    var link = it.u ? ' — ' + it.u : '';
    lines.push('- **' + c + '**' + t + (D.seen[c] ? ' `已看`' : '') + link);
  });
  favCodeDownload(lines.join('\n'), 'sitefilter-favcodes-' + new Date().toISOString().slice(0, 10) + '.md', 'text/markdown;charset=utf-8');
});
document.getElementById('fcCsv').addEventListener('click', function () {
  var keys = favCodeRows();
  if (!keys.length) { alert('当前没有可导出的番号。'); return; }
  function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  var lines = ['番号,标题,链接,来源站点,收藏时间,是否已看'];
  keys.forEach(function (c) {
    var it = D.favCodes[c] || {};
    lines.push([q(c), q(it.t || ''), q(it.u || ''), q(it.s || ''), q(it.at ? new Date(it.at).toISOString() : ''), q(D.seen[c] ? '已看' : '未看')].join(','));
  });
  favCodeDownload('\ufeff' + lines.join('\r\n'), 'sitefilter-favcodes-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv;charset=utf-8');
});

document.getElementById('fcAdd').addEventListener('click', function () {
  var v = prompt('输入番号（一次一个，例如 ABC-123）；批量请到「规则管理」用批量添加：');
  if (!v) return;
  var code = v.trim().toUpperCase();
  if (!code) return;
  D.favCodes = D.favCodes || {};
  D.favCodes[code] = { t: '', u: '', s: '手动添加', at: Date.now() };
  save().then(renderFavCodes);
});
document.getElementById('fcCopy').addEventListener('click', function () {
  var keys = Object.keys(D.favCodes || {});
  if (!keys.length) return;
  var ta = document.createElement('textarea');
  ta.value = keys.join('\n'); document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) { }
  ta.remove();
  alert('已复制 ' + keys.length + ' 个番号到剪贴板。');
});
document.getElementById('fcClear').addEventListener('click', function () {
  if (!confirm('清空番号收藏夹？')) return;
  D.favCodes = {};
  save().then(renderFavCodes);
});

/* ---------------- 发现 & 推荐 ---------------- */
function discTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function findRuleInD(value, type) {
  for (var i = 0; i < D.rules.length; i++) {
    if (D.rules[i].type === type && String(D.rules[i].value).toLowerCase() === String(value).toLowerCase()) return D.rules[i];
  }
  return null;
}
function addDiscRule(value, type, action) {
  value = (value || '').trim(); if (!value) return;
  var exist = findRuleInD(value, type);
  var scope = SCOPE_OF[type] || 'all';
  if (exist) { exist.action = action; exist.enabled = true; }
  else {
    D.rules.push({
      id: uid(), type: type, value: value, aliases: [], action: action,
      match: 'contains', scope: scope, color: D.settings.hlColor, sites: [], enabled: true, hits: 0, createdAt: Date.now()
    });
  }
  save().then(function () { renderDisc(); renderRules(); });
}
function renderDisc() {
  var disc = D.discovered || {};
  var keys = Object.keys(disc);
  var today = discTodayStr();
  var now = Date.now();
  var todayN = 0, newN = 0, pending = 0;
  var arr = [];
  keys.forEach(function (k) {
    var d = disc[k]; if (!d || !d.v) return;
    var ruled = !!findRuleInD(d.v, d.type);
    if (!ruled) pending++;
    var isNew = (now - (d.first || 0)) < 7 * 864e5;
    var fd = d.first ? new Date(d.first) : null;
    var isToday = fd && (fd.getFullYear() + '-' + (fd.getMonth() + 1) + '-' + fd.getDate()) === today;
    if (isNew) newN++; if (isToday) todayN++;
    d._isNew = isNew; d._isToday = isToday; d._ruled = ruled;
    arr.push(d);
  });
  document.getElementById('discSummary').textContent =
    '今日新发现 ' + todayN + ' · 7 天新面孔 ' + newN + ' · 待标记 ' + pending;
  document.getElementById('discCount').textContent = '共 ' + arr.length + ' 条';

  var q = (document.getElementById('discSearch').value || '').trim().toLowerCase();
  var ft = document.getElementById('discType').value;
  var ff = document.getElementById('discFilter').value;
  var list = arr.filter(function (d) {
    if (ft && d.type !== ft) return false;
    if (ff === 'new' && !d._isNew) return false;
    if (ff === 'today' && !d._isToday) return false;
    if (q && d.v.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  list.sort(function (a, b) { return ((b._isNew ? 1 : 0) - (a._isNew ? 1 : 0)) || (b.n - a.n); });

  if (!list.length) {
    document.getElementById('discTable').innerHTML = '<div class="empty">没有符合条件的发现记录。浏览几页监管站点后会自动积累。</div>';
    return;
  }
  var html = '<table><thead><tr><th style="width:50px">类型</th><th>名称</th><th style="width:48px">次数</th>' +
    '<th style="width:86px">首见</th><th style="width:46px">新</th><th style="width:176px">操作</th></tr></thead><tbody>';
  list.slice(0, 300).forEach(function (d) {
    html += '<tr' + (d._ruled ? ' class="off"' : '') + '>' +
      '<td><span class="chip type">' + esc(TYPE_LABEL[d.type] || d.type) + '</span></td>' +
      '<td><span class="val">' + esc(d.v) + '</span>' + (d._ruled ? ' <span class="alias">已建规则</span>' : '') + '</td>' +
      '<td>' + d.n + '</td>' +
      '<td>' + (d.first ? new Date(d.first).toLocaleDateString() : '-') + '</td>' +
      '<td>' + (d._isNew ? '<span class="chip" style="background:rgba(255,77,109,.2);color:#ffb3c1">NEW</span>' : '') + '</td>' +
      '<td><button class="mini" data-dact="block" data-v="' + esc(d.v) + '" data-t="' + d.type + '">屏蔽</button> ' +
      '<button class="mini" data-dact="favorite" data-v="' + esc(d.v) + '" data-t="' + d.type + '">收藏</button> ' +
      '<button class="mini" data-dact="highlight" data-v="' + esc(d.v) + '" data-t="' + d.type + '">高亮</button> ' +
      '<button class="mini danger" data-dact="del" data-v="' + esc(d.v) + '" data-t="' + d.type + '">删除</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('discTable').innerHTML = html;
}

['discSearch', 'discType', 'discFilter'].forEach(function (id) {
  document.getElementById(id).addEventListener('input', renderDisc);
  document.getElementById(id).addEventListener('change', renderDisc);
});
document.getElementById('discTable').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  if (!b.dataset.dact) return;
  if (b.dataset.dact === 'del') {
    var key = b.dataset.t + '|' + b.dataset.v;
    if (D.discovered[key]) { delete D.discovered[key]; save().then(function () { renderDisc(); renderDiscStats(); }); }
    return;
  }
  addDiscRule(b.dataset.v, b.dataset.t, b.dataset.dact);
});

/* ---------------- 发现库维护 ---------------- */
function discStatsText() {
  var disc = D.discovered || {};
  var byType = {}, bySite = {}, dead = 0;
  var cut180 = Date.now() - 180 * 864e5;
  Object.keys(disc).forEach(function (k) {
    var e = disc[k]; if (!e) return;
    byType[e.type] = (byType[e.type] || 0) + 1;
    var s = e.site || '(未知)';
    bySite[s] = (bySite[s] || 0) + 1;
    if ((e.last || e.first || 0) < cut180) dead++;
  });
  var tparts = Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; })
    .map(function (t) { return (TYPE_LABEL[t] || t) + ' ' + byType[t]; });
  var sparts = Object.keys(bySite).sort(function (a, b) { return bySite[b] - bySite[a]; }).slice(0, 5)
    .map(function (s) { return esc(s) + ' ' + bySite[s]; });
  return '共 <b>' + Object.keys(disc).length + '</b> 条（180 天未再出现 <b>' + dead + '</b> 条）<br>' +
    '按类型：' + (tparts.join(' · ') || '—') + '<br>' +
    '按站点：' + (sparts.join(' · ') || '—');
}
function renderDiscStats() {
  var box = document.getElementById('discStats');
  if (box) box.innerHTML = discStatsText();
}
(function () {
  var btn = document.getElementById('discPrune');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var days = parseInt(document.getElementById('discPruneDays').value, 10) || 180;
    var cut = Date.now() - days * 864e5;
    var keep = {}, removed = 0;
    Object.keys(D.discovered || {}).forEach(function (k) {
      var e = D.discovered[k];
      if (!e || (e.last || e.first || 0) < cut) removed++;
      else keep[k] = e;
    });
    if (!removed) { alert('没有超过 ' + days + ' 天未再出现的条目，无需清理。'); return; }
    if (!confirm('将删除 ' + removed + ' 条超过 ' + days + ' 天未再出现的发现记录？（已建规则不受影响）')) return;
    D.discovered = keep;
    save().then(function () { renderDisc(); renderDiscStats(); alert('已清理 ' + removed + ' 条。'); });
  });
})();

/* 导出单文件 HTML 清单（离线可看、带头像缩略图，方便存档或分享给自己） */
function buildShareHtml() {
  var disc = D.discovered || {};
  var favs = D.favCodes || {};
  function imgOf(e) {
    if (e && e.avatar) return '<img src="' + esc(e.avatar) + '" loading="lazy" referrerpolicy="no-referrer" alt="">';
    return '<span class="ph">' + esc(String((e && e.v) || '?').slice(0, 1)) + '</span>';
  }
  function actresses() {
    return Object.keys(disc).filter(function (k) { return disc[k] && disc[k].type === 'actress'; })
      .map(function (k) { return disc[k]; })
      .sort(function (a, b) { return (b.n || 0) - (a.n || 0); });
  }
  var aHtml = actresses().slice(0, 300).map(function (e) {
    return '<div class="cd">' + '<a class="av" href="' + esc(e.href || '#') + '" target="_blank" rel="noopener">' + imgOf(e) +
      '</a><div class="nm">' + esc(e.v) + '</div><div class="mt">见过 ' + (e.n || 0) + ' 次' +
      (e.rating ? ' · ★' + esc(e.rating) : '') + '</div></div>';
  }).join('');
  var fHtml = Object.keys(favs).sort().map(function (c) {
    var it = favs[c] || {};
    return '<li><b>' + esc(c) + '</b> — ' + esc(it.t || '') + (it.u ? ' <a href="' + esc(it.u) + '" target="_blank" rel="noopener">打开</a>' : '') + '</li>';
  }).join('');
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>SiteFilter 清单 · ' + new Date().toLocaleDateString('zh-CN') + '</title>' +
    '<style>body{background:#12141c;color:#dfe4ef;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:0;padding:28px}' +
    'h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 12px;color:#8beeff}' +
    '.meta{color:#7a8399;font-size:12px;margin-bottom:8px}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px}' +
    '.cd{background:#1a1d26;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;padding-bottom:8px}' +
    '.av{display:block;height:132px;background:#0d0f15;text-align:center;text-decoration:none}' +
    '.av img{width:100%;height:132px;object-fit:cover;display:block}' +
    '.ph{display:flex;align-items:center;justify-content:center;height:132px;font-size:34px;color:#5d6580}' +
    '.nm{padding:7px 8px 0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.mt{padding:0 8px;color:#7a8399;font-size:11px}' +
    'ul{padding-left:18px}li{margin:3px 0}a{color:#8beeff}</style></head><body>' +
    '<h1>SiteFilter 清单</h1><div class="meta">导出时间：' + new Date().toLocaleString('zh-CN') +
    ' · 女优 ' + actresses().length + ' 位 · 番号收藏 ' + Object.keys(favs).length + ' 部</div>' +
    '<h2>女优（按出现次数）</h2><div class="grid">' + (aHtml || '<div class="meta">暂无</div>') + '</div>' +
    '<h2>番号收藏夹</h2><ul>' + (fHtml || '<li>暂无</li>') + '</ul>' +
    '</body></html>';
}
['discExportHtml', 'fcHtml'].forEach(function (id) {
  var b = document.getElementById(id);
  if (!b) return;
  b.addEventListener('click', function () {
    var blob = new Blob([buildShareHtml()], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sitefilter-list-' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  });
});
document.getElementById('discExport').addEventListener('click', function () {
  var data = { discovered: D.discovered || {}, exportedAt: Date.now() };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'sitefilter-discover.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
document.getElementById('discClear').addEventListener('click', function () {
  if (!confirm('清空发现库？已建立的规则不受影响。')) return;
  D.discovered = {};
  save().then(renderDisc);
});

/* ---------------- 规则分组 ---------------- */
function renderGroups() {
  var gs = D.groups || [];
  var box = document.getElementById('groupTable');
  if (!gs.length) {
    box.innerHTML = '<div class="empty">还没有分组。新建一个，例如「临时试试」，再把想临时试用的屏蔽规则归进去，不想看时一键关闭整组。</div>';
    return;
  }
  var counts = {};
  D.rules.forEach(function (r) { if (r.groupId) counts[r.groupId] = (counts[r.groupId] || 0) + 1; });
  var html = '<table><thead><tr><th style="width:40px">启用</th><th>分组名</th><th style="width:70px">规则数</th><th style="width:80px">操作</th></tr></thead><tbody>';
  gs.forEach(function (g) {
    var n = counts[g.id] || 0;
    html += '<tr class="' + (g.enabled === false ? 'off' : '') + '" data-id="' + esc(g.id) + '">' +
      '<td><input type="checkbox" data-g="enabled" ' + (g.enabled !== false ? 'checked' : '') + '></td>' +
      '<td><input type="text" data-g="name" value="' + esc(g.name) + '" style="width:100%"></td>' +
      '<td>' + n + '</td>' +
      '<td><button class="mini danger" data-gact="del">删除</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;
  box.querySelectorAll('tr[data-id]').forEach(function (tr) {
    var id = tr.dataset.id;
    tr.addEventListener('change', function (e) {
      var f = e.target.dataset.g; if (!f) return;
      var g = D.groups.filter(function (x) { return x.id === id; })[0]; if (!g) return;
      if (f === 'enabled') g.enabled = e.target.checked;
      else g.name = e.target.value.trim() || g.name;
      save().then(renderGroups);
    });
    tr.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.dataset.gact !== 'del') return;
      if (!confirm('删除该分组？组内规则会变为「未分组」（仍然生效）。')) return;
      pushUndo();
      D.groups = D.groups.filter(function (x) { return x.id !== id; });
      D.rules.forEach(function (r) { if (r.groupId === id) delete r.groupId; });
      save().then(function () { renderGroups(); renderRules(); });
    });
  });
}
document.getElementById('gAdd').addEventListener('click', function () {
  var n = (document.getElementById('gName').value || '').trim();
  if (!n) { alert('请输入分组名'); return; }
  D.groups = D.groups || [];
  pushUndo();
  D.groups.push({ id: 'g_' + Date.now().toString(36), name: n, enabled: true });
  document.getElementById('gName').value = '';
  save().then(renderGroups);
});

/* ---------------- 发现库一键生成黑名单 ---------------- */
['discBlockMaker', 'discBlockSeries', 'discBlockDirector'].forEach(function (id) {
  document.getElementById(id).addEventListener('click', function () {
    var type = id === 'discBlockMaker' ? 'maker' : (id === 'discBlockSeries' ? 'series' : 'director');
    var disc = D.discovered || {};
    var n = 0;
    Object.keys(disc).forEach(function (k) {
      var d = disc[k];
      if (d && d.type === type && d.v) { addDiscRule(d.v, type, 'block'); n++; }
    });
    if (!n) alert('发现库里还没有「' + (type === 'maker' ? '片商' : type === 'series' ? '系列' : '导演') + '」记录，先去监管站点浏览几页。');
    else { alert('已把 ' + n + ' 个' + (type === 'maker' ? '片商' : type === 'series' ? '系列' : '导演') + '加入屏蔽。'); renderDisc(); renderRules(); }
  });
});

/* ---------------- 正则测试器 ---------------- */
function updateRegexTest() {
  var pat = document.getElementById('reTest').value;
  var out = document.getElementById('reOut');
  if (!pat) { out.textContent = ''; return; }
  var re;
  try { re = new RegExp(pat, 'i'); }
  catch (e) { out.innerHTML = '<span style="color:#ffb3c1">正则语法错误：' + esc(e.message) + '</span>'; return; }
  var sample = document.getElementById('reSample').value;
  var lines = sample.split(/\r?\n/).filter(function (s) { return s.length; });
  if (!lines.length) { out.textContent = '在下方输入测试文本（每行一条）即可实时看到命中结果。'; return; }
  out.innerHTML = lines.map(function (l) {
    var m = l.match(re);
    if (m) return '<div style="color:#7ee2a8">✓ 命中：' + (m[0] ? esc(m[0]) : '(零宽匹配)') + '</div>';
    return '<div style="color:#6f7893">✗ 未命中：' + esc(l) + '</div>';
  }).join('');
}
document.getElementById('reTest').addEventListener('input', updateRegexTest);
document.getElementById('reSample').addEventListener('input', updateRegexTest);

/* ---------------- 数据看板 ---------------- */
function renderDashboard() {
  var log = D.statsLog || {};
  var now = new Date();
  var days = [], blocked = [], fav = [], hl = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(now); d.setDate(now.getDate() - i);
    var key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    var e = log[key] || {};
    days.push(key);
    blocked.push(e.blocked || 0);
    fav.push(e.fav || 0);
    hl.push(e.hl || 0);
  }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  var sB = sum(blocked), sF = sum(fav), sH = sum(hl);
  document.getElementById('dashSummary').innerHTML =
    '已记录 <b>' + Object.keys(log).length + '</b> 天数据 · 近 30 天：屏蔽 <b style="color:#ffb3c1">' + sB +
    '</b> · 收藏 <b style="color:#ffd970">' + sF + '</b> · 高亮 <b style="color:#8beeff">' + sH +
    '</b> 条 · 规则 ' + D.rules.length + ' 条 · 发现库 ' + Object.keys(D.discovered || {}).length + ' 条';

  // 堆叠柱：每天 = 屏蔽(红) + 收藏(金) + 高亮(青)
  var W = 900, H = 190, pad = 22, n = days.length;
  var totals = days.map(function (_, i) { return blocked[i] + fav[i] + hl[i]; });
  var max = Math.max.apply(null, totals.concat([1]));
  var bw = W / n - 2, usable = H - pad - 10;
  var COL = { b: '#ff4d6d', f: '#ffc93c', h: '#00e5ff' };
  var bars = days.map(function (k, i) {
    var x = pad + i * (W / n), acc = 0, out = '';
    [['b', blocked[i]], ['f', fav[i]], ['h', hl[i]]].forEach(function (seg) {
      var v = seg[1];
      if (!v) return;
      var hh = Math.max(1.5, Math.round(v / max * usable));
      var y = H - pad - acc - hh;
      acc += hh;
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) +
        '" fill="' + COL[seg[0]] + '" opacity="0.9"><title>' + k + '：屏蔽 ' + blocked[i] + ' · 收藏 ' + fav[i] + ' · 高亮 ' + hl[i] + '</title></rect>';
    });
    if (!acc) out += '<rect x="' + x.toFixed(1) + '" y="' + (H - pad - 2) + '" width="' + bw.toFixed(1) + '" height="2" rx="1" fill="rgba(255,255,255,.12)"></rect>';
    return out;
  }).join('');
  var lg = function (dx, col, label) {
    return '<rect x="' + (pad + dx) + '" y="6" width="10" height="10" rx="2" fill="' + col + '"></rect>' +
      '<text x="' + (pad + dx + 14) + '" y="15" font-size="11" fill="#c8cee0">' + label + '</text>';
  };
  var legend = '<g>' + lg(0, COL.b, '屏蔽') + lg(58, COL.f, '收藏') + lg(116, COL.h, '高亮') + '</g>';
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:rgba(255,255,255,.02);border-radius:8px">' +
    legend + bars + '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - 2) + '" y2="' + (H - pad) + '" stroke="rgba(255,255,255,.15)"/></svg>';
  document.getElementById('dashChart').innerHTML = svg;

  // 按维度汇总：各维度规则数与命中总量
  var box = document.getElementById('dashByType');
  if (box) {
    var byType = {};
    (D.rules || []).forEach(function (r) {
      var t = r.type || 'other';
      if (!byType[t]) byType[t] = { n: 0, hits: 0 };
      byType[t].n++;
      byType[t].hits += (r.hits || 0);
    });
    var keys = Object.keys(byType).sort(function (a, b) { return byType[b].hits - byType[a].hits; });
    if (!keys.length) {
      box.innerHTML = '<div class="empty">还没有任何规则。</div>';
    } else {
      var mx = Math.max.apply(null, keys.map(function (t) { return byType[t].hits; }).concat([1]));
      var t2 = '<table><thead><tr><th>维度</th><th style="width:70px">规则数</th><th style="width:70px">命中</th><th style="width:170px">命中强度</th></tr></thead><tbody>';
      keys.forEach(function (t) {
        var v = byType[t];
        var w = Math.round(v.hits / mx * 100);
        t2 += '<tr><td><span class="chip type">' + esc(TYPE_LABEL[t] || t) + '</span></td>' +
          '<td>' + v.n + '</td><td>' + v.hits + '</td>' +
          '<td><div style="height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden"><div style="width:' + w + '%;height:100%;background:#7c5cff"></div></div></td></tr>';
      });
      t2 += '</tbody></table>';
      box.innerHTML = t2;
    }
  }

  var top = D.rules.slice().filter(function (r) { return (r.hits || 0) > 0; })
    .sort(function (a, b) { return (b.hits || 0) - (a.hits || 0); }).slice(0, 10);
  if (!top.length) {
    document.getElementById('dashTop').innerHTML = '<div class="empty">暂无命中记录。规则生效并对卡片产生屏蔽 / 收藏 / 高亮后，这里会按命中次数排序。</div>';
  } else {
    var maxH = Math.max.apply(null, top.map(function (r) { return r.hits; }));
    var html = '<table><thead><tr><th>名称</th><th style="width:70px">类型</th><th style="width:60px">动作</th><th style="width:120px">命中</th><th style="width:90px">最近命中</th></tr></thead><tbody>';
    top.forEach(function (r) {
      var w = Math.round((r.hits / maxH) * 100);
      var act = r.action === 'block' ? '屏蔽' : (r.action === 'favorite' ? '收藏' : '高亮');
      html += '<tr><td><span class="val">' + esc(r.value) + '</span></td>' +
        '<td><span class="chip type">' + esc(TYPE_LABEL[r.type] || r.type) + '</span></td>' +
        '<td><span class="chip ' + r.action + '">' + act + '</span></td>' +
        '<td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden"><div style="width:' + w + '%;height:100%;background:#00e5ff"></div></div><span>' + r.hits + '</span></div></td>' +
        '<td><span class="alias" title="' + esc(r.lastHit ? new Date(r.lastHit).toLocaleString('zh-CN') : '从未命中') + '">' + esc(r.lastHit ? relTime(r.lastHit) : '—') + '</span></td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById('dashTop').innerHTML = html;
  }

  renderAdopt();
  renderDeadRules();
}

/* ---------------- 软屏蔽：放行记录清单（可查看 / 撤销） ---------------- */
function renderPeeks() {
  var box = document.getElementById('peekList');
  if (!box) return;
  var hours = Math.max(1, parseInt((D.settings || {}).peekHours, 10) || 24);
  var input = document.getElementById('peekHours');
  if (input && document.activeElement !== input) input.value = hours;
  var ttl = hours * 3600 * 1000;
  var now = Date.now();
  var all = D.peeks || {};
  var keys = Object.keys(all).filter(function (k) { return now - all[k] < ttl; })
    .sort(function (a, b) { return all[b] - all[a]; });
  var expired = Object.keys(all).length - keys.length;
  var cnt = document.getElementById('peekCount');
  if (cnt) cnt.innerHTML = '当前生效 <b style="color:#8beeff">' + keys.length + '</b> 条（放行时长 ' + hours +
    ' 小时，过期自动清理' + (expired > 0 ? '，已过期 ' + expired + ' 条' : '') + '）。';

  if (!keys.length) {
    box.innerHTML = '<div class="empty">暂无放行记录。开启软屏蔽后，点过「仍然查看」的番号会出现在这里。</div>';
    return;
  }
  var html = '<table><thead><tr><th>番号</th><th style="width:170px">放行时间</th><th style="width:120px">剩余</th><th style="width:70px"></th></tr></thead><tbody>';
  keys.forEach(function (c) {
    var left = ttl - (now - all[c]);
    var lh = Math.floor(left / 3600000), lm = Math.floor((left % 3600000) / 60000);
    html += '<tr data-peek="' + esc(c) + '">' +
      '<td><span class="val">' + esc(c) + '</span></td>' +
      '<td><span class="alias">' + new Date(all[c]).toLocaleString('zh-CN') + '</span></td>' +
      '<td><span class="alias">' + lh + ' 小时 ' + lm + ' 分</span></td>' +
      '<td><button class="mini" data-peekdel="' + esc(c) + '">撤销</button></td></tr>';
  });
  box.innerHTML = html + '</tbody></table>';
  Array.prototype.forEach.call(box.querySelectorAll('[data-peekdel]'), function (b) {
    b.addEventListener('click', function () {
      var c = b.getAttribute('data-peekdel');
      delete D.peeks[c];
      save().then(function () { renderPeeks(); });
    });
  });
}


/* 推荐采纳率曲线：每天 收藏 / (收藏 + 屏蔽 + 已看) */
function renderAdopt() {
  var box = document.getElementById('dashAdopt');
  if (!box) return;
  var fb = D.recFeedbackDaily || {};
  var now = new Date();
  var pts = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(now); d.setDate(now.getDate() - i);
    var key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    var e = fb[key];
    if (!e) { pts.push(null); continue; }
    var total = (e.faved || 0) + (e.blocked || 0) + (e.seen || 0);
    pts.push(total > 0 ? { r: e.faved / total, n: total } : null);
  }
  var valid = pts.filter(Boolean);
  if (!valid.length) {
    box.innerHTML = '<div class="empty">还没有推荐反馈数据。到 📅今日 推荐里点「收藏 / 屏蔽 / 我看过了」，这里就会画出采纳率曲线。</div>';
    return;
  }
  var avg = valid.reduce(function (a, b) { return a + b.r; }, 0) / valid.length;
  var W = 900, H = 150, pad = 26;
  var stepX = (W - pad * 2) / 29;
  function yOf(r) { return H - pad - r * (H - pad * 2); }
  var path = [], dots = [];
  pts.forEach(function (p, i) {
    if (!p) return;
    var x = pad + i * stepX, y = yOf(p.r);
    path.push((path.length ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1));
    dots.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="#7ee2a8"><title>采纳率 ' + Math.round(p.r * 100) + '%（样本 ' + p.n + '）</title></circle>');
  });
  var avgY = yOf(avg).toFixed(1);
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:rgba(255,255,255,.02);border-radius:8px">' +
    '<line x1="' + pad + '" y1="' + yOf(1).toFixed(1) + '" x2="' + (W - pad) + '" y2="' + yOf(1).toFixed(1) + '" stroke="rgba(255,255,255,.1)"/>' +
    '<line x1="' + pad + '" y1="' + yOf(0.5).toFixed(1) + '" x2="' + (W - pad) + '" y2="' + yOf(0.5).toFixed(1) + '" stroke="rgba(255,255,255,.1)" stroke-dasharray="4 4"/>' +
    '<line x1="' + pad + '" y1="' + avgY + '" x2="' + (W - pad) + '" y2="' + avgY + '" stroke="rgba(0,229,255,.5)" stroke-dasharray="3 3"><title>平均 ' + Math.round(avg * 100) + '%</title></line>' +
    '<path d="' + path.join(' ') + '" fill="none" stroke="#7ee2a8" stroke-width="2"/>' + dots.join('') +
    '<text x="' + pad + '" y="12" fill="#6f7893" font-size="11">100%</text>' +
    '<text x="' + pad + '" y="' + (H - 6) + '" fill="#6f7893" font-size="11">0%</text></svg>';
  box.innerHTML = svg + '<div class="tip">平均采纳率 <b style="color:#7ee2a8">' + Math.round(avg * 100) + '%</b>' +
    ' · 虚线为日均线 · 样本天数 ' + valid.length + '<br>' +
    '<span style="color:#5d6580">采纳率越高说明推荐越准；若长期偏低，可在「每日推荐」里调低对应权重或关掉自动调权。</span></div>';
}

/* 死规则：启用中、创建超过 7 天、从未命中 */
function renderDeadRules() {
  var box = document.getElementById('dashDead');
  if (!box) return;
  var now = Date.now();
  var dead = D.rules.filter(function (r) {
    if (r.enabled === false) return false;
    if ((r.hits || 0) > 0) return false;
    if (!r.createdAt) return (D.rules.length > 0) && false; // 无创建时间则不计入，避免误删老数据
    return (now - r.createdAt) > 7 * 864e5;
  });
  if (!dead.length) {
    box.innerHTML = '<div class="empty">没有发现长期 0 命中的启用规则。</div>';
    return;
  }
  var html = '<div class="tip">以下 <b>' + dead.length + '</b> 条规则启用中、创建超过 7 天但从未命中，可以考虑删除：</div>' +
    '<table><thead><tr><th>名称</th><th style="width:70px">类型</th><th style="width:60px">动作</th></tr></thead><tbody>';
  dead.slice(0, 40).forEach(function (r) {
    html += '<tr><td><span class="val">' + esc(r.value) + '</span></td>' +
      '<td><span class="chip type">' + esc(TYPE_LABEL[r.type] || r.type) + '</span></td>' +
      '<td><span class="chip ' + r.action + '">' + (r.action === 'block' ? '屏蔽' : r.action === 'favorite' ? '收藏' : '高亮') + '</span></td></tr>';
  });
  html += '</tbody></table><div class="grid" style="margin-top:8px"><button class="danger" id="delDead">删除这些死规则</button></div>';
  box.innerHTML = html;
  var b = document.getElementById('delDead');
  if (b) b.addEventListener('click', function () {
    if (!confirm('删除 ' + dead.length + ' 条从未命中的规则？')) return;
    pushUndo();
    var ids = {};
    dead.forEach(function (r) { ids[r.id] = 1; });
    D.rules = D.rules.filter(function (r) { return !ids[r.id]; });
    save().then(function () { renderAll(); });
  });
}

/* ---------------- 启动 ---------------- */
function pickColor(c) {
  D.settings.hlColor = c;
  save().then(renderColorDots);
}
function renderColorDots() {
  renderDots('hlDots', D.settings.hlColor, pickColor);
  renderDots('bDots', D.settings.hlColor, pickColor);
}

/* ---------------- 每日推荐设置 ---------------- */
function renderRec() {
  var rs = Object.assign({ enabled: true, max: 12, newMax: 6, minQuality: 0, windowDays: 14, excludeSeen: true, notify: true, dim: ['actress'], autoWeights: false, seenWorkRatio: 0.75, weights: { rating: 0.4, works: 0.25, pop: 0.2, recency: 0.15 } }, D.recSettings || {});
  document.getElementById('recOn').checked = rs.enabled !== false;
  document.getElementById('recNotify').checked = rs.notify !== false;
  document.getElementById('recExcludeSeen').checked = rs.excludeSeen !== false;
  document.getElementById('recSeenRatio').value = Math.round((rs.seenWorkRatio != null ? rs.seenWorkRatio : 0.75) * 100);
  document.getElementById('recAutoW').checked = !!rs.autoWeights;
  document.getElementById('recMax').value = rs.max;
  document.getElementById('recNew').value = rs.newMax;
  document.getElementById('recMin').value = rs.minQuality;
  document.getElementById('recWin').value = rs.windowDays;
  var dim = rs.dim && rs.dim.length ? rs.dim : ['actress'];
  document.getElementById('recDimA').checked = dim.indexOf('actress') !== -1;
  document.getElementById('recDimM').checked = dim.indexOf('maker') !== -1;
  document.getElementById('recDimS').checked = dim.indexOf('series') !== -1;
  var w = rs.weights || { rating: 0.4, works: 0.25, pop: 0.2, recency: 0.15 };
  document.getElementById('wRating').value = Math.round(w.rating * 100);
  document.getElementById('wWorks').value = Math.round(w.works * 100);
  document.getElementById('wPop').value = Math.round(w.pop * 100);
  document.getElementById('wRec').value = Math.round(w.recency * 100);
  updateWeightLabels();
  var t = new Date(); var day = t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate();
  var todays = (D.dailyRecs && D.dailyRecs[day]) || [];
  var hist = D.recHistory || [];
  document.getElementById('recTip').innerHTML = '今日已生成 <b style="color:#8beeff">' + todays.length + '</b> 位 · 推荐历史累计 <b style="color:#8beeff">' + hist.length + '</b> 条（近 ' + rs.windowDays + ' 天不重复）。';
}
function updateWeightLabels() {
  document.getElementById('wRatingV').textContent = document.getElementById('wRating').value;
  document.getElementById('wWorksV').textContent = document.getElementById('wWorks').value;
  document.getElementById('wPopV').textContent = document.getElementById('wPop').value;
  document.getElementById('wRecV').textContent = document.getElementById('wRec').value;
}
function saveRec(persist) {
  var dim = [];
  if (document.getElementById('recDimA').checked) dim.push('actress');
  if (document.getElementById('recDimM').checked) dim.push('maker');
  if (document.getElementById('recDimS').checked) dim.push('series');
  if (!dim.length) dim.push('actress');
  D.recSettings = {
    enabled: document.getElementById('recOn').checked,
    notify: document.getElementById('recNotify').checked,
    excludeSeen: document.getElementById('recExcludeSeen').checked,
    seenWorkRatio: Math.min(1, Math.max(0.5, (parseInt(document.getElementById('recSeenRatio').value, 10) || 75) / 100)),
    autoWeights: document.getElementById('recAutoW').checked,
    max: Math.max(1, parseInt(document.getElementById('recMax').value, 10) || 12),
    newMax: Math.max(0, parseInt(document.getElementById('recNew').value, 10) || 6),
    minQuality: Math.max(0, parseInt(document.getElementById('recMin').value, 10) || 0),
    windowDays: Math.max(1, parseInt(document.getElementById('recWin').value, 10) || 14),
    dim: dim,
    weights: {
      rating: (parseInt(document.getElementById('wRating').value, 10) || 0) / 100,
      works: (parseInt(document.getElementById('wWorks').value, 10) || 0) / 100,
      pop: (parseInt(document.getElementById('wPop').value, 10) || 0) / 100,
      recency: (parseInt(document.getElementById('wRec').value, 10) || 0) / 100
    }
  };
  if (persist !== false) save().then(renderRec);
}
['recOn', 'recNotify', 'recExcludeSeen', 'recAutoW', 'recMax', 'recNew', 'recMin', 'recWin', 'recSeenRatio', 'recDimA', 'recDimM', 'recDimS'].forEach(function (id) {
  var el = document.getElementById(id);
  el.addEventListener('change', function () { saveRec(); });
});
['wRating', 'wWorks', 'wPop', 'wRec'].forEach(function (id) {
  var el = document.getElementById(id);
  el.addEventListener('input', function () { updateWeightLabels(); saveRec(false); });
  el.addEventListener('change', function () { saveRec(); });
});
document.getElementById('recGen').addEventListener('click', function () {
  chrome.runtime.sendMessage({ type: 'sf_build_daily', force: true });
  document.getElementById('recTip').innerHTML = '已请求重新生成今日推荐…（后台处理中）';
});
document.getElementById('recClearHist').addEventListener('click', function () {
  if (!confirm('清空推荐历史与今日推荐？已建立的收藏 / 屏蔽规则不受影响。')) return;
  D.recHistory = []; D.dailyRecs = {}; D.recFeedback = {};
  save().then(renderRec);
});

/* ---------------- 云同步 ---------------- */
function renderSync() {
  document.getElementById('syncOn').checked = !!(D.settings && D.settings.sync);
}
document.getElementById('syncOn').addEventListener('change', function () {
  D.settings.sync = this.checked;
  save().then(function () {
    document.getElementById('syncTip').textContent = this.checked
      ? '已开启云同步。数据将走 Chrome / Edge 账号同步（不经任何服务器）。首次请点「立即同步到云端」把本机数据推上去。'
      : '已关闭云同步，数据仅存本机。';
  }.bind(this));
});
document.getElementById('syncMigrate').addEventListener('click', function () {
  save().then(function () {
    document.getElementById('syncTip').textContent = '已触发同步。若已开启云同步，本机数据会推送到账号；若关闭，则仅本机保存。';
  });
});

/* ---------------- 冲突检测 ---------------- */
function computeConflictsD() {
  var map = {};
  (D.rules || []).forEach(function (r) {
    if (r.enabled === false) return;
    var k = r.type + '|' + String(r.value).toLowerCase();
    var e = map[k] || (map[k] = { value: r.value, type: r.type, actions: {} });
    e.actions[r.action] = 1;
  });
  var out = [];
  Object.keys(map).forEach(function (k) {
    var e = map[k];
    if (e.actions.block && (e.actions.favorite || e.actions.highlight)) out.push(e);
  });
  return out;
}
function renderConflicts() {
  var box = document.getElementById('conflictBox');
  if (!box) return;
  var cs = computeConflictsD();
  if (!cs.length) { box.innerHTML = ''; return; }
  var names = cs.slice(0, 12).map(function (c) {
    return '<span class="chip type">' + esc(TYPE_LABEL[c.type] || c.type) + '</span> ' + esc(c.value);
  }).join(' · ');
  box.innerHTML = '<div class="tip" style="border:1px solid rgba(255,193,60,.35);background:rgba(255,193,60,.08);color:#ffe4a3;margin-bottom:8px">' +
    '⚠️ 有 <b>' + cs.length + '</b> 个目标同时被「屏蔽」和「收藏 / 高亮」，屏蔽优先生效，收藏 / 高亮不会显示：<br>' +
    names + (cs.length > 12 ? ' 等' : '') +
    ' <button class="mini" id="fixConflicts" style="margin-left:6px">一键移除这些冲突的收藏/高亮</button></div>';
  var fx = document.getElementById('fixConflicts');
  if (fx) fx.addEventListener('click', function () {
    pushUndo();
    D.rules = D.rules.filter(function (r) {
      if (r.action === 'block') return true;
      var k = r.type + '|' + String(r.value).toLowerCase();
      return !cs.some(function (c) { return (c.type + '|' + String(c.value).toLowerCase()) === k; });
    });
    save().then(function () { renderAll(); });
  });
}

/* ---------------- 规则包模板（一键导入成套规则） ---------------- */
var RULE_PACKS = [
  {
    id: 'western', name: '欧美厂牌 → 屏蔽',
    tip: '把欧美常见厂牌整体屏蔽掉。',
    rules: [
      { type: 'maker', value: 'Brazzers', action: 'block' },
      { type: 'maker', value: 'Reality Kings', action: 'block' },
      { type: 'maker', value: 'Vixen', action: 'block' },
      { type: 'maker', value: 'Tushy', action: 'block' },
      { type: 'maker', value: 'Blacked', action: 'block' }
    ]
  },
  {
    id: 'vr', name: 'VR / 全景 → 屏蔽',
    tip: '屏蔽 VR、全景、サンプル（样片）类内容。',
    rules: [
      { type: 'tag', value: 'VR', action: 'block' },
      { type: 'tag', value: 'VR専用', action: 'block' },
      { type: 'tag', value: 'サンプル', action: 'block' },
      { type: 'tag', value: '見本', action: 'block' }
    ]
  },
  {
    id: 'hd', name: '高清 / 4K → 高亮',
    tip: '把高清、4K、中文字幕的卡片高亮并置顶。',
    rules: [
      { type: 'tag', value: '高清', action: 'highlight' },
      { type: 'tag', value: '4K', action: 'highlight' },
      { type: 'tag', value: '中文字幕', action: 'highlight' }
    ]
  },
  {
    id: 'hiscore', name: '高评分（≥4.5）→ 高亮',
    tip: '只看条件不看关键词：评分 ≥4.5 的卡片自动高亮。',
    rules: [
      { type: 'keyword', value: '', action: 'highlight', ratingMin: 4.5 }
    ]
  },
  {
    id: 'recent', name: '近两年新作 → 高亮',
    tip: '发行日期在近两年内的卡片自动高亮。',
    rules: [
      { type: 'keyword', value: '', action: 'highlight', dateFrom: (new Date(Date.now() - 2 * 365 * 864e5)).toISOString().slice(0, 10) }
    ]
  },
  {
    id: 'expr_hi', name: '【表达式】高分新片 → 高亮',
    tip: '用一句话表达「评分 ≥4 且 2023 年后发行」。导入后可在规则库点 ✎ 改里面的数字。',
    rules: [
      { type: 'expr', value: '高分新片', action: 'highlight', expr: 'rating >= 4 && date >= 2023-01-01' }
    ]
  },
  {
    id: 'expr_prefix', name: '【表达式】按番号前缀屏蔽（正则）',
    tip: '用正则按番号前缀批量屏蔽，示例是 ABC- 开头；把正则里的 ABC 换成你要的前缀即可。',
    rules: [
      { type: 'expr', value: '番号前缀 ABC-', action: 'block', expr: 'code =~ /^ABC-\\d+/' }
    ]
  },
  {
    id: 'expr_mix', name: '【表达式】标签组合 + 排除片商 → 收藏',
    tip: '示例：同时命中两个标签、且不是某个片商时才收藏。括号与 ! 的用法一看就懂。',
    rules: [
      { type: 'expr', value: '高清+中文字幕', action: 'favorite', expr: 'tag ~ 高清 && tag ~ 中文字幕 && !(maker ~ Moodyz)' }
    ]
  }
];
function renderRulePacks() {
  var sel = document.getElementById('packSel');
  if (!sel || sel.dataset.filled) return;
  sel.innerHTML = RULE_PACKS.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
  sel.dataset.filled = '1';
}
var _packSel = document.getElementById('packSel');
if (_packSel) {
  _packSel.addEventListener('change', function () {
    var p = RULE_PACKS.filter(function (x) { return x.id === _packSel.value; })[0];
    document.getElementById('packTip').textContent = p ? p.tip : '';
  });
}
(function () {
  var btn = document.getElementById('packApply');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var id = document.getElementById('packSel').value;
    var pack = RULE_PACKS.filter(function (x) { return x.id === id; })[0];
    if (!pack) return;
    var seen = {};
    D.rules.forEach(function (r) { seen[r.type + '|' + String(r.value || '').toLowerCase()] = 1; });
    var added = 0;
    pushUndo();
    pack.rules.forEach(function (t) {
      var key = t.type + '|' + String(t.value || '').toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      D.rules.push({
        id: uid(), type: t.type, value: t.value || '', aliases: [],
        action: t.action, match: 'contains', scope: SCOPE_OF[t.type] || 'all',
        color: D.settings.hlColor, sites: [], enabled: true, hits: 0, createdAt: Date.now(),
        ratingMin: t.ratingMin == null ? '' : t.ratingMin,
        dateFrom: t.dateFrom || '', dateTo: t.dateTo || '',
        expr: t.expr || ''
      });
      added++;
    });
    save().then(function () {
      renderRules();
      document.getElementById('packTip').textContent =
        added ? ('已导入 ' + added + ' 条规则（跳过 ' + (pack.rules.length - added) + ' 条已存在的）。') : '这个规则包的条目都已存在，未重复导入。';
    });
  });
})();

/* ---------------- 卡片选择器预置模板 ---------------- */
/* content.js 的 SITE_TEMPLATES 是唯一事实来源，这里是同一份数据的副本。
   由 _test_sites.js 断言两边一致 —— 别只改一处。 */
var TPL_SELECTORS = [
  { name: 'JavBus', test: 'javbus', sel: '.item' },
  { name: 'xchina', test: 'xchina', sel: '.item' },
  { name: 'JavDB', test: 'javdb', sel: '.item' },
  { name: 'PornHub', test: 'pornhub', sel: 'li.pcVideoListItem' },
  { name: 'YouPorn', test: 'youporn', sel: 'article.video-box' },
  { name: 'xsijishe（求出处）', test: 'xsijishe', sel: '#threadlist div[id^="normalthread_"], #threadlist div[id^="stickthread_"]' },
  { name: 'AVMOO / AVSOX', test: 'avmoo', sel: '.item' },
  { name: '色花堂 / 高清', test: 'sehuatang', sel: '.card' },
  { name: 'JavLibrary', test: 'javlibrary', sel: '.item' }
];
function renderTemplates() {
  var sel = document.getElementById('tplSel');
  if (!sel) return;
  if (!sel.dataset.filled) {
    sel.innerHTML = TPL_SELECTORS.map(function (t) {
      return '<option value="' + esc(t.test) + '">' + esc(t.name) + ' → ' + esc(t.sel) + '</option>';
    }).join('');
    sel.dataset.filled = '1';
  }
}
document.getElementById('tplApply').addEventListener('click', function () {
  var test = document.getElementById('tplSel').value;
  var tpl = TPL_SELECTORS.filter(function (t) { return t.test === test; })[0];
  if (!tpl) return;
  var matched = 0;
  pushUndo();
  (D.sites || []).forEach(function (s) {
    if (String(s.pattern).toLowerCase().indexOf(tpl.test) !== -1) { s.selector = tpl.sel; matched++; }
  });
  save().then(function () {
    renderSites();
    alert(matched ? ('已为 ' + matched + ' 个匹配站点套用选择器 ' + tpl.sel) :
      '没有站点匹配「' + tpl.name + '」。可先在「监管站点」添加该站，再套用。');
  });
});
document.getElementById('tplAll').addEventListener('click', function () {
  if (!confirm('把全部预置模板套用到匹配的站点？（已存在自定义选择器的站点会被覆盖）')) return;
  pushUndo();
  var n = 0;
  TPL_SELECTORS.forEach(function (tpl) {
    (D.sites || []).forEach(function (s) {
      if (String(s.pattern).toLowerCase().indexOf(tpl.test) !== -1) { s.selector = tpl.sel; n++; }
    });
  });
  save().then(function () { renderSites(); alert('已套用 ' + n + ' 处站点选择器。'); });
});

/* ---------------- 本地定时自动备份 ---------------- */
function renderBackup() {
  var cb = document.getElementById('autoBackupOn');
  if (cb) cb.checked = !!(D.settings && D.settings.autoBackup);
  var sel = document.getElementById('backupKeep');
  if (sel) {
    var k = Number(D.settings && D.settings.backupKeep);
    if (isNaN(k)) k = 7;
    // 选项表里只有 0/1/7/30，历史脏值（比如手改成 3）就贴到最近的档上，避免下拉显示空白
    sel.value = String([0, 1, 7, 30].indexOf(k) !== -1 ? k : 7);
  }
  updateBackupTip();
}
function updateBackupTip() {
  var el = document.getElementById('backupTip');
  if (!el) return;
  var on = !!(D.settings && D.settings.autoBackup);
  var k = Number(D.settings && D.settings.backupKeep);
  if (isNaN(k)) k = 7;
  var keepTxt = k > 0 ? ('自动备份在下载目录最多保留 ' + k + ' 份，更早的会自动清掉') : '自动备份不轮换，会一直累积（需自己清理）';
  el.textContent = on
    ? ('已开启。扩展每天会在后台写一份 JSON 到「下载/sitefilter-backup/」，文件名含时分秒；' + keepTxt + '。')
    : ('已关闭自动备份。仍可用上方「导出 JSON 备份」手动保存。' + keepTxt + '（该设置在你重新开启后生效。）');
}
document.getElementById('autoBackupOn').addEventListener('change', function () {
  D.settings.autoBackup = this.checked;
  save().then(function () { updateBackupTip(); });
});
(function () {
  var sel = document.getElementById('backupKeep');
  if (!sel) return;
  sel.addEventListener('change', function () {
    D.settings.backupKeep = Number(sel.value) || 0;
    save().then(function () { updateBackupTip(); });
  });
})();
document.getElementById('backupNow').addEventListener('click', function () {
  try {
    var json = JSON.stringify(D);
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // 手动备份也带时分秒，避免同一天多次点「立即备份」互相覆盖
    var now = new Date();
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = now.toISOString().slice(0, 10) + '_' + p2(now.getHours()) + p2(now.getMinutes()) + p2(now.getSeconds());
    a.download = 'sitefilter-backup-' + stamp + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    document.getElementById('backupTip').textContent = '已导出备份：sitefilter-backup-' + stamp + '.json';
  } catch (e) { alert('备份失败：' + e.message); }
});

/* =====================================================================
 * 分项回滚（建议 ⑤ 的后半）
 * 需求场景：只想把「规则」退回两天前的样子，但不想把收藏 / 已看 / 发现库一起退回
 * （那些是这段时间新攒的，整体回滚等于白攒）。所以这里让用户按区块勾选恢复。
 * 安全设计：① 恢复前先导出一份当前状态（自动、免确认）② 勾选项默认全不勾
 *         ③ 危险区块（清空型）单独标注 ④ 恢复后立刻 re-migrate 保证结构对齐
 * ===================================================================== */

// 可回滚的区块：键 → { label, kind, apply(cur, inc) }
//   kind: 'replace' 整体替换 / 'merge' 按 key 合并 / 'append' 追加去重
var RESTORE_SECTIONS = [
  { key: 'rules', label: '规则库', kind: 'replace', desc: '整份规则列表（含启停状态、有效期）' },
  { key: 'groups', label: '规则分组', kind: 'replace', desc: '分组定义与启停' },
  { key: 'sites', label: '监管站点', kind: 'replace', desc: '监管站点列表与自定义选择器' },
  { key: 'settings', label: '设置项', kind: 'merge', desc: '各种开关；只覆盖备份里存在的键' },
  { key: 'seen', label: '已看记录', kind: 'merge', desc: '按番号合并，备份里的会覆盖同名项' },
  { key: 'favCodes', label: '番号收藏', kind: 'merge', desc: '按番号合并' },
  { key: 'watchlist', label: '待看清单', kind: 'merge', desc: '按番号合并' },
  { key: 'discovered', label: '发现库', kind: 'merge', desc: '按条目合并 —— 数量大，通常不必回滚' },
  { key: 'peeks', label: '临时放行记录', kind: 'merge', desc: '软屏蔽的「仍然查看」放行时间戳' },
  { key: 'profiles', label: '场景档位', kind: 'replace', desc: '档位快照列表' },
];

var partialData = null;   // 已解析的备份对象

function applyRestoreSection(sec, backup, target) {
  var inc = backup[sec.key];
  if (inc == null) return false;
  if (sec.kind === 'replace') {
    target[sec.key] = JSON.parse(JSON.stringify(inc));
  } else if (sec.kind === 'merge') {
    target[sec.key] = Object.assign({}, target[sec.key] || {}, JSON.parse(JSON.stringify(inc)));
  } else {
    target[sec.key] = (target[sec.key] || []).concat(JSON.parse(JSON.stringify(inc)));
  }
  return true;
}

function renderPartial() {
  var box = document.getElementById('partialBox');
  var nameEl = document.getElementById('partialName');
  if (!box) return;
  if (!partialData) {
    if (nameEl) nameEl.textContent = '未选择文件';
    box.innerHTML = '<div class="empty">选一个备份文件后，这里会列出可以单独恢复的区块 —— ' +
      '默认全部不勾选，请按需要勾。恢复前会自动先导出当前状态做保险。</div>';
    return;
  }
  if (nameEl) nameEl.textContent = partialData.__name || '已选择';

  // 备份里实际存在的区块才列出来（免得勾了个空的还以为恢复了）
  var avail = RESTORE_SECTIONS.filter(function (s) { return partialData[s.key] != null; });
  var missing = RESTORE_SECTIONS.filter(function (s) { return partialData[s.key] == null; });

  var bsv = partialData.schemaVersion;
  var html = '<div class="tip" style="margin-top:0">备份里的数据结构版本：<b>v' + esc(String(bsv || '未知')) +
    '</b>（当前 v' + SCHEMA_VERSION + '）' +
    (bsv && Number(bsv) > SCHEMA_VERSION ? ' —— <span style="color:#ffb3c1">来自更高版本，恢复后可能有不兼容字段</span>' : '') +
    '</div>';
  html += '<table><thead><tr><th style="width:30px"></th><th style="width:110px">区块</th>' +
    '<th style="width:190px">备份里有多少</th><th>说明</th></tr></thead><tbody>';
  avail.forEach(function (s) {
    var v = partialData[s.key];
    var cnt = Array.isArray(v) ? (v.length + ' 条') : (typeof v === 'object' ? (Object.keys(v).length + ' 个键') : '—');
    html += '<tr><td><input type="checkbox" class="prSec" value="' + esc(s.key) + '"></td>' +
      '<td><b>' + esc(s.label) + '</b></td><td><span class="alias">' + esc(cnt) + '</span></td>' +
      '<td><span class="alias">' + esc(s.desc) + '</span></td></tr>';
  });
  html += '</tbody></table>';
  if (missing.length) {
    html += '<div class="tip">备份里没有这些区块，无法恢复：' +
      missing.map(function (s) { return esc(s.label); }).join('、') + '</div>';
  }
  html += '<div class="grid" style="margin-top:8px">' +
    '<button class="primary" id="prApply">恢复勾选的区块</button>' +
    '<button id="prAll">全选</button><button id="prNone">全不选</button>' +
    '<span style="flex:1"></span>' +
    '<button class="danger" id="prClear">丢弃这个文件</button></div>';
  box.innerHTML = html;

  var all = function (v) {
    Array.prototype.forEach.call(box.querySelectorAll('.prSec'), function (c) { c.checked = v; });
  };
  var q = function (id) { return document.getElementById(id); };
  if (q('prAll')) q('prAll').addEventListener('click', function () { all(true); });
  if (q('prNone')) q('prNone').addEventListener('click', function () { all(false); });
  if (q('prClear')) q('prClear').addEventListener('click', function () {
    partialData = null; renderPartial();
  });
  if (q('prApply')) q('prApply').addEventListener('click', function () {
    var picked = Array.prototype.filter.call(box.querySelectorAll('.prSec'), function (c) { return c.checked; })
      .map(function (c) { return c.value; });
    if (!picked.length) { alert('先勾选要恢复的区块。'); return; }
    var labels = picked.map(function (k) {
      var s = RESTORE_SECTIONS.filter(function (x) { return x.key === k; })[0];
      return s ? s.label : k;
    });
    if (!confirm('将从备份恢复以下区块：\n\n  ' + labels.join('、') +
      '\n\n未勾选的区块保持现状不变。\n恢复前会自动先导出当前状态作为保险。\n\n确定继续？')) return;

    // 保险：先把当前全量导出（复用导出按钮的路径，但不弹加密询问）
    try { exportPlain(); } catch (e) { }
    pushUndo();

    var n = 0;
    picked.forEach(function (k) {
      var sec = RESTORE_SECTIONS.filter(function (x) { return x.key === k; })[0];
      if (sec && applyRestoreSection(sec, partialData, D)) n++;
    });
    // 恢复完再 migrate 一次：备份可能是旧结构，补齐缺字段（不改变已恢复的值）
    D = migrate(D);
    save().then(function () {
      renderAll();
      var tip = document.getElementById('partialName');
      if (tip) tip.textContent = '已恢复 ' + n + ' 个区块';
      alert('恢复完成：' + labels.join('、') + '\n\n（已自动导出一份恢复前的完整备份）');
    });
  });
}

(function initPartial() {
  var btn = document.getElementById('partialPick');
  var file = document.getElementById('partialFile');
  if (!btn || !file) return;
  btn.addEventListener('click', function () { file.click(); });
  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var obj = JSON.parse(String(fr.result));
        if (isEncryptedBackup(obj)) {
          alert('这是一份加密备份 —— 分项回滚暂时只支持明文 JSON。\n请先用原密码解密后再操作（或改用「导入备份」整体导入）。');
          file.value = ''; return;
        }
        if (!obj || typeof obj !== 'object') throw new Error('不是对象');
        obj.__name = f.name;
        partialData = obj;
        renderPartial();
      } catch (e) {
        alert('读取失败：不是有效的 JSON 备份文件。（' + (e && e.message ? e.message : e) + '）');
      }
      file.value = '';
    };
    fr.readAsText(f);
  });
})();

/* ---------------- 错误日志 ---------------- */
function renderErrLog() {
  var box = document.getElementById('errTable');
  if (!box) return;
  var list = (D.errLog || []).slice().reverse();
  var cnt = document.getElementById('errCount');
  if (cnt) cnt.textContent = list.length ? ('最近 ' + list.length + ' 条') : '（无）';
  if (!list.length) { box.innerHTML = '<div class="empty">没有错误记录。</div>'; return; }
  var detail = document.getElementById('errDetail').checked;
  var html = '<table><thead><tr><th style="width:150px">时间</th><th style="width:120px">位置</th><th>信息</th></tr></thead><tbody>';
  list.slice(0, 100).forEach(function (e) {
    var msg = detail ? (e.m + (e.s ? '  @' + e.s : '')) : String(e.m || '').slice(0, 90);
    html += '<tr><td>' + esc(new Date(e.t).toLocaleString('zh-CN')) + '</td>' +
      '<td><span class="chip type">' + esc(e.w || '') + '</span></td><td>' + esc(msg) + '</td></tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;
}
(function () {
  var r = document.getElementById('errRefresh');
  if (r) r.addEventListener('click', function () {
    cfGet(function (d) { D.errLog = (d.errLog || []).slice(-ERR_MAX); renderErrLog(); });
  });
  var ex = document.getElementById('errExport');
  if (ex) ex.addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(D.errLog || [], null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sitefilter-errors-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  });
  var cl = document.getElementById('errClear');
  if (cl) cl.addEventListener('click', function () {
    if (!confirm('清空错误日志？')) return;
    D.errLog = []; save().then(renderErrLog);
  });
  var dt = document.getElementById('errDetail');
  if (dt) dt.addEventListener('change', renderErrLog);
})();

/* ---------------- 撤销 ---------------- */
document.getElementById('undoBtn').addEventListener('click', doUndo);


/* =====================================================================
 * 快捷键（可在设置页自定义）
 * 键位存 settings.keys，缺项回落默认。校验规则与 content.js 的 normKeys 必须一致
 * —— 测试里有守卫断言两边的默认表与特殊键表完全相同，避免各写各的。
 * ===================================================================== */
var DEFAULT_KEYS = {
  panel: 'f', sfw: 's', boss: 'b', lock: 'l',
  prev: 'k', next: 'j', block: 'b', fav: 'f', hl: 'h', watch: 'p', open: 'enter'
};
var KEY_SPECIAL = ['enter', 'space', 'escape', 'tab', 'backspace', 'delete',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown'];
var KEY_GROUPS = [
  {
    name: '全局键', hint: '同时按住 Alt 才生效，不会影响页面本身的操作', items: [
      ['panel', '展开 / 收起悬浮面板'],
      ['sfw', 'SFW 缩略图模糊'],
      ['boss', '老板键（恢复页面原样并隐藏面板）'],
      ['lock', '锁定 / 解锁悬浮球位置']
    ]
  },
  {
    name: '面板内键', hint: '面板打开时生效，作用于「当前选中的卡片」', items: [
      ['prev', '上一条'], ['next', '下一条'],
      ['block', '屏蔽该卡片的全部女优'], ['fav', '收藏（★ 描边）'],
      ['hl', '高亮'], ['watch', '加入待看'], ['open', '打开链接']
    ]
  }
];
var KEY_LABELS = {}, KEY_GROUP_OF = {};
KEY_GROUPS.forEach(function (g) {
  var names = g.items.map(function (it) { return it[0]; });
  g.items.forEach(function (it) { KEY_LABELS[it[0]] = it[1]; KEY_GROUP_OF[it[0]] = names; });
});

function isKeyName(v) {
  v = String(v || '').toLowerCase();
  if (!v) return false;
  if (/^[a-z0-9]$/.test(v)) return true;
  if (/^f([1-9]|1[0-2])$/.test(v)) return true;
  return KEY_SPECIAL.indexOf(v) !== -1;
}
// KeyboardEvent.key → 可配置的小写名
function normKeyName(k) {
  k = String(k == null ? '' : k);
  if (k === ' ' || k === 'Spacebar') return 'space';
  if (k === 'Esc') return 'escape';
  return k.toLowerCase();
}
function normKeys(raw) {
  var out = {};
  for (var k in DEFAULT_KEYS) {
    var v = (raw && raw[k] != null && raw[k] !== '') ? String(raw[k]).toLowerCase() : DEFAULT_KEYS[k];
    out[k] = isKeyName(v) ? v : DEFAULT_KEYS[k];
  }
  return out;
}
function keyMap() { D.settings.keys = normKeys(D.settings.keys); return D.settings.keys; }
function keyLabelOf(k) {
  k = String(k || '');
  if (k.length === 1) return k.toUpperCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
}
// 同一组内出现重复键位 → 靠前的动作会把后面的吃掉，必须让用户知道
function keyConflicts() {
  var km = keyMap(), out = [];
  KEY_GROUPS.forEach(function (g) {
    var byKey = {};
    g.items.forEach(function (it) { (byKey[km[it[0]]] = byKey[km[it[0]]] || []).push(it[1]); });
    Object.keys(byKey).forEach(function (k) {
      if (byKey[k].length > 1) out.push('「' + keyLabelOf(k) + '」同时指派给了：' + byKey[k].join('、'));
    });
  });
  KEY_GROUPS[1].items.forEach(function (it) {
    if (km[it[0]] === 'escape') out.push('面板内键不能用 Esc（Esc 固定用于关闭面板）');
  });
  return out;
}

function renderKeys() {
  var box = document.getElementById('keysBox');
  if (!box) return;
  var km = keyMap();
  var html = '';
  KEY_GROUPS.forEach(function (g) {
    html += '<div class="keygroup"><div class="keygrouphd">' + esc(g.name) +
      ' <span class="alias">' + esc(g.hint) + '</span></div><div class="grid">';
    g.items.forEach(function (it) {
      html += '<label class="keycell"><span class="keylab">' + esc(it[1]) + '</span>' +
        '<input class="keyin" type="text" readonly data-k="' + it[0] + '" value="' + esc(keyLabelOf(km[it[0]])) +
        '" title="点一下，然后按下你想用的键"></label>';
    });
    html += '</div></div>';
  });
  box.innerHTML = html;

  var warn = document.getElementById('keysWarn');
  var cs = keyConflicts();
  if (warn) {
    warn.innerHTML = cs.length ? ('⚠️ ' + cs.map(esc).join('；')) : '';
    warn.style.display = cs.length ? '' : 'none';
  }
  var tip = document.getElementById('keysTip');
  if (tip) {
    tip.textContent = '当前生效：Alt+' + keyLabelOf(km.panel) + ' 面板 · Alt+' + keyLabelOf(km.sfw) + ' SFW · Alt+' +
      keyLabelOf(km.boss) + ' 老板键　|　面板内 ' + keyLabelOf(km.prev) + ' / ' + keyLabelOf(km.next) + ' 上下移动，' +
      keyLabelOf(km.block) + ' 屏蔽，' + keyLabelOf(km.fav) + ' 收藏，' + keyLabelOf(km.hl) + ' 高亮，' +
      keyLabelOf(km.watch) + ' 待看，' + keyLabelOf(km.open) + ' 打开。改完立即生效，不用重启浏览器。';
  }

  box.querySelectorAll('input.keyin').forEach(function (inp) {
    inp.addEventListener('keydown', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Tab') { inp.blur(); return; }
      var name = inp.dataset.k;
      var k = normKeyName(e.key);
      function bad(msg) {
        inp.classList.add('bad');
        if (warn) { warn.textContent = '⚠️ ' + msg; warn.style.display = ''; }
        setTimeout(function () { inp.classList.remove('bad'); renderKeys(); }, 1600);
      }
      if (!isKeyName(k)) return bad('不支持这个按键（用字母 / 数字 / F1-F12 / Enter / Space 等）');
      if (k === 'escape') return bad('Esc 固定用于关闭面板，不能改');
      var clash = (KEY_GROUP_OF[name] || []).filter(function (n) { return n !== name && keyMap()[n] === k; });
      if (clash.length) return bad('「' + keyLabelOf(k) + '」已经给了「' + KEY_LABELS[clash[0]] + '」，换一个键');
      var km2 = keyMap(); km2[name] = k;
      D.settings.keys = km2;
      save().then(renderKeys);
    });
  });
}

/* =====================================================================
 * 条件表达式测试器
 * 用的是页面里同一份引擎（expr.js），所以「这里通过」==「页面上会命中」。
 * ===================================================================== */
var EXPR_ENGINE = (typeof SF_EXPR !== 'undefined' && SF_EXPR) ? SF_EXPR : null;
var DEFAULT_EXPR_CTX = [
  '# 每行一条「字段: 值」，用来模拟一张卡片；# 开头是注释',
  'title: ssis-001 高清 中文字幕',
  'actress: 三上悠亚',
  'tag: 巨乳 | 高清',
  'maker: S1',
  'series: 超高级系列',
  'director: 导演甲',
  'code: SSIS-001',
  'rating: 4.8',
  'date: 2024-06-01'
].join('\n');

function exprCtxFromText(txt) {
  var ctx = {
    title: '', actress: '', tag: '', maker: '', series: '', director: '',
    code: '', rating: null, date: '', all: ''
  };
  String(txt || '').split('\n').forEach(function (line) {
    if (/^\s*#/.test(line)) return;
    var m = line.match(/^\s*([A-Za-z_]+)\s*[:：]\s*(.*)$/);
    if (!m) return;
    var k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'rating') { ctx.rating = (v === '' ? null : Number(v)); return; }
    if (k === 'date') { ctx.date = v; return; }
    if (k in ctx) ctx[k] = v;
  });
  ['title', 'actress', 'tag', 'maker', 'series', 'director', 'code'].forEach(function (k) {
    ctx[k] = String(ctx[k] || '').toLowerCase();
  });
  // all 与页面一致：整卡文本（标题 + 番号 + 各维度）
  ctx.all = [ctx.title, ctx.code, ctx.actress, ctx.tag, ctx.maker, ctx.series, ctx.director]
    .join(' ').toLowerCase();
  return ctx;
}

function renderExprTest() {
  var ta = document.getElementById('exprCtx');
  if (ta && !ta.value.trim()) ta.value = DEFAULT_EXPR_CTX;
  var out = document.getElementById('exprOut');
  if (out && !EXPR_ENGINE) {
    out.className = 'tip bad';
    out.textContent = '⚠️ 表达式引擎 expr.js 未加载，测试器不可用（检查扩展目录里有没有这个文件）。';
  }
}

function runExprTest() {
  var inp = document.getElementById('exprTest');
  var out = document.getElementById('exprOut');
  if (!inp || !out) return;
  var src = inp.value.trim();
  if (!EXPR_ENGINE) { out.className = 'tip bad'; out.textContent = '⚠️ 表达式引擎未加载'; return; }
  if (!src) { out.className = 'tip'; out.textContent = '先写一个表达式，例如 rating >= 4 && tag ~ 高清'; return; }
  var c = EXPR_ENGINE.check(src);
  if (!c.ok) { out.className = 'tip bad'; out.textContent = '❌ 语法错误：' + c.err; return; }
  var hit = EXPR_ENGINE.test(src, exprCtxFromText(document.getElementById('exprCtx').value));
  out.className = 'tip ' + (hit ? 'ok' : 'bad');
  out.textContent = (hit ? '✅ 语法正确，且命中下面的模拟卡片 —— 该规则在页面上会生效'
    : '⚠️ 语法正确，但不命中下面的模拟卡片（改改模拟卡片的字段值再试）') +
    '　·　提醒：缺评分 / 缺日期的卡片参与 > >= < <= 比较时一律不命中。';
}

function addRuleFromExpr() {
  var inp = document.getElementById('exprTest');
  if (!inp) return;
  var src = inp.value.trim();
  if (!src) { alert('先写一个表达式。'); return; }
  var c = EXPR_ENGINE ? EXPR_ENGINE.check(src) : { ok: false, err: '表达式引擎未加载' };
  if (!c.ok) { alert('表达式有语法错误：' + c.err); return; }
  var act = (document.getElementById('exprAct') || {}).value || 'highlight';
  pushUndo();
  D.rules.unshift({
    id: uid(), type: 'expr', value: src.length > 40 ? (src.slice(0, 40) + '…') : src,
    expr: src, aliases: [], action: act, match: 'contains', scope: 'all',
    color: D.settings.hlColor || '#00e5ff', sites: [], enabled: true, hits: 0,
    createdAt: Date.now(), ratingMin: '', dateFrom: '', dateTo: ''
  });
  save().then(function () {
    renderRules(); renderConflicts();
    alert('已新建一条「表达式」规则，可在「规则库」里点 ✎ 微调。');
  });
}

(function () {
  var r = document.getElementById('keysReset');
  if (r) r.addEventListener('click', function () {
    D.settings.keys = Object.assign({}, DEFAULT_KEYS);
    save().then(renderKeys);
  });
  var rb = document.getElementById('exprRun');
  if (rb) rb.addEventListener('click', runExprTest);
  var ab = document.getElementById('exprAdd');
  if (ab) ab.addEventListener('click', addRuleFromExpr);
  var ctx = document.getElementById('exprCtx');
  if (ctx) ctx.addEventListener('input', function () {
    if (document.getElementById('exprTest').value.trim()) runExprTest();
  });
  var ei = document.getElementById('exprTest');
  if (ei) ei.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); runExprTest(); }
  });
})();

/* =====================================================================
 * 规则体检：把"为什么这条规则一直不生效"和"这条规则是不是太宽了"讲清楚
 * 与「死规则清理」的区别：那个只按 0 命中一刀切，这个给原因、给建议。
 * ===================================================================== */
function explainZeroHit(r) {
  var why = [];
  if (r.enabled === false) why.push('规则当前是关闭状态');
  if (r.groupId) {
    var g = (D.groups || []).filter(function (x) { return x.id === r.groupId; })[0];
    if (g && g.on === false) why.push('所属分组「' + g.name + '」当前关闭');
    if (g && g.autoOff) why.push('所属分组「' + g.name + '」是自动开关组');
  }
  if (r.expiresAt && Number(r.expiresAt) > 0) {
    why.push(Date.now() >= Number(r.expiresAt) ? '临时规则已到期' : '临时规则，到期后自动失效');
  }
  if (r.sites && r.sites.length) why.push('限定只在 ' + r.sites.join(' / ') + ' 生效，当前可能没在那些站刷到过');
  if (r.match === 'exact') why.push('匹配方式是「精确」，页面文本只要多一个空格就不算命中 —— 多数情况应改成「包含」');
  if (r.match === 'regex') why.push('用了正则，建议到「正则测试器」里确认写法真的能命中');
  if (r.scope && r.scope !== 'all') {
    why.push('作用范围限定为「' + (SCOPE_LABEL[r.scope] || r.scope) + '」，若该维度没被识别出来就永远命中不了');
  }
  if (r.expr) why.push('用了条件表达式，表达式为假时整条规则不生效');
  if (r.ratingMin != null && r.ratingMin !== '') why.push('要求评分 ≥ ' + r.ratingMin + '，卡片没解析出评分就不命中');
  if (r.dateFrom || r.dateTo) why.push('限定了发行日期区间，卡片没解析出日期就不命中');
  if ((r.aliases || []).length) why.push('有 ' + r.aliases.length + ' 个别名，可再补几个常见写法');
  return why;
}

var SCOPE_LABEL = {
  all: '整卡文本', actress: '仅女优', tag: '仅标签', maker: '仅片商',
  series: '仅系列', director: '仅导演', title: '标题/番号'
};

function ruleImpact(r) {
  var disc = D.discovered || {};
  var t = r.type, v = String(r.value || '').toLowerCase();
  if (!v) return null;
  if (['expr', 'code', 'keyword'].indexOf(t) !== -1) return null;
  var n = 0, total = 0;
  Object.keys(disc).forEach(function (k) {
    var it = disc[k] || {};
    if ((it.type || '') !== t) return;
    total++;
    if (String(it.v || '').toLowerCase().indexOf(v) !== -1) n++;
  });
  if (!total) return null;
  return { n: n, total: total, ratio: n / total };
}

function renderAudit() {
  var box = document.getElementById('auditBox');
  if (!box) return;
  var cnt = document.getElementById('auditCount');
  var now = Date.now();
  var rules = D.rules || [];

  // ① 零命中：启用中、已存在 > 7 天、hits === 0
  var zero = rules.filter(function (r) {
    if (r.enabled === false) return false;
    if ((r.hits || 0) > 0) return false;
    if (!r.createdAt) return false;
    return (now - r.createdAt) > 7 * 864e5;
  });
  // ② 命中过宽：屏蔽规则，发现库里超过 70% 的同类条目都带这个词
  var wide = [];
  rules.forEach(function (r) {
    if (r.action !== 'block') return;
    if (r.enabled === false) return;
    var im = ruleImpact(r);
    if (im && im.n >= 8 && im.ratio >= 0.7) wide.push({ r: r, im: im });
  });
  var totalIssue = zero.length + wide.length;
  if (cnt) {
    cnt.textContent = totalIssue
      ? ('发现 ' + totalIssue + ' 处可优化：' + zero.length + ' 条疑似无效 · ' + wide.length + ' 条可能过宽')
      : '没有发现明显问题';
  }

  if (!totalIssue) {
    box.innerHTML = '<div class="empty">规则库看起来很健康：没有长期 0 命中的启用规则，也没有发现明显过宽的屏蔽词。</div>';
    return;
  }

  // 防误删：默认只勾选"看起来可以删"的零命中规则（有放宽建议的不勾）
  var html = '';
  if (zero.length) {
    html += '<div class="tip" style="margin-top:0">以下 <b>' + zero.length + '</b> 条启用超过 7 天却从未命中。' +
      '右边是可能的原因 —— 多数情况改一下就能生效，不必急着删。</div>' +
      '<table><thead><tr><th style="width:30px"><input type="checkbox" id="auditAllZero"></th>' +
      '<th style="width:130px">规则</th><th style="width:74px">类型</th><th>可能的原因 / 建议</th></tr></thead><tbody>';
    zero.slice(0, 60).forEach(function (r) {
      var why = explainZeroHit(r);
      html += '<tr data-audit="' + esc(r.id) + '">' +
        '<td><input type="checkbox" class="auditPk" data-id="' + esc(r.id) + '"></td>' +
        '<td><span class="val">' + esc(r.value || '（纯表达式）') + '</span>' +
        (r.expr ? '<br><span class="alias">⚙ ' + esc(r.expr) + '</span>' : '') + '</td>' +
        '<td><span class="chip type">' + esc(TYPE_LABEL[r.type] || r.type) + '</span></td>' +
        '<td><span class="alias">' + (why.length ? esc(why.join('；')) : '<span style="color:#7ee0a5">看不出明显原因，可能只是这个题材刷得少</span>') + '</span>' +
        ' <button class="mini" data-auditfix="' + esc(r.id) + '">改到规则库</button></td></tr>';
    });
    html += '</tbody></table>' +
      '<div class="grid" style="margin-top:8px">' +
      '<button class="danger" id="auditDel">删除勾选的规则</button>' +
      '<button id="auditMute">勾选的规则全部关闭</button>' +
      '<span style="flex:1"></span><span class="tip" style="margin:0">默认不勾选，请自行确认后再操作</span></div>';
  }
  if (wide.length) {
    html += '<div class="tip" style="margin-top:14px">以下 <b>' + wide.length + '</b> 条屏蔽规则在发现库里命中面过大 —— ' +
      '可能是「高清」「中文字幕」这类通用词，会把大量本来想看的内容一起挡掉。建议改成「标题词」精确一点，或限定作用范围。</div>' +
      '<table><thead><tr><th>规则</th><th style="width:74px">类型</th><th style="width:150px">影响面</th><th>例子</th></tr></thead><tbody>';
    wide.slice(0, 30).forEach(function (w) {
      var r = w.r;
      html += '<tr><td><span class="val">' + esc(r.value) + '</span></td>' +
        '<td><span class="chip type">' + esc(TYPE_LABEL[r.type] || r.type) + '</span></td>' +
        '<td><span class="chip" style="background:rgba(255,77,109,.18);color:#ffb3c1">' +
        w.im.n + ' / ' + w.im.total + '（' + Math.round(w.im.ratio * 100) + '%）</span></td>' +
        '<td><span class="alias">' + esc(sameTypeSamples(r, 4).join(' · ') || '—') + '</span></td></tr>';
    });
    html += '</tbody></table>';
  }
  box.innerHTML = html;

  var allCb = document.getElementById('auditAllZero');
  if (allCb) allCb.addEventListener('change', function () {
    Array.prototype.forEach.call(box.querySelectorAll('.auditPk'), function (c) { c.checked = allCb.checked; });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-auditfix]'), function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-auditfix');
      var pane = document.querySelector('.tabs button[data-pane=rules]');
      if (pane) pane.click();
      var rule = D.rules.filter(function (x) { return x.id === id; })[0];
      if (!rule) return;
      var query = document.getElementById('search');
      if (query) query.value = rule.value || '';
      renderRules();
      var tr = document.querySelector('#ruleTable tr[data-id="' + id + '"]');
      if (tr) {
        tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
        tr.style.transition = 'background .3s';
        tr.style.background = 'rgba(0,229,255,.18)';
        setTimeout(function () { tr.style.background = ''; }, 1800);
      }
    });
  });
  function picked() {
    var ids = [];
    Array.prototype.forEach.call(box.querySelectorAll('.auditPk'), function (c) { if (c.checked) ids.push(c.getAttribute('data-id')); });
    return ids;
  }
  var del = document.getElementById('auditDel');
  if (del) del.addEventListener('click', function () {
    var ids = picked();
    if (!ids.length) { alert('先勾选要删除的规则。'); return; }
    if (!confirm('删除勾选的 ' + ids.length + ' 条规则？可以用「↶ 撤销」找回（仅限本次会话）。')) return;
    pushUndo();
    var m = {}; ids.forEach(function (i) { m[i] = 1; });
    D.rules = D.rules.filter(function (r) { return !m[r.id]; });
    save().then(function () { renderAll(); });
  });
  var mute = document.getElementById('auditMute');
  if (mute) mute.addEventListener('click', function () {
    var ids = picked();
    if (!ids.length) { alert('先勾选要关闭的规则。'); return; }
    pushUndo();
    var m = {}; ids.forEach(function (i) { m[i] = 1; });
    D.rules.forEach(function (r) { if (m[r.id]) r.enabled = false; });
    save().then(function () { renderAll(); });
  });
}

/* =====================================================================
 * 影响面预演（需求 003 建议④）
 * 目的：在「改规则之前」就看清会挡掉谁，而不是改完刷新页面才发现挡多了。
 * 与规则体检的分工：
 *   - 规则体检（renderAudit）：事后找问题 —— 长期 0 命中 / 已经过宽。
 *   - 影响面预演（本函数）：事前算口径 —— 每条规则各命中多少、彼此重叠多少、
 *     哪些条目会被多条规则同时命中（重叠 = 排查误杀的线索）。
 * 数据源只有本机的发现库（D.discovered），不发任何网络请求。
 * ===================================================================== */

// 单条规则在发现库里的命中集合（返回命中的 key 数组 + 该类型总量）
function simHits(r, disc) {
  var t = r.type, out = { keys: [], total: 0 };
  if (t === 'expr') return { keys: [], total: 0, skip: '表达式规则无法用发现库离线演算' };
  if (t === 'code' || t === 'keyword') {
    // 番号/标题词：发现库里没有对应的条目维度（发现库只存 女优/标签/片商/系列/导演）
    return { keys: [], total: 0, skip: '发现库不含该维度数据' };
  }
  var v = String(r.value || '').toLowerCase().trim();
  if (!v) return { keys: [], total: 0, skip: '规则没有主体词' };
  var aliases = (r.aliases || []).map(function (a) { return String(a || '').toLowerCase().trim(); })
    .filter(function (a) { return a; });
  var needles = [v].concat(aliases);
  Object.keys(disc).forEach(function (k) {
    var it = disc[k] || {};
    if ((it.type || '') !== t) return;
    out.total++;
    var hay = String(it.v || '').toLowerCase();
    // match 语义与 content.js 保持一致：contains 子串 / exact 全等 / regex 正则
    var hit = false;
    if (r.match === 'exact') hit = needles.indexOf(hay) !== -1;
    else if (r.match === 'regex') {
      try { var re = new RegExp(v); hit = re.test(String(it.v || '')); } catch (e) { hit = false; }
    } else hit = needles.some(function (n) { return hay.indexOf(n) !== -1; });
    if (hit) out.keys.push(k);
  });
  return out;
}

var SIM_ACTION_LABEL = { block: '屏蔽', favorite: '收藏', highlight: '高亮', hide: '隐藏' };

function runSim() {
  var box = document.getElementById('simBox');
  var sel = document.getElementById('simScope');
  if (!box) return;
  var scope = (sel && sel.value) || 'all';
  var disc = D.discovered || {};
  var discN = Object.keys(disc).length;
  if (!discN) {
    box.innerHTML = '<div class="empty">发现库还是空的 —— 先在监管站点正常浏览几页，扩展会自动积累你刷到的女优 / 标签 / 片商，' +
      '再回来预演就能看到真实的影响面。</div>';
    return;
  }

  var rules = (D.rules || []).filter(function (r) {
    if (scope === 'block') return r.action === 'block';
    if (scope === 'enabled') return r.enabled !== false;
    return true;
  });
  if (!rules.length) {
    box.innerHTML = '<div class="empty">当前范围内没有规则可预演。</div>';
    return;
  }

  // 逐条算命中，同时统计「被几条规则同时命中」用于识别重叠
  var rows = [];
  var hitCount = {};      // discKey → 被多少条规则命中
  var skipped = [];
  rules.forEach(function (r) {
    var h = simHits(r, disc);
    if (h.skip) { skipped.push({ r: r, why: h.skip }); return; }
    h.keys.forEach(function (k) { hitCount[k] = (hitCount[k] || 0) + 1; });
    rows.push({
      r: r, n: h.keys.length, total: h.total,
      ratio: h.total ? h.keys.length / h.total : 0,
      samples: h.keys.slice(0, 5).map(function (k) { return (disc[k] || {}).v || k; }),
    });
  });
  rows.sort(function (a, b) { return b.n - a.n; });

  // 重叠条目：被 ≥2 条规则命中 —— 误杀排查时最先该看的地方
  var overlapped = Object.keys(hitCount).filter(function (k) { return hitCount[k] >= 2; });
  // 重叠条目里按类型取样
  var ovSamples = overlapped.slice(0, 8).map(function (k) {
    return ((disc[k] || {}).v || k) + ' ×' + hitCount[k];
  });

  var blockedTotal = Object.keys(hitCount).length;
  var heavy = rows.filter(function (x) { return x.n >= 8 && x.ratio >= 0.5; });

  var html = '';
  // —— 总览 ——
  html += '<div class="grid" style="margin-bottom:10px">' +
    '<span class="chip" style="background:rgba(0,229,255,.16);color:#9beaff">发现库 ' + discN + ' 条</span>' +
    '<span class="chip" style="background:rgba(255,77,109,.16);color:#ffb3c1">预演规则 ' + rows.length + ' 条</span>' +
    '<span class="chip" style="background:rgba(255,201,60,.16);color:#ffe08a">会被命中 ' + blockedTotal + ' 条</span>' +
    (overlapped.length ? '<span class="chip" style="background:rgba(124,92,255,.18);color:#c9bcff">重叠命中 ' + overlapped.length + ' 条</span>' : '') +
    '</div>';

  if (heavy.length) {
    html += '<div class="tip" style="border-left:3px solid #ff4d6d;padding-left:8px">' +
      '⚠ 有 <b>' + heavy.length + '</b> 条规则命中面偏大（同类条目里有 ≥50% 都会被打中），' +
      '建议先确认是不是「高清」这类通用词。</div>';
  }

  // —— 明细表 ——
  html += '<table><thead><tr><th style="width:150px">规则</th><th style="width:66px">动作</th>' +
    '<th style="width:140px">命中 / 同类总量</th><th>命中样例</th></tr></thead><tbody>';
  rows.forEach(function (x) {
    var pct = Math.round(x.ratio * 100);
    var col = x.n === 0 ? 'color:#888'
      : (x.ratio >= 0.5 ? 'color:#ffb3c1' : 'color:#7ee0a5');
    html += '<tr>' +
      '<td><span class="val">' + esc(x.r.value || '（纯表达式）') + '</span>' +
      (x.r.enabled === false ? ' <span class="chip" style="background:rgba(255,255,255,.08);color:#999">已关</span>' : '') +
      '</td>' +
      '<td><span class="chip type">' + esc(SIM_ACTION_LABEL[x.r.action] || x.r.action || '—') + '</span></td>' +
      '<td><span style="' + col + '">' + x.n + ' / ' + x.total + '（' + pct + '%）</span></td>' +
      '<td><span class="alias">' + esc(x.samples.join(' · ') || '—') + '</span></td></tr>';
  });
  html += '</tbody></table>';

  // —— 重叠清单 ——
  if (overlapped.length) {
    html += '<div class="tip" style="margin-top:12px">以下 <b>' + overlapped.length + '</b> 个条目被多条规则同时命中。' +
      '通常无害，但如果其中某条将来要改成「收藏 / 高亮」，会被前面的屏蔽压过 —— 建议确认优先级。</div>' +
      '<div class="alias">' + esc(ovSamples.join(' · ')) + (overlapped.length > ovSamples.length ? ' …等' : '') + '</div>';
  }

  // —— 跳过说明（透明度：让用户知道哪些规则没算进去，而不是以为"全都很安全"）——
  if (skipped.length) {
    var byWhy = {};
    skipped.forEach(function (s) { (byWhy[s.why] = byWhy[s.why] || []).push(s.r); });
    html += '<div class="tip" style="margin-top:12px">以下 ' + skipped.length + ' 条规则未参与演算：<br>';
    Object.keys(byWhy).forEach(function (w) {
      html += '· ' + esc(w) + '（' + byWhy[w].map(function (r) { return esc(r.value || '表达式'); }).join('、') + '）<br>';
    });
    html += '</div>';
  }

  box.innerHTML = html;
}

function initSim() {
  var btn = document.getElementById('simRun');
  if (!btn) return;
  btn.addEventListener('click', runSim);
  var sel = document.getElementById('simScope');
  if (sel) sel.addEventListener('change', function () {
    // 已经跑过一次的话，切范围就顺带重算，省一次点击
    var box = document.getElementById('simBox');
    if (box && box.querySelector('table')) runSim();
  });
}

// 给出"同类型里也带这个词"的例子，帮用户判断是不是通用词
function sameTypeSamples(r, n) {
  var disc = D.discovered || {};
  var v = String(r.value || '').toLowerCase();
  var out = [];
  Object.keys(disc).forEach(function (k) {
    if (out.length >= n) return;
    var it = disc[k] || {};
    if ((it.type || '') !== r.type) return;
    if (String(it.v || '').toLowerCase().indexOf(v) !== -1) out.push(it.v);
  });
  return out;
}

/* =====================================================================
 * 候选规则（自动学习）
 * 由后台 buildLearned 归纳：你屏蔽的人身上的共同标签/片商/系列。
 * 这里只做展示 + 采纳/忽略，判定逻辑不重复实现。
 * ===================================================================== */
function renderLearn() {
  var box = document.getElementById('learnBox');
  if (!box) return;
  var L = D.learned || {};
  var items = (L.items || []).slice();
  var cnt = document.getElementById('learnCount');
  var cntTxt = document.getElementById('learnCount2');

  // 后台可能还没跑过；给出可操作的提示而不是空白
  if (!L.at) {
    if (cnt) cnt.textContent = '还没生成';
    if (cntTxt) cntTxt.textContent = '';
    box.innerHTML = '<div class="empty">后台还没归纳过。这里的数据由扩展每天自动生成一次；' +
      '也可以点下方按钮立刻算一次（需要先在「发现 &amp; 推荐」里积累一些浏览记录）。</div>' +
      '<div class="grid" style="margin-top:8px"><button id="learnNow">立刻归纳一次</button></div>';
    bindLearnNow();
    return;
  }
  if (cnt) cnt.textContent = items.length ? (items.length + ' 条待定') : '暂无候选';
  if (cntTxt) cntTxt.textContent = '已识别 ' + (L.total || 0) + ' 个条目';

  var when = new Date(L.at).toLocaleString('zh-CN');
  var head = '<div class="tip" style="margin-top:0">归纳时间 ' + esc(when) + ' · 样本 ' + (L.total || 0) + ' 个条目。<br>' +
    '<b>覆盖率</b> = 你屏蔽的人里有多少带这个特征；<b>精确率</b> = 带这个特征的人里有多少被你屏蔽。两者都高才会出现在这里 —— 只看覆盖率会推出「高清」这种没意义的词。</div>';

  if (!items.length) {
    box.innerHTML = head + '<div class="empty">暂时没有新的候选规则。' +
      '多屏蔽几条，或先在「发现 &amp; 推荐」里积累浏览记录，后台下次归纳就能给出建议。</div>' +
      '<div class="grid" style="margin-top:8px"><button id="learnNow">立刻重新归纳</button></div>';
    bindLearnNow();
    return;
  }

  var html = head + '<table><thead><tr><th>建议</th><th style="width:70px">维度</th>' +
    '<th style="width:80px">覆盖率</th><th style="width:80px">精确率</th><th style="width:60px">得分</th>' +
    '<th>证据</th><th style="width:130px">操作</th></tr></thead><tbody>';
  items.forEach(function (it) {
    var act = it.action === 'block' ? '屏蔽' : it.action === 'favorite' ? '收藏' : '高亮';
    html += '<tr>' +
      '<td><span class="chip ' + esc(it.action) + '">' + act + '</span> <span class="val">' + esc(it.value) + '</span></td>' +
      '<td><span class="chip type">' + esc({ tag: '标签', maker: '片商', series: '系列', director: '导演' }[it.dim] || it.dim) + '</span></td>' +
      '<td><span class="chip" style="background:rgba(0,229,255,.14);color:#8beeff">' + it.coverage + '%</span></td>' +
      '<td><span class="chip" style="background:rgba(124,92,255,.18);color:#c9bdff">' + it.precision + '%</span></td>' +
      '<td><b>' + it.score + '</b></td>' +
      '<td><span class="alias">' + esc((it.evidence || []).join(' · ')) + '</span>' +
      (it.seedCount ? '<br><span class="alias">来自 ' + it.seedCount + ' 条已有规则</span>' : '') + '</td>' +
      '<td><button class="mini primary" data-learnok="' + esc(learnKey(it)) + '">采纳</button>' +
      ' <button class="mini" data-learnno="' + esc(learnKey(it)) + '">忽略</button></td></tr>';
  });
  html += '</tbody></table><div class="grid" style="margin-top:8px">' +
    '<button id="learnNow">重新归纳</button>' +
    '<button id="learnClearNo">清空「已忽略」名单</button>' +
    '<span style="flex:1"></span><span class="tip" style="margin:0">采纳 = 直接建成规则（可到规则库调整）；忽略 = 以后不再提这条</span></div>';
  box.innerHTML = html;

  Array.prototype.forEach.call(box.querySelectorAll('[data-learnok]'), function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-learnok');
      var it = items.filter(function (x) { return learnKey(x) === key; })[0];
      if (!it) return;
      var cur = D.rules.filter(function (r) {
        return r.type === it.dim && String(r.value).toLowerCase() === String(it.value).toLowerCase();
      })[0];
      if (cur) { cur.action = it.action; cur.enabled = true; }
      else {
        D.rules.push({
          id: uid(), type: it.dim, value: it.value, aliases: [], action: it.action,
          match: 'contains', scope: SCOPE_OF[it.dim] || 'all', color: D.settings.hlColor,
          sites: [], enabled: true, hits: 0, createdAt: Date.now(),
          learnedFrom: { coverage: it.coverage, precision: it.precision, at: Date.now() }
        });
      }
      // 采纳过的就别再出现在候选里
      D.dismissedLearn = D.dismissedLearn || {};
      D.dismissedLearn[key] = Date.now();
      D.learned.items = items.filter(function (x) { return learnKey(x) !== key; });
      save().then(function () { renderAll(); });
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-learnno]'), function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-learnno');
      D.dismissedLearn = D.dismissedLearn || {};
      D.dismissedLearn[key] = Date.now();
      D.learned.items = items.filter(function (x) { return learnKey(x) !== key; });
      save().then(function () { renderAll(); });
    });
  });
  var clearNo = document.getElementById('learnClearNo');
  if (clearNo) clearNo.addEventListener('click', function () {
    var n = Object.keys(D.dismissedLearn || {}).length;
    if (!n) { alert('「已忽略」名单是空的。'); return; }
    if (!confirm('清空 ' + n + ' 条「已忽略」记录？之后归纳时会重新提出这些建议。')) return;
    D.dismissedLearn = {};
    save().then(function () { renderAll(); });
  });
  bindLearnNow();
}
function learnKey(it) { return (it.action || '') + '|' + (it.dim || '') + '|' + String(it.value || '').toLowerCase(); }
function bindLearnNow() {
  var b = document.getElementById('learnNow');
  if (!b) return;
  b.addEventListener('click', function () {
    b.disabled = true; b.textContent = '归纳中…';
    // 设置页不能直接调后台函数，走消息让 service worker 跑
    try {
      chrome.runtime.sendMessage({ type: 'sf_build_learned' }, function () {
        cfGet(function (d) {
          D.learned = d.learned || {};
          D.dismissedLearn = d.dismissedLearn || {};
          renderLearn();
        });
      });
    } catch (e) {
      alert('无法联系后台，请刷新设置页后重试。');
      b.disabled = false; b.textContent = '重新归纳';
    }
  });
}

/* =====================================================================
 * 场景档位 Profile：一整套规则开关的快照，一键切换
 * 典型用法：「日常」和「临时扫片」两套，后者打开临时屏蔽组。
 * ===================================================================== */
function profileSnapshot() {
  return {
    rules: (D.rules || []).map(function (r) { return { id: r.id, enabled: r.enabled !== false }; }),
    groups: (D.groups || []).map(function (g) { return { id: g.id, on: g.on !== false }; }),
    settings: {
      sfw: !!D.settings.sfw, onlyFav: !!D.settings.onlyFav, firstMatchWins: !!D.settings.firstMatchWins,
      // v6 起 softBlock 变三档 blockDisplay。老档位快照里存的是 softBlock，
      // 读回来时 applyProfile 直接 Object.assign 会把废弃字段写回 settings ——
      // 所以这里在写快照时就把它规范化掉，不产生新旧两套字段并存。
      blockDisplay: BD_VALUES.indexOf(D.settings.blockDisplay) === -1
        ? (D.settings.softBlock ? 'soft' : 'placeholder') : D.settings.blockDisplay,
      previewMode: !!D.settings.previewMode
    }
  };
}
function applyProfile(p) {
  var rm = {}; (p.rules || []).forEach(function (x) { rm[x.id] = x.enabled; });
  (D.rules || []).forEach(function (r) { if (rm[r.id] != null) r.enabled = !!rm[r.id]; });
  var gm = {}; (p.groups || []).forEach(function (x) { gm[x.id] = x.on; });
  (D.groups || []).forEach(function (g) { if (gm[g.id] != null) g.on = !!gm[g.id]; });
  Object.assign(D.settings, p.settings || {});
}
function renderProfiles() {
  var box = document.getElementById('profBox');
  if (!box) return;
  D.profiles = D.profiles || [];
  var list = D.profiles;
  var cnt = document.getElementById('profCount');
  if (cnt) cnt.textContent = list.length ? (list.length + ' 个档位') : '还没有档位';

  if (!list.length) {
    box.innerHTML = '<div class="empty">还没有场景档位。把当前这套规则开关存成一个档位，之后就能一键来回切。</div>' +
      '<div class="grid" style="margin-top:8px">' +
      '<input type="text" id="profName" placeholder="档位名称，如 日常 / 扫片模式" style="width:240px">' +
      '<button class="primary" id="profAdd">以当前状态新建档位</button></div>';
    bindProfAdd();
    return;
  }
  var html = '<table><thead><tr><th style="width:200px">档位</th><th style="width:130px">创建时间</th>' +
    '<th>内容</th><th style="width:230px">操作</th></tr></thead><tbody>';
  list.forEach(function (p) {
    var on = D.activeProfile === p.id;
    var offN = (p.rules || []).filter(function (x) { return x.enabled === false; }).length;
    html += '<tr' + (on ? ' style="background:rgba(0,229,255,.08)"' : '') + '>' +
      '<td>' + (on ? '<span class="chip" style="background:rgba(0,229,255,.2);color:#8beeff">当前</span> ' : '') +
      '<span class="val">' + esc(p.name) + '</span></td>' +
      '<td><span class="alias">' + esc(new Date(p.at).toLocaleDateString('zh-CN')) + '</span></td>' +
      '<td><span class="alias">' + (p.rules || []).length + ' 条规则（关闭 ' + offN + ' 条）· ' +
      (p.groups || []).length + ' 个分组 · SFW ' + ((p.settings || {}).sfw ? '开' : '关') + '</span></td>' +
      '<td><button class="mini primary" data-profapply="' + esc(p.id) + '">切换到这套</button> ' +
      '<button class="mini" data-profupd="' + esc(p.id) + '" title="用当前状态覆盖这个档位">更新</button> ' +
      '<button class="mini" data-profren="' + esc(p.id) + '">改名</button> ' +
      '<button class="mini danger" data-profdel="' + esc(p.id) + '">删除</button></td></tr>';
  });
  html += '</tbody></table><div class="grid" style="margin-top:10px">' +
    '<input type="text" id="profName" placeholder="新档位名称" style="width:200px">' +
    '<button id="profAdd">以当前状态新建档位</button>' +
    '<button id="profReset">清除「当前档位」标记</button></div>' +
    '<div class="tip">档位保存的是「每条规则的启用状态 + 每个分组的开关 + 几个关键行为开关」，不含规则内容本身。' +
    '所以你新增 / 删除规则后，旧档位对这些新规则不做处理（保持现状），不会把规则删掉。</div>';
  box.innerHTML = html;

  Array.prototype.forEach.call(box.querySelectorAll('[data-profapply]'), function (b) {
    b.addEventListener('click', function () {
      var p = list.filter(function (x) { return x.id === b.getAttribute('data-profapply'); })[0];
      if (!p) return;
      pushUndo();
      applyProfile(p);
      D.activeProfile = p.id;
      save().then(function () { renderAll(); });
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-profupd]'), function (b) {
    b.addEventListener('click', function () {
      var p = list.filter(function (x) { return x.id === b.getAttribute('data-profupd'); })[0];
      if (!p) return;
      if (!confirm('用当前状态覆盖档位「' + p.name + '」？')) return;
      var snap = profileSnapshot();
      p.rules = snap.rules; p.groups = snap.groups; p.settings = snap.settings; p.at = Date.now();
      D.activeProfile = p.id;
      save().then(function () { renderAll(); });
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-profren]'), function (b) {
    b.addEventListener('click', function () {
      var p = list.filter(function (x) { return x.id === b.getAttribute('data-profren'); })[0];
      if (!p) return;
      var n = prompt('新的档位名称：', p.name);
      if (n == null || !n.trim()) return;
      p.name = n.trim();
      save().then(function () { renderAll(); });
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-profdel]'), function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-profdel');
      var p = list.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      if (!confirm('删除档位「' + p.name + '」？规则本身不受影响。')) return;
      D.profiles = list.filter(function (x) { return x.id !== id; });
      if (D.activeProfile === id) D.activeProfile = '';
      save().then(function () { renderAll(); });
    });
  });
  var reset = document.getElementById('profReset');
  if (reset) reset.addEventListener('click', function () {
    D.activeProfile = '';
    save().then(function () { renderAll(); });
  });
  bindProfAdd();
}
function bindProfAdd() {
  var b = document.getElementById('profAdd');
  if (!b) return;
  b.addEventListener('click', function () {
    var inp = document.getElementById('profName');
    var name = (inp && inp.value || '').trim();
    if (!name) { alert('先给档位起个名字。'); return; }
    D.profiles = D.profiles || [];
    var snap = profileSnapshot();
    var p = {
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name, at: Date.now(),
      rules: snap.rules, groups: snap.groups, settings: snap.settings
    };
    D.profiles.push(p);
    D.activeProfile = p.id;
    save().then(function () { renderAll(); });
  });
}

/* =====================================================================
 * 月度回顾：把 statsLog 按月汇总，给出环比
 * statsLog 的形状：{ 'YYYY-M-D': { blocked, faved, hl, seen } }（M 不补零）
 * ===================================================================== */
function monthKeyOf(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1);
}
function monthLabel(key) {
  var p = String(key).split('-');
  return p[0] + ' 年 ' + p[1] + ' 月';
}
function collectMonths(n) {
  var out = [];
  var now = new Date();
  for (var i = 0; i < n; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d.getFullYear() + '-' + (d.getMonth() + 1));
  }
  return out;
}
function statsOfMonth(key) {
  var out = { blocked: 0, faved: 0, hl: 0, seen: 0, days: 0 };
  var log = D.statsLog || {};
  var days = {};
  Object.keys(log).forEach(function (k) {
    var p = String(k).split('-');
    if ((p[0] + '-' + String(Number(p[1]))) !== key) return;
    var e = log[k] || {};
    out.blocked += e.blocked || 0;
    out.faved += e.faved || 0;
    out.hl += e.hl || 0;
    out.seen += e.seen || 0;
    days[k] = 1;
  });
  out.days = Object.keys(days).length;
  return out;
}
function fmtDelta(cur, prev) {
  if (!prev) return cur ? '<span class="alias">上月无数据</span>' : '<span class="alias">—</span>';
  var d = Math.round((cur - prev) / prev * 100);
  if (!isFinite(d)) return '<span class="alias">—</span>';
  // 屏蔽/收藏/高亮都是"越多越活跃"，涨用青色，跌用灰 —— 不用红绿（这里没有好坏之分）
  var color = d > 0 ? '#8beeff' : (d < 0 ? '#8b93a7' : '#6f7893');
  return '<span class="alias" style="color:' + color + '">' + (d > 0 ? '+' : '') + d + '%</span>';
}
function renderMonthly() {
  var box = document.getElementById('monthBox');
  if (!box) return;
  var months = collectMonths(6);
  var has = false;
  var rows = months.map(function (k) {
    var s = statsOfMonth(k);
    if (s.blocked || s.faved || s.hl || s.seen) has = true;
    return { k: k, s: s, prev: null };
  });
  for (var i = 0; i < rows.length; i++) rows[i].prev = rows[i + 1] ? rows[i + 1].s : null;

  var cnt = document.getElementById('monthCount');
  var thisOne = rows[0].s;
  var totalAct = thisOne.blocked + thisOne.faved + thisOne.hl;
  if (cnt) cnt.textContent = totalAct ? (monthLabel(rows[0].k) + '：共 ' + totalAct + ' 次动作') : '本月还没有动作记录';

  if (!has) {
    box.innerHTML = '<div class="empty">还没有统计数据。数据来自你在页面上的实际操作（屏蔽 / 收藏 / 高亮 / 标记已看），' +
      '攒够一个月这里就会有环比图。</div>';
    return;
  }

  // ① 本月概览
  var cur = rows[0].s, prev = rows[1] ? rows[1].s : null;
  var html = '<div class="grid" style="gap:10px 22px">' +
    card('屏蔽', cur.blocked, prev && prev.blocked) +
    card('收藏', cur.faved, prev && prev.faved) +
    card('高亮', cur.hl, prev && prev.hl) +
    card('标记已看', cur.seen, prev && prev.seen) +
    '</div>' +
    '<div class="tip" style="margin-top:10px">本月有动作的天数 <b>' + cur.days + '</b> 天' +
    (cur.days ? '，平均每天 ' + (totalAct / cur.days).toFixed(1) + ' 次动作' : '') + '。</div>';

  // ② 近 6 个月柱状（用 flex 柱，不用 canvas，方便跟随主题色）
  var maxV = 1;
  rows.slice().reverse().forEach(function (r) { maxV = Math.max(maxV, r.s.blocked, r.s.faved, r.s.hl); });
  html += '<div style="margin-top:14px"><div style="font-size:12px;color:#8b93a7;margin-bottom:8px">近 6 个月动作量（堆叠：屏蔽 / 收藏 / 高亮）</div>' +
    '<div style="display:flex;align-items:flex-end;gap:14px;height:150px;padding:0 4px">';
  rows.slice().reverse().forEach(function (r) {
    var t = r.s.blocked + r.s.faved + r.s.hl;
    var hb = r.s.blocked / maxV * 110, hf = r.s.faved / maxV * 110, hh = r.s.hl / maxV * 110;
    var isCur = r.k === rows[0].k;
    html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px">' +
      '<div style="width:100%;display:flex;flex-direction:column;justify-content:flex-end;height:112px" title="' +
      monthLabel(r.k) + '：屏蔽 ' + r.s.blocked + ' / 收藏 ' + r.s.faved + ' / 高亮 ' + r.s.hl + '">' +
      '<div style="height:' + hh + 'px;background:#7c5cff;border-radius:3px 3px 0 0"></div>' +
      '<div style="height:' + hf + 'px;background:#ff9f1c"></div>' +
      '<div style="height:' + hb + 'px;background:#ff4d6d"></div>' +
      '</div>' +
      '<span style="font-size:11px;color:' + (isCur ? '#8beeff' : '#6f7893') + '">' + r.k.split('-')[1] + ' 月</span>' +
      '<span style="font-size:11px;color:#6f7893">' + t + '</span></div>';
  });
  html += '</div><div class="tip" style="display:flex;gap:16px;margin-top:6px">' +
    '<span><span style="display:inline-block;width:9px;height:9px;background:#ff4d6d;border-radius:2px;margin-right:5px"></span>屏蔽</span>' +
    '<span><span style="display:inline-block;width:9px;height:9px;background:#ff9f1c;border-radius:2px;margin-right:5px"></span>收藏</span>' +
    '<span><span style="display:inline-block;width:9px;height:9px;background:#7c5cff;border-radius:2px;margin-right:5px"></span>高亮</span>' +
    '</div></div>';

  // ③ 本月命中最多的规则（用 lastHit 落在本月的规则近似，hits 是累计值不是月增量）
  var mk = rows[0].k;
  var top = (D.rules || []).filter(function (r) {
    if (!r.lastHit) return false;
    return monthKeyOf(r.lastHit) === mk;
  }).sort(function (a, b) { return (b.hits || 0) - (a.hits || 0); }).slice(0, 5);
  html += '<div style="margin-top:16px"><div style="font-size:12px;color:#8b93a7;margin-bottom:6px">本月还在命中的规则 Top 5</div>';
  if (!top.length) {
    html += '<div class="empty">本月没有规则命中记录。</div>';
  } else {
    html += '<table><thead><tr><th>规则</th><th style="width:74px">动作</th>' +
      '<th style="width:90px">累计命中</th><th style="width:130px">最近命中</th></tr></thead><tbody>';
    top.forEach(function (r) {
      html += '<tr><td><span class="val">' + esc(r.value || '（纯表达式）') + '</span></td>' +
        '<td><span class="chip ' + esc(r.action) + '">' + (r.action === 'block' ? '屏蔽' : r.action === 'favorite' ? '收藏' : '高亮') + '</span></td>' +
        '<td>' + (r.hits || 0) + '</td>' +
        '<td><span class="alias">' + esc(relTime(r.lastHit)) + '</span></td></tr>';
    });
    html += '</tbody></table>';
  }
  html += '<div class="tip">说明：这里的「累计命中」是该规则从建立至今的总次数，不是本月增量 —— 逐月增量没有单独记录，' +
    '用「最近命中时间落在本月」来筛选本月还活跃的规则。</div></div>';

  box.innerHTML = html;

  function card(label, v, pv) {
    return '<div style="min-width:120px"><div style="font-size:12px;color:#8b93a7">' + label + '</div>' +
      '<div style="font-size:22px;font-weight:600;color:#e8ecf6;line-height:1.3">' + v + '</div>' +
      '<div>' + (pv == null ? '<span class="alias">上月无数据</span>' : fmtDelta(v, pv)) + '</div></div>';
  }
}

function renderAll() {
  renderRules();
  renderGroups();
  renderSites();
  renderTemplates();
  renderRulePacks();
  renderDiscStats();
  renderErrLog();
  renderFavCodes();
  renderDisc();
  renderDashboard();
  renderConflicts();
  renderBackup();
  renderPartial();
  renderSwitches();
  renderBdSel();
  renderBfSel();
  renderColorDots();
  renderRec();
  renderSync();
  renderPeeks();
  renderKeys();
  renderExprTest();
  renderAudit();
  initSim();
  renderLearn();
  renderProfiles();
  renderMonthly();
  var seenN = Object.keys(D.seen || {}).length;
  document.getElementById('dataTip').textContent =
    '当前：规则 ' + D.rules.length + ' 条 · 分组 ' + (D.groups || []).length + ' 个 · 站点 ' + D.sites.length +
    ' 个 · 番号收藏 ' + Object.keys(D.favCodes || {}).length + ' 部 · 已看记录 ' + seenN + ' 条';
  var st = document.getElementById('schemaTag');
  if (st) st.textContent = '数据结构 v' + (D.schemaVersion || SCHEMA_VERSION);
}

['peekHours'].forEach(function (id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', function () {
    D.settings.peekHours = Math.max(1, parseInt(el.value, 10) || 24);
    save().then(renderPeeks);
  });
  el.addEventListener('input', function () {
    D.settings.peekHours = Math.max(1, parseInt(el.value, 10) || 24);
    save().then(renderPeeks);
  });
});
(function () {
  var b = document.getElementById('peekClearAll');
  if (b) b.addEventListener('click', function () {
    if (!confirm('清空全部「仍然查看」放行记录？清空后这些番号会重新被屏蔽。')) return;
    D.peeks = {};
    save().then(renderPeeks);
  });
})();

get().then(renderAll);
