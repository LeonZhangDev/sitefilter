/* SiteFilter 数据版本 / 迁移 / 错误日志 专项测试
   验证：
   ① 旧数据（无 schemaVersion）载入后被自动迁移到当前版本
   ② 迁移是幂等的（跑两次结果一致，且不破坏既有数据）
   ③ 迁移会把新增字段补齐（watchlist / cooc / peeks / errLog …）
   ④ 来自更高版本的数据不崩溃，只记一条错误日志
   ⑤ logErr 写入并做长度裁剪（ERR_MAX）
   用 vm 直接跑 background.js（它同时暴露 migrate / logErr / getData）。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

function load(seed) {
  const store = JSON.parse(JSON.stringify(seed));
  const chrome = {
    storage: {
      local: {
        get: (key, cb) => { cb({ [key]: store[key] }); },
        set: (obj, cb) => { Object.keys(obj).forEach(k => store[k] = obj[k]); if (cb) cb(); },
      },
      onChanged: { addListener() { } },
    },
    action: { setBadgeText() { }, setBadgeBackgroundColor() { } },
    runtime: {
      onMessage: { addListener() { } }, onInstalled: { addListener() { } },
      onStartup: { addListener() { } }, openOptionsPage() { }, sendMessage() { },
    },
    alarms: { create() { }, onAlarm: { addListener() { } } },
    notifications: { create() { }, onClicked: { addListener() { } } },
    contextMenus: { removeAll(cb) { if (cb) cb(); }, create() { }, onClicked: { addListener() { } } },
  };
  const code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  const ctx = {
    chrome, console, Date, Math, Object, Array, JSON, parseInt, String, Promise, URL, setTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, store };
}

/* ============ ① 旧数据（v1，无 schemaVersion）自动迁移 ============ */
{
  const { ctx } = load({
    sf_data_v1: {
      settings: { enabled: true },
      sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true }],
      rules: [{ id: 'r1', type: 'actress', value: '旧规则', action: 'block', enabled: true }],
      seen: { 'OLD-001': 1700000000000 },
      discovered: { 'actress|老人': { v: '老人', type: 'actress', n: 5, first: 1, last: 2 } },
      // 故意不提供 schemaVersion / watchlist / cooc / peeks / errLog
    },
  });

  check('migrate 已暴露在 vm 全局', typeof ctx.migrate === 'function');
  check('SCHEMA_VERSION 已暴露', typeof ctx.SCHEMA_VERSION === 'number');

  const before = {
    sites: 1,
    rules: 1,
  };
  const migrated = ctx.migrate({
    sites: [{ id: 's1' }], rules: [{ id: 'r1' }],
    seen: { 'OLD-001': 1700000000000 },
    discovered: { 'actress|老人': { v: '老人', n: 5 } },
  });

  check('迁移后写入 schemaVersion = 当前版本', migrated.schemaVersion === ctx.SCHEMA_VERSION);
  check('迁移补齐 watchlist', !!migrated.watchlist && typeof migrated.watchlist === 'object');
  check('迁移补齐 cooc', !!migrated.cooc && typeof migrated.cooc === 'object');
  check('迁移补齐 peeks', !!migrated.peeks && typeof migrated.peeks === 'object');
  check('迁移补齐 errLog（数组）', Array.isArray(migrated.errLog));
  check('迁移补齐 statsLog / groups / dailyRecs',
    !!migrated.statsLog && Array.isArray(migrated.groups) && !!migrated.dailyRecs);
  check('迁移保留原有 sites（不被清空/覆盖）', (migrated.sites || []).some(s => s.id === 's1'));
  // v5 起迁移会顺带补齐新增的默认站点，所以总数会增加而不是保持不变
  check('迁移顺带补齐默认站点', (migrated.sites || []).length > before.sites);
  check('迁移保留原有 rules', (migrated.rules || []).length === before.rules);
  check('迁移保留原有 seen', !!migrated.seen['OLD-001']);
  check('迁移保留原有 discovered', !!migrated.discovered['actress|老人']);
}

/* ============ ② 幂等：迁移两次结果一致 ============ */
{
  const { ctx } = load({ sf_data_v1: { settings: {} } });
  const once = ctx.migrate({ seen: { A: 1 }, watchlist: { X: { t: 'x' } } });
  const twice = ctx.migrate(JSON.parse(JSON.stringify(once)));
  check('迁移幂等：两次结果深度一致', JSON.stringify(once) === JSON.stringify(twice));
  check('幂等不丢已有 watchlist', !!twice.watchlist.X);
  check('幂等不丢已有 seen', twice.seen.A === 1);
}

/* ============ ③b v2 → v3：补 settings.keys 与 rule.expr ============ */
{
  const { ctx } = load({ sf_data_v1: { settings: {}, schemaVersion: 2 } });
  check('当前 SCHEMA_VERSION 至少是 3', ctx.SCHEMA_VERSION >= 3);

  const v2 = {
    schemaVersion: 2,
    settings: { enabled: true },
    rules: [
      { id: 'r1', type: 'actress', value: 'A', action: 'block', enabled: true },   // 无 expr 字段
      { id: 'r2', type: 'expr', value: 'B', expr: 'rating >= 4', action: 'highlight', enabled: true },
    ],
  };
  const v3 = ctx.migrate(JSON.parse(JSON.stringify(v2)));

  check('v3 迁移后版本号继续跟进（不写死具体数字）', v3.schemaVersion === ctx.SCHEMA_VERSION);
  check('v3 迁移补齐 settings.keys（对象）', !!v3.settings.keys && typeof v3.settings.keys === 'object');
  check('v3 迁移把缺 expr 的规则补成空串', v3.rules[0].expr === '');
  check('v3 迁移不覆盖已有的 expr', v3.rules[1].expr === 'rating >= 4');
  check('v3 迁移保留 settings 里其它字段', v3.settings.enabled === true);
  check('v3 迁移幂等：再跑一次结果一致',
    JSON.stringify(ctx.migrate(JSON.parse(JSON.stringify(v3)))) === JSON.stringify(v3));
}

/* ============ ③c v3 → v4：临时规则有效期 + 自动学习 + 场景档位 ============ */
{
  const { ctx } = load({ sf_data_v1: { settings: {}, schemaVersion: 3 } });
  check('当前 SCHEMA_VERSION 至少是 4', ctx.SCHEMA_VERSION >= 4);

  const v3 = {
    schemaVersion: 3,
    settings: { enabled: true, keys: { next: 'j' } },
    rules: [
      { id: 'r1', type: 'actress', value: 'A', action: 'block', enabled: true, expr: '' },  // 无 expiresAt
      { id: 'r2', type: 'tag', value: 'B', action: 'block', enabled: true, expr: '', expiresAt: 123 }
    ],
    groups: [{ id: 'g1', name: '临时', on: true }]
  };
  const v4 = ctx.migrate(JSON.parse(JSON.stringify(v3)));

  check('v4 迁移后版本号 = 当前版本', v4.schemaVersion === ctx.SCHEMA_VERSION);
  check('v4 迁移把缺 expiresAt 的规则补成 0（永久）', v4.rules[0].expiresAt === 0);
  check('v4 迁移不覆盖已有的 expiresAt', v4.rules[1].expiresAt === 123);
  check('v4 迁移补齐 learned（对象）', !!v4.learned && typeof v4.learned === 'object');
  check('v4 迁移补齐 dismissedLearn（对象）', !!v4.dismissedLearn && typeof v4.dismissedLearn === 'object');
  check('v4 迁移补齐 profiles（数组）', Array.isArray(v4.profiles));
  check('v4 迁移补齐 activeProfile（字符串）', v4.activeProfile === '');
  check('v4 迁移补齐 expiredLog（数组）', Array.isArray(v4.expiredLog));
  check('v4 迁移补 autoSeen / auditWarn 默认开', v4.settings.autoSeen === true && v4.settings.auditWarn === true);
  check('v4 迁移不覆盖已有的 settings.keys', v4.settings.keys.next === 'j');
  check('v4 迁移保留 groups', (v4.groups || []).length === 1);
  check('v4 迁移幂等：再跑一次结果一致',
    JSON.stringify(ctx.migrate(JSON.parse(JSON.stringify(v4)))) === JSON.stringify(v4));
}

/* ============ ③d 临时规则到期清理（purgeExpiredRules） ============ */
{
  const seedRule = (id, exp) => ({ id, type: 'actress', value: id, action: 'block', enabled: true, expr: '', expiresAt: exp });
  const { ctx, store } = load({
    sf_data_v1: {
      settings: {}, schemaVersion: 4,
      rules: [
        seedRule('rAlive', 0),                          // 永久
        seedRule('rDead', Date.now() - 1000),           // 已过期
        seedRule('rFuture', Date.now() + 86400000)      // 明天到期
      ]
    }
  });
  check('purgeExpiredRules 已暴露', typeof ctx.purgeExpiredRules === 'function');
  Promise.resolve(ctx.purgeExpiredRules()).then(res => {
    check('purgeExpiredRules 报告移除了 1 条', res && res.removed === 1);
    setTimeout(() => {
      const d = store.sf_data_v1 || {};
      const ids = (d.rules || []).map(r => r.id).sort();
      check('清理后只剩永久与未到期两条', ids.join(',') === 'rAlive,rFuture');
      check('过期规则被记入 expiredLog', Array.isArray(d.expiredLog) && d.expiredLog.length === 1 &&
        d.expiredLog[0].value === 'rDead');
      check('expiredLog 条目带过期时间戳', typeof d.expiredLog[0].expiredAt === 'number');
    }, 60);
  }).catch(e => check('purgeExpiredRules 未抛错（' + (e && e.message) + '）', false));
}

/* ============ ③ 已有新字段不被覆盖 ============ */
{
  const { ctx } = load({ sf_data_v1: { settings: {} } });
  const kept = ctx.migrate({
    watchlist: { 'K-001': { t: 'keep', at: 123 } },
    cooc: { '某人': { tag: { '丝袜': 3 } } },
    peeks: { 'P-001': 999 },
    errLog: [{ t: 1, w: 'old', m: 'x' }],
  });
  check('迁移不覆盖已存在的 watchlist', !!kept.watchlist['K-001']);
  check('迁移不覆盖已存在的 cooc', kept.cooc['某人'].tag['丝袜'] === 3);
  check('迁移不覆盖已存在的 peeks', kept.peeks['P-001'] === 999);
  check('迁移不覆盖已存在的 errLog', (kept.errLog || []).length === 1);
}

/* ============ ③z 三个文件的 SCHEMA_VERSION 必须一致 ============
   这是踩过的坑：content.js / background.js / options.js 各有一份 migrate，
   只改其中一两处的版本号，最轻是"迁移白跑一遍"，最重是
   content.js 用旧版本号写回 → 把数据降级（新字段在下次读时又被"补空"覆盖）。 */
{
  const pick = (file, re) => {
    const s = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const m = s.match(re);
    return m ? Number(m[1]) : NaN;
  };
  const vContent = pick('content.js', /var SCHEMA_VERSION = (\d+);/);
  const vBg = pick('background.js', /var SCHEMA_VERSION = (\d+);/);
  const vOpt = pick('options.js', /var SCHEMA_VERSION = (\d+);/);
  check('content.js 声明了 SCHEMA_VERSION', Number.isFinite(vContent));
  check('background.js 声明了 SCHEMA_VERSION', Number.isFinite(vBg));
  check('options.js 声明了 SCHEMA_VERSION', Number.isFinite(vOpt));
  check('三处 SCHEMA_VERSION 完全一致（' + [vContent, vBg, vOpt].join(' / ') + '）',
    vContent === vBg && vBg === vOpt);
  // 版本号还要等于运行时真正用的那个（从 background.js 的 vm 里读，最接近真相）
  {
    const { ctx: probe } = load({ sf_data_v1: { settings: {} } });
    check('background.js 的版本号与运行时一致', vBg === probe.SCHEMA_VERSION);
  }
  check('content.js 里也补了 step 4 的迁移', /4:\s*function\s*\(/.test(
    fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8')));

  // 每处 migrate 都要有对应的 step 函数，不能只改版本号忘了补步骤
  ['content.js', 'background.js', 'options.js'].forEach(f => {
    const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (let v = 2; v <= vBg; v++) {
      const has = new RegExp('(^|[^0-9])' + v + ':\\s*function\\s*\\(').test(s);
      check(f + ' 的 migrate 里有 step ' + v, has);
    }
  });
}

/* ============ ③y 各文件 getData/get() 都要挂上新字段 ============ */
{
  const must = ['learned', 'dismissedLearn', 'profiles', 'activeProfile', 'expiredLog'];
  ['content.js', 'background.js', 'options.js'].forEach(f => {
    const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
    must.forEach(k => {
      // 允许 obj.k / x.k / d.k = d.k || 默认值 这些写法
      const re = new RegExp('\\b' + k + '\\s*[:=]');
      check(f + ' 里出现字段 ' + k + '（防整体写回丢字段）', re.test(s));
    });
  });
}

/* ============ ③x 三处「默认设置 / 默认键位」必须一致 ============
   content.js / background.js / options.js 各存一份 DEFAULT_SETTINGS 与
   DEFAULT_KEYS。漏改一处的表现很隐蔽：设置页上开关不显示、或者快捷键
   按下去没反应（会被 normKeys 静默回落成默认值）。 */
{
  const src = {};
  ['content.js', 'background.js', 'options.js'].forEach(f => {
    src[f] = fs.readFileSync(path.join(__dirname, f), 'utf8');
  });

  // 本轮新增：ballLock（锁定悬浮球位置）
  ['content.js', 'background.js', 'options.js'].forEach(f => {
    check(f + ' 的 DEFAULT_SETTINGS 带 ballLock', /ballLock:\s*false/.test(src[f]));
  });

  const keyNames = (s) => {
    const m = s.match(/var DEFAULT_KEYS = \{[\s\S]*?\};/);
    if (!m) return [];
    return (m[0].match(/([a-zA-Z]+):\s*'[a-z0-9]+'/g) || [])
      .map(x => x.split(':')[0].trim()).sort();
  };
  const kc = keyNames(src['content.js']);
  const ko = keyNames(src['options.js']);
  check('content.js 解析出 DEFAULT_KEYS（' + kc.join(',') + '）', kc.length >= 8);
  check('content.js 与 options.js 的 DEFAULT_KEYS 键名完全一致',
    kc.length > 0 && kc.join('|') === ko.join('|'));
  check('默认键位含 lock（Alt+L 锁球）', kc.indexOf('lock') !== -1 && ko.indexOf('lock') !== -1);
  check('content.js 处理了 Alt+L', /keyOf\('lock'\)/.test(src['content.js']));
  check('设置页开关列表含 ballLock', /\['ballLock',/.test(src['options.js']));
  check('content.js 拖动前检查 ballLock', /if \(S\.settings\.ballLock\) return;/.test(src['content.js']));
  check('content.js 有锁定状态的球体样式', /\.cf-ball\.locked/.test(src['content.js']));
}

/* ============ ④ 更高版本数据：不崩，只记日志 ============ */
{
  const { ctx, store } = load({ sf_data_v1: { settings: {}, schemaVersion: 99 } });
  let threw = false;
  try { ctx.migrate({ schemaVersion: 99 }); } catch (e) { threw = true; }
  check('来自更高版本的数据不抛异常', !threw);

  const log = [];
  check('logErr 函数存在', typeof ctx.logErr === 'function');
  ctx.logErr('unit-test', new Error('boom'));
  setTimeout(() => {
    const saved = (store.sf_data_v1 && store.sf_data_v1.errLog) || [];
    check('logErr 写入 errLog（含位置与信息）',
      saved.length >= 1 && saved.some(e => e.w === 'unit-test' && /boom/.test(e.m)));
    if (saved.length) {
      console.log('      errLog[0] =', JSON.stringify(saved[0]));
      check('errLog 条目带时间戳', typeof saved[0].t === 'number' && saved[0].t > 0);
    }

    /* ============ ⑤ 长度裁剪 ============ */
    const { ctx: ctx2, store: store2 } = load({ sf_data_v1: { settings: {} } });
    for (let i = 0; i < 260; i++) ctx2.logErr('bulk', new Error('e' + i));
    setTimeout(() => {
      const arr = (store2.sf_data_v1 && store2.sf_data_v1.errLog) || [];
      check('errLog 做了长度裁剪（不超过 ERR_MAX）', arr.length <= 200);
      check('裁剪后保留的是最近记录', arr.length > 0 && /e259/.test(arr[arr.length - 1].m));
      console.log('      裁剪后条数 =', arr.length, '(ERR_MAX =', ctx2.ERR_MAX, ')');

      console.log(pass ? '\n迁移 / 错误日志测试全部通过 ✅' : '\n迁移 / 错误日志测试存在失败 ❌');
      process.exit(pass ? 0 : 1);
    }, 400);
  }, 300);
}
