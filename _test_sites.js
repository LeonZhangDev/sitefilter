/* SiteFilter 站点模板专项测试
 *
 * 为什么要有这套测试：站点信息曾经散在 5 处（content 的 DEFAULT_SITES / KNOWN_SELECTORS /
 * SELECTOR_TEMPLATES / CODE_SITES，background 的 DEFAULT_SITES，options 的 TPL_SELECTORS），
 * 加一个站要改 4 个地方，漏一处就表现为「面板能开但识别不出卡片」这种静默失效。
 * 现在 content.js 的 SITE_TEMPLATES 是唯一事实来源，其余全是派生或副本 ——
 * 本文件用断言把「派生正确」和「副本没走偏」钉死。
 *
 * 不需要 jsdom：直接从源码里切出声明体在 vm 里求值时即可（content.js 整体是 IIFE，
 * 顶层 var 拿不到，所以走源码切片这条路）。node 直接跑。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

const SRC = {
  content: fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8'),
  background: fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'),
  options: fs.readFileSync(path.join(__dirname, 'options.js'), 'utf8'),
};

/* 从源码里按名字切出「var NAME = <声明体>」的声明体（括号 / 字符串 / 正则都按平衡处理） */
function decl(code, name) {
  const marker = 'var ' + name + ' =';
  const i = code.indexOf(marker);
  if (i < 0) return null;
  let depth = 0, started = false, inStr = null, inLC = false, inBC = false;
  let buf = '';
  for (let j = i + marker.length; j < code.length; j++) {
    const c = code[j], p = j > 0 ? code[j - 1] : '';
    if (inLC) { if (c === '\n') inLC = false; continue; }
    if (inBC) { if (c === '/' && p === '*') inBC = false; continue; }
    if (inStr) {
      buf += c;
      if (c === '\\') { buf += code[j + 1]; j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && code[j + 1] === '/') { inLC = true; continue; }
    if (c === '/' && code[j + 1] === '*') { inBC = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; started = true; buf += c; continue; }
    if (c === '/' && regexStart(buf)) {
      buf += c;
      let k = j + 1, inCls = false;
      for (; k < code.length; k++) {
        const ch = code[k];
        buf += ch;
        if (ch === '\\') { buf += code[k + 1]; k++; continue; }
        if (ch === '[') inCls = true;
        else if (ch === ']') inCls = false;
        else if (ch === '/' && !inCls) break;
        else if (ch === '\n') break;
      }
      j = k;
      while (j + 1 < code.length && /[gimsuyd]/.test(code[j + 1])) { buf += code[j + 1]; j++; }
      started = true;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; started = true; buf += c; continue; }
    // 注意：只能在 depth 归零「且遇到分号」时才结束。
    // 诸如 X.filter(...).map(...) 的链式写法里，filter 的 ) 也会让 depth 回到 0，
    // 若在那时就返回会把后面的 .map 整段切掉。
    if (c === ')' || c === ']' || c === '}') { depth--; buf += c; continue; }
    if (c === ';' && depth === 0 && started) return buf;
    if (!started && /\s/.test(c)) continue;
    started = true; buf += c;
  }
  return null;
}
// 判断当前 '/' 是不是正则开头（前一个有效字符是运算符/括号/冒号/逗号等）
function regexStart(buf) {
  const m = buf.match(/\S/g);
  const last = m ? m[m.length - 1] : '';
  return last === '' || '(,=:[!&|?{};+-*%~^'.indexOf(last) !== -1;
}

function evalDecls(file, names) {
  const ctx = vm.createContext({ console });
  names.forEach(n => {
    const body = decl(SRC[file], n);
    if (!body) throw new Error('未能从 ' + file + ' 里切出声明: ' + n);
    vm.runInContext('var ' + n + ' = ' + body + ';', ctx);
  });
  return ctx;
}

/* ============ ① 模板表自身 ============ */
const C = evalDecls('content', ['SITE_TEMPLATES', 'LINK_KINDS', 'DEFAULT_SITES', 'KNOWN_SELECTORS', 'SELECTOR_TEMPLATES', 'CODE_SITES', 'MIRROR_GROUPS']);
const T = C.SITE_TEMPLATES;

check('能切出 SITE_TEMPLATES', Array.isArray(T) && T.length > 0);
check('模板 id 唯一', new Set(T.map(t => t.id)).size === T.length);
// vm 是另一个 realm，instanceof 会失效，用 toString 判定
const isRe = x => Object.prototype.toString.call(x) === '[object RegExp]';
check('进监管列表的模板都有 pattern 和 host',
  T.filter(t => t.enabled).every(t => !!t.pattern && isRe(t.host)));
check('所有模板都有 host 正则', T.every(t => isRe(t.host)));

const byId = id => T.filter(t => t.id === id)[0];
const NEW = ['s_pornhub', 's_youporn', 's_xsijishe'];
NEW.forEach(id => check('新增站点 ' + id + ' 在模板表里且默认启用', !!byId(id) && byId(id).enabled === true));

const ph = byId('s_pornhub'), yp = byId('s_youporn'), xs = byId('s_xsijishe');

/* ============ ② 三个新站的维度映射（决定面板里有没有东西） ============ */
function kindOf(tpl, href) {
  const kinds = (tpl.dims || []).concat(C.LINK_KINDS);
  for (const k of kinds) if (k.href.test(href)) return k.kind;
  return null;
}
check('PornHub /pornstar/ 归到 actress', kindOf(ph, '/pornstar/ella-hughes') === 'actress');
check('PornHub /categories/ 归到 tag', kindOf(ph, '/categories/bdsm') === 'tag');
check('PornHub /channels/ 归到 maker', kindOf(ph, '/channels/brazzers') === 'maker');
check('YouPorn /pornstar/ 归到 actress', kindOf(yp, '/pornstar/ella-hughes') === 'actress');
check('YouPorn /categories/ 归到 tag', kindOf(yp, '/categories/amateur') === 'tag');
check('xsijishe forum- 归到 tag', kindOf(xs, 'forum-12-1.html') === 'tag');
check('xsijishe space-uid- 归到 actress（发帖人）', kindOf(xs, 'space-uid-12345.html') === 'actress');

/* ============ ③ 番号猜测与非卡片墙模式 ============ */
check('xsijishe 是 rowMode（论坛表格行，没有图片）', xs.rowMode === true);
check('xsijishe 标记 code:false，不从 thread- 链接猜番号', xs.code === false);
check('PornHub 标记 code:false', ph.code === false);
check('JavBus 仍是 code:true', byId('s_javbus').code === true);

/* ============ ④ 派生结果 ============ */
check('默认监管站点 8 个', C.DEFAULT_SITES.length === 8);
check('默认站点含三个新站', NEW.every(id => C.DEFAULT_SITES.some(s => s.id === id)));
check('默认站点 note 都非空', C.DEFAULT_SITES.every(s => !!s.note));
check('默认站点都是 enabled', C.DEFAULT_SITES.every(s => s.enabled === true));
check('KNOWN_SELECTORS 由模板派生且非空', Array.isArray(C.KNOWN_SELECTORS) && C.KNOWN_SELECTORS.length >= 8);
check('KNOWN_SELECTORS 覆盖全部默认站的 host',
  C.DEFAULT_SITES.every(s => C.KNOWN_SELECTORS.some(k => k.test.test(
    String(s.pattern).replace(/^\*:\/\/\*\./, 'www.').replace(/\/\*$/, '')))));
check('CODE_SITES 由模板派生（含 PH / YP）',
  C.CODE_SITES.some(c => c.n === 'PH') && C.CODE_SITES.some(c => c.n === 'YP'));
check('CODE_SITES 保留原有四个入口',
  ['Bus', 'DB', '580', 'XC'].every(n => C.CODE_SITES.some(c => c.n === n)));

/* 设置页「套用模板」靠 tplTest 去匹配站点 pattern —— 这个值坏掉会静默失效 */
const withTpl = T.filter(t => t.tpl);
check('带 tpl 的模板都显式给了 tplTest', withTpl.every(t => !!t.tplTest));
check('tplTest 不含正则残留字符（防匹配失效）',
  withTpl.every(t => !/[()|\\^$?*+[\]{}]/.test(t.tplTest)));
check('SELECTOR_TEMPLATES 由模板派生', C.SELECTOR_TEMPLATES.length === withTpl.length);

/* ============ ⑤ 三处副本必须一致（这是本套测试最想守住的一条） ============ */
const B = evalDecls('background', ['DEFAULT_SITES']);
const O = evalDecls('options', ['DEFAULT_SITES_OPTIONS', 'TPL_SELECTORS']);

const key = s => s.id + '|' + s.pattern + '|' + s.note;
// 顺序不影响语义（站点是集合），按 key 排序后再比
const sortKeys = arr => arr.map(key).sort().join(',');
const cKeys = sortKeys(C.DEFAULT_SITES);
check('background.js 的 DEFAULT_SITES 与 content.js 派生结果一致',
  sortKeys(B.DEFAULT_SITES) === cKeys);
check('options.js 的 DEFAULT_SITES_OPTIONS 与 content.js 派生结果一致',
  sortKeys(O.DEFAULT_SITES_OPTIONS) === cKeys);

const tkey = t => t.name + '|' + t.test + '|' + t.sel;
check('options.js 的 TPL_SELECTORS 与 content.js 的 SELECTOR_TEMPLATES 一致',
  O.TPL_SELECTORS.map(tkey).join(',') === C.SELECTOR_TEMPLATES.map(tkey).join(','));
check('TPL_SELECTORS 含三个新站的模板',
  ['pornhub', 'youporn', 'xsijishe'].every(k => O.TPL_SELECTORS.some(t => t.test === k)));

/* ============ ⑥ 三处版本号与迁移步（与 _test_migrate 的守卫互补：这里只管 v5 / v6） ============ */
const vOf = f => { const m = SRC[f].match(/var SCHEMA_VERSION = (\d+);/); return m ? Number(m[1]) : NaN; };
check('三处 SCHEMA_VERSION 都是 6',
  vOf('content') === 6 && vOf('background') === 6 && vOf('options') === 6);
// v5：站点模板化（本站测试的主角）；v6：屏蔽三档 blockDisplay
[[5, '站点模板化'], [6, '屏蔽三档 blockDisplay']].forEach(([v, why]) => {
  ['content', 'background', 'options'].forEach(f => {
    check(f + '.js 的 migrate 里有 step ' + v + '（' + why + '）',
      new RegExp('(^|[^0-9])' + v + ':\\s*function\\s*\\(').test(SRC[f]));
  });
});

/* ============ ⑦ 迁移行为：老用户（v4）能拿到新增站点 ============ */
{
  const chrome = {
    storage: {
      local: {
        get: (k, cb) => { cb({ [k]: undefined }); },
        set: (o, cb) => { if (cb) cb(); },
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
  const ctx = { chrome, console, Date, Math, Object, Array, JSON, parseInt, String, Promise, URL, setTimeout };
  vm.createContext(ctx);
  vm.runInContext(SRC.background, ctx);

  const old5 = [
    { id: 's_javbus', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' },
    { id: 's_xchina', pattern: '*://*.xchina.co/*', enabled: true, selector: '', note: 'xchina' },
    { id: 's_javdb571', pattern: '*://*.javdb571.com/*', enabled: true, selector: '', note: 'JavDB 镜像' },
    { id: 's_javdb', pattern: '*://*.javdb.com/*', enabled: true, selector: '', note: 'JavDB' },
    { id: 's_javdb580', pattern: '*://*.javdb580.com/*', enabled: true, selector: '', note: 'JavDB 镜像580' },
  ];

  let d = ctx.migrate({ schemaVersion: 4, settings: {}, sites: JSON.parse(JSON.stringify(old5)), rules: [] });
  check('v4 老数据迁移后补齐到 8 个站点', d.sites.length === 8);
  check('迁移后含 PornHub', d.sites.some(s => s.id === 's_pornhub'));
  check('迁移后含 YouPorn', d.sites.some(s => s.id === 's_youporn'));
  check('迁移后含 xsijishe', d.sites.some(s => s.id === 's_xsijishe'));

  const again = ctx.migrate(JSON.parse(JSON.stringify(d)));
  check('迁移幂等：再跑一次仍是 8 个', again.sites.length === 8);
  check('迁移不会把用户已有的站点冲掉',
    d.sites.filter(s => s.id === 's_javbus')[0].pattern === '*://*.javbus.com/*');

  // 用户自定义过的 pattern 必须原样保留
  const custom = JSON.parse(JSON.stringify(old5));
  custom[0].pattern = '*://*.myjav.example/*';
  const d2 = ctx.migrate({ schemaVersion: 4, settings: {}, sites: custom, rules: [] });
  check('迁移保留用户改过的 pattern',
    d2.sites.filter(s => s.id === 's_javbus')[0].pattern === '*://*.myjav.example/*');
}

/* ============ ⑧ 裸域匹配（用户给的 https://xsijishe.net/ 是裸域） ============ */
{
  const globToRegex = p => new RegExp('^' + String(p).trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  const bare = '*://*.' + 'xsijishe.net' + '/*';
  check('裸域确实不匹配 *://*.domain/* 原式', !globToRegex(bare).test('https://xsijishe.net/'));
  check('补的裸域变体能匹配 https://xsijishe.net/',
    globToRegex(bare.replace('*://*.', '*://')).test('https://xsijishe.net/'));
  check('content.js 里确实做了裸域兜底', /\*:\/\/\*\./.test(SRC.content));
}

/* ============ ⑨ 跨站内容身份（cid）：非番号站也能收藏 / 待看 / 已看 ============ */
{
  const contentId = (tpl, href) => {
    if (!href || !tpl || !tpl.idFrom) return '';
    const m = String(href).match(tpl.idFrom);
    if (!m || !m[1]) return '';
    return (tpl.idPrefix || tpl.id) + ':' + m[1].toLowerCase();
  };
  NEW.forEach(id => {
    const t = byId(id);
    check(id + ' 带 idFrom 正则与 idPrefix', isRe(t.idFrom) && !!t.idPrefix);
    check(id + ' 的 idPrefix 不撞其它站',
      T.filter(x => x.idPrefix && x.idPrefix === t.idPrefix).length === 1);
  });
  check('PornHub viewkey → ph:xxx',
    contentId(ph, '/view_video.php?viewkey=ph5f3c1d2e') === 'ph:ph5f3c1d2e');
  check('PornHub 带其它参数也能取到 viewkey',
    contentId(ph, 'https://cn.pornhub.com/view_video.php?viewkey=phAbC123&t=1') === 'ph:phabc123');
  check('YouPorn /watch/123 → yp:123', contentId(yp, '/watch/1234567/title/') === 'yp:1234567');
  check('xsijishe thread-123 → dz:123', contentId(xs, 'thread-12345-1-1.html') === 'dz:12345');
  check('xsijishe tid=123 → dz:123', contentId(xs, 'forum.php?mod=viewthread&tid=998') === 'dz:998');
  check('抽不出 ID 时返回空（不拿垃圾当主键）', contentId(ph, '/categories/bdsm') === '');

  // 番号站的 cid 必须就是番号本身 —— 老数据（已看/收藏/待看按番号存）才不会失效
  check('番号站不设 idFrom（cid 直接用番号）',
    T.filter(t => t.code !== false).every(t => !t.idFrom));
  ['ensureFavBtn(card, ctx.cid', 'ensureWatchBtn(card, ctx.cid', 'ensurePeekBtn(card, ctx.cid'].forEach(s => {
    check('content.js 用 cid 走收藏 / 待看 / 放行（' + s + '）', SRC.content.indexOf(s) !== -1);
  });
  check('content.js 已看判定按 cid', /S\.seen\[ctx\.cid\]/.test(SRC.content));
  check('content.js 待看判定按 cid', /S\.watchlist\[ctx\.cid\]/.test(SRC.content));
  check('content.js 的 extract 输出了 cid', /cid: cid,/.test(SRC.content));
  check('详情页自动已看也走 cid', /detailContentId\(\)/.test(SRC.content));
}

/* ============ ⑩ 镜像站点归一（JavDB 三域名 = 同一个站） ============ */
{
  const javdbs = ['s_javdb', 's_javdb571', 's_javdb580'].map(byId);
  check('三个 JavDB 模板都存在', javdbs.every(Boolean));
  check('三个 JavDB 模板都标了 mirror=javdb', javdbs.every(t => t.mirror === 'javdb'));
  check('MIRROR_GROUPS 能切出来且 javdb 组有 3 个成员',
    !!C.MIRROR_GROUPS && C.MIRROR_GROUPS.javdb === 3);
  check('非镜像站不带 mirror 字段（避免误归一）',
    byId('s_javbus').mirror === undefined && byId('s_pornhub').mirror === undefined);
  // 同组模板的番号体系必须一致，否则同一部片在一个镜像上有番号、另一个没有
  check('同组模板的 code 设置一致', new Set(javdbs.map(t => !!t.code)).size === 1);
  // 三个镜像的 host 正则互不误伤：javdb 的正则也匹配 571/580，靠顺序取第一个即可，
  // 但各自的 host 必须能命中自己的域名
  [['s_javdb', 'javdb.com'], ['s_javdb571', 'javdb571.com'], ['s_javdb580', 'javdb580.com']]
    .forEach(([id, h]) => check(id + ' 的 host 正则命中 ' + h, byId(id).host.test(h)));

  const grpOf = (host) => {
    for (const t of T) if (t.host.test(host) && t.mirror) return t.mirror;
    return host.toLowerCase();
  };
  check('javdb.com → 组 javdb', grpOf('javdb.com') === 'javdb');
  check('javdb571.com → 组 javdb', grpOf('javdb571.com') === 'javdb');
  check('javdb580.com → 组 javdb', grpOf('javdb580.com') === 'javdb');
  check('javbus.com 不并入 javdb 组', grpOf('javbus.com') === 'javbus.com');

  check('发现库写 site 时用组名（site: grp）', /site: grp,/.test(SRC.content));
  check('发现库按组拆账（e.sites[grp]）', /e\.sites\[grp\]/.test(SRC.content));
  check('noteDiscovered 记录了来源组', /grp: sourceGroup\(\)/.test(SRC.content));
  check('「已看」回写也用组名', /site: sourceGroup\(\)/.test(SRC.content));
}

/* ============ ⑩ 三个新站的主选择器（tpl）必须与真实页面一致 ============
 * 2026-09-22 实测发现 YouPorn 与 xsijishe 的 tpl 写错，主路径完全失效：
 *   YouPorn  : tpl='li.videoBox'            → 真实页 0 命中（真身 article.video-box）
 *   xsijishe : tpl='#threadlist tbody tr'   → 真实页 1 命中（那是工具栏，帖子行是纯 div）
 * 这两条把「真实页面长什么样」钉死，避免以后又被想当然地写回去。
 * （未联网，仅静态断言字段值；真实网络验证见 docs/requirements/004。） */
{
  check('YouPorn tpl 用 article.video-box（实测连字符 + article，不是 li.videoBox）',
    yp.tpl === 'article.video-box');
  check('YouPorn tpl 不再出现驼峰 videoBox',
    !/videoBox/.test(yp.tpl) && !(yp.sel || []).some(s => /videoBox/.test(s)));
  check('YouPorn sel 首选也是 article.video-box（不是 li.videoBox）',
    (yp.sel || [])[0] === 'article.video-box');
  check('YouPorn sel 仍保留 .video-box 作为兜底',
    (yp.sel || []).indexOf('.video-box') !== -1);

  check('xsijishe tpl 用 normalthread_/stickthread_ 两个 id 前缀选择器',
    /normalthread_/.test(xs.tpl) && /stickthread_/.test(xs.tpl));
  check('xsijishe tpl 不再用 #threadlist tbody tr（实测只命中工具栏 1 个）',
    !/tbody\s+tr/.test(xs.tpl));
  check('xsijishe 仍是 rowMode（论坛行没有图片，需要行模式）', xs.rowMode === true);

  // PornHub 实测正确，锁住别被误改
  check('PornHub tpl 保持 li.pcVideoListItem（实测 37 命中）',
    ph.tpl === 'li.pcVideoListItem');
}

/* ============ ⑪ detectRows() 兜底的导航菜单防护 ============
 * 实测 xsijishe 版块页里有 103 个 <ul><li> 是导航菜单（"立即注册"/"图片区"…），
 * 旧版 'ul li' 兜底会把它们当帖子行 —— 用户能"屏蔽"菜单项，真帖子一行都屏蔽不到。
 * 现在加了"必须落在内容容器内"的判据。这里断言该判据确实存在于源码。 */
{
  check('detectRows 有导航防护（内容容器判据）', /hasListRoot/.test(SRC.content));
  check('detectRows 判据包含 #threadlist / form#moderate',
    /#threadlist/.test(SRC.content) && /form#moderate/.test(SRC.content));
  check('detectRows 里对候选做了祖先链检查', /parentElement/.test(SRC.content));
}

console.log('\n' + (pass ? '全部通过' : '存在失败项'));
process.exit(pass ? 0 : 1);
