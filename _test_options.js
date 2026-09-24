/* 设置页冒烟测试：用 jsdom 加载真实 options.html + options.js，
 * 验证 renderAll 不抛错、各面板渲染出内容、撤销与冲突检测等新功能可用。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = __dirname;
const html = fs.readFileSync(path.join(EXT, 'options.html'), 'utf8');
const js = fs.readFileSync(path.join(EXT, 'options.js'), 'utf8');

const now = Date.now();
const store = {
  sf_data_v1: {
    settings: { enabled: true, autoBackup: false, hlColor: '#00e5ff', sync: false },
    sites: [
      { id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' },
      { id: 's2', pattern: '*://*.javdb580.com/*', enabled: true, selector: '', note: 'JavDB580' }
    ],
    rules: [
      { id: 'r1', type: 'actress', value: '三上悠亚', action: 'block', match: 'contains', scope: 'actress', enabled: true, hits: 5, lastHit: now - 3600e3, createdAt: now - 20 * 864e5 },
      { id: 'r2', type: 'actress', value: '冲突女优', action: 'block', match: 'contains', scope: 'actress', enabled: true, hits: 0, createdAt: now - 10 * 864e5 },
      { id: 'r3', type: 'actress', value: '冲突女优', action: 'favorite', match: 'contains', scope: 'actress', enabled: true, hits: 0, createdAt: now - 10 * 864e5 },
      // 「放行（例外）」与 block 同值**不是冲突**，是刻意共存（误杀了还能救）。
      // 放在这里是为了验证「一键修复」不会顺手把用户的逃生门也删掉。
      { id: 'r5', type: 'actress', value: '冲突女优', action: 'allow', match: 'contains', scope: 'actress', enabled: true, hits: 0, createdAt: now - 10 * 864e5 },
      { id: 'r4', type: 'tag', value: '死标签', action: 'block', match: 'contains', scope: 'tag', enabled: true, hits: 0, createdAt: now - 30 * 864e5 }
    ],
    groups: [{ id: 'g1', name: '临时试试', enabled: false }],
    seen: { 'ABC-001': now },
    favCodes: { 'ABC-001': { t: '标题一', u: 'http://x/1', s: 'javbus', at: now }, 'ABC-002': { t: '标题二', u: '', s: 'javdb', at: now } },
    // 发现库：影响面预演的演算数据源。刻意构造成：
    //   - '三上悠亚' 命中 2 条（1 个精确 + 1 个带后缀），验证 contains 语义；
    //   - '死标签' 命中 0 条（同类总量 2），验证「零命中」也能被算出来；
    //   - '巨乳' / '巨乳系' 被多条规则同时命中，验证重叠统计。
    discovered: {
      'actress|新垣结衣': { v: '新垣结衣', type: 'actress', n: 3, first: now, last: now },
      'actress|三上悠亚': { v: '三上悠亚', type: 'actress', n: 5, first: now, last: now },
      'actress|三上悠亚(旧名)': { v: '三上悠亚(旧名)', type: 'actress', n: 1, first: now, last: now },
      'actress|冲突女优a': { v: '冲突女优a', type: 'actress', n: 2, first: now, last: now },
      'actress|冲突女优b': { v: '冲突女优b', type: 'actress', n: 1, first: now, last: now },
      'tag|死标签': { v: '死标签x', type: 'tag', n: 1, first: now, last: now },
      'tag|巨乳': { v: '巨乳', type: 'tag', n: 9, first: now, last: now },
      'tag|巨乳系': { v: '巨乳系', type: 'tag', n: 4, first: now, last: now },
    },
    statsLog: (function () { const o = {}; const d = new Date(); const k = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); o[k] = { blocked: 7, fav: 2, hl: 1, dl: 0, at: now }; return o; })(),
    recSettings: { enabled: true, max: 12, newMax: 6, minQuality: 0, windowDays: 14, dim: ['actress'], weights: { rating: 0.4, works: 0.25, pop: 0.2, recency: 0.15 } },
    recHistory: [],
    dailyRecs: {},
    recFeedback: {},
    recFeedbackDaily: (function () { const o = {}; const d = new Date(); const k = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); o[k] = { faved: 3, blocked: 1, seen: 1 }; return o; })(),
    watchlist: { 'ABC-777': { t: '待看', at: now } },
    cooc: {},
    similarRecs: {},
    peeks: { 'ABC-555': now, 'ABC-666': now - 1000 },
    // 自动学习候选规则（后台 buildLearned 的产出形状）
    learned: {
      at: now - 3600e3, total: 42,
      items: [
        { at: now, action: 'block', dim: 'tag', value: '巨乳', coverage: 80, precision: 75, score: 78, evidence: ['A', 'B', 'C'], seedCount: 5 },
        { at: now, action: 'block', dim: 'maker', value: '某片商', coverage: 60, precision: 90, score: 74, evidence: ['D', 'E'], seedCount: 5 },
        // 这条会被采纳/忽略掉，用来验证点击后的存储变化
        { at: now, action: 'favorite', dim: 'series', value: '待处理系列', coverage: 55, precision: 66, score: 60, evidence: ['F'], seedCount: 4 }
      ]
    },
    dismissedLearn: {},
    profiles: [
      {
        id: 'p_test1', name: '日常', at: now - 864e5,
        rules: [{ id: 'r1', enabled: true }],
        groups: [{ id: 'g1', on: false }],
        settings: { sfw: false, onlyFav: false, firstMatchWins: false, softBlock: false, previewMode: false }
      }
    ],
    activeProfile: '',
    expiredLog: [{ value: '老临时', type: 'actress', action: 'block', expiredAt: now - 864e5 }],
    // 错误日志：设置页「错误日志」卡片应渲染出来
    errLog: [
      { t: now - 60000, w: 'runPass', m: 'PEEK_TTL is not defined', s: 'content' },
      { t: now - 30000, w: 'buildDaily', m: 'nothing to see', s: 'background' }
    ]
  }
};

const dom = new JSDOM(html, { url: 'chrome-extension://abc/options.html', runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window;

win.chrome = {
  storage: {
    local: {
      get(k, cb) { const o = {}; if (typeof k === 'string') o[k] = store[k]; else Object.keys(k).forEach(x => o[x] = store[x]); cb(o); },
      set(o, cb) { Object.assign(store, o); if (cb) cb(); }
    },
    sync: {
      get(k, cb) { const o = {}; if (typeof k === 'string') o[k] = store[k]; else Object.keys(k).forEach(x => o[x] = store[x]); cb(o); },
      set(o, cb) { Object.assign(store, o); if (cb) cb(); }
    },
    onChanged: { addListener() { } }
  },
  runtime: { sendMessage() { }, openOptionsPage() { }, onMessage: { addListener() { } } }
};
win.alert = function () { };
win.confirm = function () { return true; };
win.prompt = function () { return ''; };
win.URL.createObjectURL = function () { return 'blob:x'; };
win.URL.revokeObjectURL = function () { };
// jsdom 不支持 <a download> 触发下载，会打印 "Not implemented: navigation"。
// 分项回滚在恢复前会主动调 exportPlain() 做保险备份 —— 那是预期行为，
// 这里把 a.click() 静音，免得把真实失败淹在噪声里。
const origClick = win.HTMLAnchorElement.prototype.click;
win.HTMLAnchorElement.prototype.click = function () {
  if (this.download) return;   // 下载型点击：吞掉
  return origClick.apply(this, arguments);
};

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

let threw = null;
try {
  // 与真实页面一致：按 options.html 的 <script> 顺序先加载共享模块
  // （site-templates.js / expr.js / rulecheck.js），jsdom runScripts:'outside-only'
  // 不会自动取外部脚本，这里手动对齐。
  win.eval(fs.readFileSync(path.join(EXT, 'site-templates.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(EXT, 'expr.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(EXT, 'rulecheck.js'), 'utf8'));
  win.eval(js);
} catch (e) { threw = e; }

setTimeout(() => {
  check('options.js 执行未抛错', !threw);
  if (threw) { console.log('      错误：', threw && threw.message); process.exit(1); }

  const doc = win.document;
  check('规则表渲染出 5 条规则', doc.querySelectorAll('#ruleTable tbody tr[data-id]').length === 5);
  check('规则表显示「最近命中」相对时间', doc.querySelector('#ruleTable').textContent.indexOf('小时前') !== -1 || doc.querySelector('#ruleTable').textContent.indexOf('分钟前') !== -1);

  check('冲突警告框出现', doc.querySelector('#conflictBox').textContent.indexOf('冲突女优') !== -1);
  check('冲突警告框含一键修复按钮', !!doc.querySelector('#fixConflicts'));

  check('分组表渲染出 1 个分组', doc.querySelectorAll('#groupTable tbody tr[data-id]').length === 1);
  const siteRows = doc.querySelectorAll('#siteTable tbody tr');
  // 匹配规则渲染在 input 的 value 里，textContent 取不到，必须读 value
  const sitePats = Array.prototype.map.call(
    doc.querySelectorAll('#siteTable tbody tr input[data-f="pattern"]'), i => i.value);
  check('站点表渲染出播种的 2 个站点',
    sitePats[0] === '*://*.javbus.com/*' && sitePats[1] === '*://*.javdb580.com/*');
  // v5 起迁移会把新增的默认站点补进来，所以 >= 2 而不是 === 2
  check('站点表补齐了默认站点（>= 播种数量）', siteRows.length >= 2);
  check('预置模板下拉已填充', doc.querySelector('#tplSel').options.length >= 5);

  check('番号收藏夹渲染出 2 条', doc.querySelectorAll('#fcTable tbody tr[data-c]').length === 2);
  check('番号收藏夹显示已看/未看统计', doc.querySelector('#fcCount').textContent.indexOf('已看') !== -1);

  check('数据看板：屏蔽柱状图 SVG 已渲染', doc.querySelector('#dashChart svg') !== null);
  check('数据看板：采纳率曲线已渲染', doc.querySelector('#dashAdopt svg') !== null);
  check('数据看板：采纳率数值出现', doc.querySelector('#dashAdopt').textContent.indexOf('采纳率') !== -1);
  check('数据看板：命中 Top 已渲染', doc.querySelector('#dashTop').textContent.indexOf('三上悠亚') !== -1);
  check('数据看板：死规则清单出现', doc.querySelector('#dashDead').textContent.indexOf('死标签') !== -1);

  check('每日推荐设置已回填（启用）', doc.querySelector('#recOn').checked === true);
  check('同步开关已回填', doc.querySelector('#syncOn').checked === false);

  // —— 屏蔽后显示方式已进入设置页（v6：从 SWITCHES 复选框升级为 #bdSel 三档下拉） ——
  const bdSel = doc.querySelector('#bdSel');
  check('设置页存在「屏蔽后显示方式」下拉', !!bdSel);
  check('下拉提供隐藏 / 占位 / 灰化三档',
    !!bdSel && ['hide', 'placeholder', 'soft'].every(v => !!bdSel.querySelector('option[value="' + v + '"]')));
  check('通用设置不再出现「软屏蔽」旧复选框', !doc.querySelector('#switches input[data-k="softBlock"]'));
  check('通用设置出现「规则预览」开关', !!doc.querySelector('#switches input[data-k="previewMode"]'));

  // —— 软屏蔽：放行时长控件 + 放行记录清单（可查看 / 撤销） ——
  const phEl = doc.querySelector('#peekHours');
  check('「放行有效期」控件存在', !!phEl);
  check('放行有效期默认回填 24 小时', phEl && phEl.value === '24');
  check('放行记录清单渲染出 2 条', doc.querySelectorAll('#peekList tbody tr[data-peek]').length === 2);
  check('放行记录显示番号 ABC-555', doc.querySelector('#peekList').textContent.indexOf('ABC-555') !== -1);
  check('放行记录带「撤销」按钮', !!doc.querySelector('#peekList [data-peekdel]'));
  check('放行记录统计文本出现', doc.querySelector('#peekCount').textContent.indexOf('当前生效') !== -1);

  // —— 数据看板：堆叠曲线（图例）+ 按维度汇总 ——
  const chartTxt = doc.querySelector('#dashChart').textContent;
  check('看板堆叠图例含「屏蔽 / 收藏 / 高亮」',
    chartTxt.indexOf('屏蔽') !== -1 && chartTxt.indexOf('收藏') !== -1 && chartTxt.indexOf('高亮') !== -1);
  check('看板「按维度汇总」渲染出维度行', doc.querySelectorAll('#dashByType tbody tr').length >= 2);
  check('按维度汇总含「女优」', doc.querySelector('#dashByType').textContent.indexOf('女优') !== -1);

  // —— 已看粒度阈值控件：回填 + 可保存 ——
  const ratioEl = doc.querySelector('#recSeenRatio');
  check('「已看作品比例」阈值控件存在', !!ratioEl);
  check('阈值默认回填为 75（0.75 → 75%）', ratioEl && ratioEl.value === '75');
  if (ratioEl) {
    ratioEl.value = '90';
    ratioEl.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  setTimeout(() => {
    const rs = store.sf_data_v1.recSettings || {};
    check('阈值保存为 0.9 写入 recSettings.seenWorkRatio', Math.abs((rs.seenWorkRatio || 0) - 0.9) < 1e-6);
  }, 200);

  // 番号收藏夹「仅未看」筛选
  doc.querySelector('#fcFilter').value = 'unseen';
  doc.querySelector('#fcFilter').dispatchEvent(new win.Event('change', { bubbles: true }));
  check('番号筛选「仅未看」后只剩 1 条', doc.querySelectorAll('#fcTable tbody tr[data-c]').length === 1);
  doc.querySelector('#fcFilter').value = 'all';
  doc.querySelector('#fcFilter').dispatchEvent(new win.Event('change', { bubbles: true }));

  /* ================= 本轮新增：规则包 / 拖动排序 / 条件 / 发现库 / 错误日志 ================= */

  // —— 数据版本号显示 ——
  // 不写死具体数字：先取引擎里当前的版本号（跟 content/background 一致那份），再断言页面显示的是它。
  // 注意：win.eval 里的顶层 var 不会挂到 window 上，所以版本号从 DOM 反解，而不是读 win.SCHEMA_VERSION。
  const verFromPage = (() => {
    const t = doc.querySelector('#schemaTag') ? doc.querySelector('#schemaTag').textContent : '';
    const m = t.match(/v(\d+)/);
    return m ? Number(m[1]) : NaN;
  })();
  check('设置页显示数据结构版本号（形如 v4）', Number.isFinite(verFromPage) && verFromPage >= 4);
  check('页面显示的版本号与 options.js 里的 SCHEMA_VERSION 一致（无写死字面量）',
    fs.readFileSync(path.join(EXT, 'options.js'), 'utf8')
      .indexOf('var SCHEMA_VERSION = ' + verFromPage + ';') !== -1);

  // —— 表达式测试器：用的必须是页面里同一份引擎 ——
  check('表达式测试器：输入框/动作下拉/测试与建规则按钮齐全',
    !!doc.querySelector('#exprTest') && !!doc.querySelector('#exprAct') &&
    !!doc.querySelector('#exprRun') && !!doc.querySelector('#exprAdd'));
  check('表达式测试器：共享引擎已注入到设置页（同一份 expr.js）',
    !!win.SF_EXPR && typeof win.SF_EXPR.test === 'function' && typeof win.SF_EXPR.check === 'function');
  // 引擎行为自证：设置页里的引擎跟页面跑的是同一份实现，能给出正确判定
  check('表达式测试器：共享引擎行为正确（命中 / 不命中 / 语法错）',
    win.SF_EXPR && win.SF_EXPR.test('rating >= 4', { rating: 4.8 }) === true &&
    win.SF_EXPR.test('rating >= 9', { rating: 4.8 }) === false &&
    win.SF_EXPR.check('(rating >= 4').ok === false);
  // 直接把表达式塞进输入框 → 点「测试」，应当输出命中结果
  doc.querySelector('#exprTest').value = 'rating >= 4 && tag ~ 高清';
  doc.querySelector('#exprRun').dispatchEvent(new win.Event('click', { bubbles: true }));
  check('表达式测试器：点测试后有结果输出',
    doc.querySelector('#exprOut').textContent.length > 0);
  // 这条应当命中（默认模拟卡片里就有 rating 4.8 / 高清）
  check('表达式测试器：真实引擎给出命中判定',
    /命中/.test(doc.querySelector('#exprOut').textContent));
  // 换一条不可能命中的，应当给出「不命中」结论而非报错
  doc.querySelector('#exprTest').value = 'rating >= 9.9';
  doc.querySelector('#exprRun').dispatchEvent(new win.Event('click', { bubbles: true }));
  check('表达式测试器：不命中时给出明确结论（不报错）',
    /不命中/.test(doc.querySelector('#exprOut').textContent) &&
    !/error|undefined|NaN/.test(doc.querySelector('#exprOut').textContent));
  // 语法错误要报错、且不能把坏表达式塞进规则库
  doc.querySelector('#exprTest').value = '(rating >= 4';
  doc.querySelector('#exprRun').dispatchEvent(new win.Event('click', { bubbles: true }));
  check('表达式测试器：语法错误给出提示',
    /语法错误/.test(doc.querySelector('#exprOut').textContent));
  const rulesBeforeAdd = doc.querySelectorAll('#ruleTable tbody tr[data-id]').length;
  doc.querySelector('#exprAdd').dispatchEvent(new win.Event('click', { bubbles: true }));
  check('表达式测试器：语法错误时不新建规则',
    doc.querySelectorAll('#ruleTable tbody tr[data-id]').length === rulesBeforeAdd);

  // —— 快捷键自定义 ——
  const keysBox = doc.querySelector('#keysBox');
  check('快捷键卡片：渲染出按键行', !!keysBox && keysBox.querySelectorAll('input.keyin[data-k]').length >= 8);
  check('快捷键卡片：面板全局键与面板内键都列出',
    !!keysBox && keysBox.querySelector('input[data-k="panel"]') && keysBox.querySelector('input[data-k="next"]'));
  check('快捷键卡片：按键输入框回填了当前键位',
    !!keysBox && keysBox.querySelector('input[data-k="panel"]').value.length > 0);
  check('快捷键卡片：Esc 不在可自定义列表里',
    !keysBox || !keysBox.querySelector('input[data-k="escape"]'));
  check('快捷键卡片：有「恢复默认键位」按钮', !!doc.querySelector('#keysReset'));
  check('快捷键卡片：说明文案随配置动态生成（含 Alt+ 与即时生效）',
    doc.querySelector('#keysTip') && /Alt\+/.test(doc.querySelector('#keysTip').textContent) &&
    /生效/.test(doc.querySelector('#keysTip').textContent));

  // —— 规则包模板 ——
  const packSel = doc.querySelector('#packSel');
  check('规则包下拉已填充（≥5 套）', packSel && packSel.options.length >= 5);
  check('规则包下拉含「欧美厂牌」', packSel && packSel.textContent.indexOf('欧美厂牌') !== -1);
  check('规则包下拉含「VR」', packSel && packSel.textContent.indexOf('VR') !== -1);
  // 切换到「高清 → 高亮」看提示文案
  if (packSel) {
    packSel.value = 'hd';
    packSel.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  check('切换规则包后提示文案出现', doc.querySelector('#packTip').textContent.indexOf('高清') !== -1);

  const rulesBeforePack = (store.sf_data_v1.rules || []).length;
  doc.querySelector('#packApply').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  setTimeout(() => {
    const rulesAfterPack = (store.sf_data_v1.rules || []).length;
    check('应用规则包后新增了规则', rulesAfterPack > rulesBeforePack);
    const added = store.sf_data_v1.rules.filter(r => r.type === 'tag' && ['高清', '4K', '中文字幕'].indexOf(r.value) !== -1);
    check('规则包导入的规则动作为「高亮」', added.length === 3 && added.every(r => r.action === 'highlight'));
    // ④ 来源可追溯：导入的规则要记住「来自哪个包、哪一版、什么时候导的」，
    //    否则以后某个包改坏了，根本说不清自己这条是哪版进来的。
    check('规则包导入的规则带来源元数据（包 id / 版本 / 时间）',
      added.length === 3 && added.every(r => r.pack && r.pack.id === 'hd' && r.pack.version && r.pack.at));
    check('规则表里显示「来自规则包」的来源标注',
      /📦/.test(doc.querySelector('#ruleTable').textContent));
    check('手输的老规则不显示来源标注（没来源 ≠ 来源未知）',
      doc.querySelector('#ruleTable tbody tr[data-id="r1"]').textContent.indexOf('📦') === -1);
    // ① 例外动作：动作下拉里能选，规则包里也给了示例
    check('规则动作下拉里有「放行（例外）」',
      !!doc.querySelector('#ruleTable select[data-f="action"] option[value="allow"]'));
    check('规则包下拉里含「例外」示例包',
      !!packSel && packSel.textContent.indexOf('例外') !== -1);
    // 再点一次：应当全部跳过（去重）
    const rulesAfterFirst = (store.sf_data_v1.rules || []).length;
    doc.querySelector('#packApply').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    setTimeout(() => {
      check('重复应用同一规则包不会重复导入',
        (store.sf_data_v1.rules || []).length === rulesAfterFirst);
      check('规则包去重提示出现', /已存在|跳过/.test(doc.querySelector('#packTip').textContent));
    }, 150);
  }, 150);

  // —— 规则排序：上移 / 下移按钮 ——
  const rowEls = Array.from(doc.querySelectorAll('#ruleTable tbody tr[data-id]'));
  check('规则表带拖动句柄列（⠿）', rowEls.length > 0 && !!rowEls[0].querySelector('.dgh'));
  check('规则表行可拖动（draggable=true）', rowEls.length > 0 && rowEls[0].getAttribute('draggable') === 'true');
  check('规则行带「上移」按钮', !!doc.querySelector('#ruleTable tbody tr[data-id="r1"] button[data-act="up"]'));
  check('规则行带「下移」按钮', !!doc.querySelector('#ruleTable tbody tr[data-id="r1"] button[data-act="down"]'));

  {
    const idsBefore = (store.sf_data_v1.rules || []).map(r => r.id);
    const iR2 = idsBefore.indexOf('r2');
    doc.querySelector('#ruleTable tbody tr[data-id="r2"] button[data-act="up"]')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const idsAfter = (store.sf_data_v1.rules || []).map(r => r.id);
    check('点「上移」后该规则在数组中前移', idsAfter.indexOf('r2') === iR2 - 1);
    // 下移回去
    doc.querySelector('#ruleTable tbody tr[data-id="r2"] button[data-act="down"]')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    check('点「下移」后恢复原位置',
      (store.sf_data_v1.rules || []).map(r => r.id).indexOf('r2') === iR2);
  }

  // —— 「首个命中生效」开关存在 ——
  check('通用设置出现「首个命中生效」开关',
    !!doc.querySelector('#switches input[data-k="firstMatchWins"]'));
  check('通用设置出现「番号多站直达」开关',
    !!doc.querySelector('#switches input[data-k="codeSearchBtns"]'));

  // —— 规则编辑器：评分 / 日期条件输入 ——
  doc.querySelector('#ruleTable tbody tr[data-id="r1"] button[data-act="edit"]')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const editRow = doc.querySelector('#ruleTable tr.editrow');
  check('规则编辑器出现', !!editRow);
  check('编辑器含「评分 ≥」输入框', !!doc.querySelector('#ruleTable [data-e="ratingMin"]'));
  check('编辑器含「发行日 ≥」输入框', !!doc.querySelector('#ruleTable [data-e="dateFrom"]'));
  check('编辑器含日期上限输入框', !!doc.querySelector('#ruleTable [data-e="dateTo"]'));
  if (editRow) {
    editRow.querySelector('[data-e="ratingMin"]').value = '4.5';
    editRow.querySelector('[data-e="dateFrom"]').value = '2023-01-01';
    editRow.querySelector('[data-e="dateTo"]').value = '2024-12-31';
    editRow.querySelector('button[data-act="saveEdit"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  }
  setTimeout(() => {
    const r1 = (store.sf_data_v1.rules || []).find(r => r.id === 'r1') || {};
    check('评分条件保存为 4.5', Number(r1.ratingMin) === 4.5);
    check('日期下限保存正确', r1.dateFrom === '2023-01-01');
    check('日期上限保存正确', r1.dateTo === '2024-12-31');
    check('规则表出现「评分≥4.5」徽章', doc.querySelector('#ruleTable').textContent.indexOf('评分≥4.5') !== -1);
    check('规则表出现日期徽章', doc.querySelector('#ruleTable').textContent.indexOf('2023-01-01 起') !== -1 && doc.querySelector('#ruleTable').textContent.indexOf('至 2024-12-31') !== -1);
    // 清掉条件，避免影响后续断言
    const ep = doc.querySelector('#ruleTable tbody tr[data-id="r1"] button[data-act="edit"]');
    if (ep) {
      ep.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      const er2 = doc.querySelector('#ruleTable tr.editrow');
      if (er2) {
        er2.querySelector('[data-e="ratingMin"]').value = '';
        er2.querySelector('[data-e="dateFrom"]').value = '';
        er2.querySelector('[data-e="dateTo"]').value = '';
        er2.querySelector('button[data-act="saveEdit"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      }
    }
  }, 150);

  // —— 发现库管理：统计 / 清理天数 / 单条删除 / 导出 HTML ——
  check('发现库统计文本已渲染', !!doc.querySelector('#discStats') && doc.querySelector('#discStats').textContent.indexOf('共') !== -1);
  check('发现库统计含类型分布', doc.querySelector('#discStats').textContent.indexOf('女优') !== -1);
  check('发现库「清理阈值」输入存在', !!doc.querySelector('#discPruneDays'));
  check('发现库「清理」按钮存在', !!doc.querySelector('#discPrune'));
  check('发现库单条「删除」按钮存在', !!doc.querySelector('#discTable button[data-dact="del"]'));
  check('发现库「导出 HTML」按钮存在', !!doc.querySelector('#discExportHtml'));
  check('番号收藏夹「导出 HTML」按钮存在', !!doc.querySelector('#fcHtml'));

  // —— 错误日志卡片 ——
  check('错误日志表已渲染', !!doc.querySelector('#errTable tbody tr'));
  check('错误日志显示位置（runPass）', doc.querySelector('#errTable').textContent.indexOf('runPass') !== -1);
  check('错误日志显示错误信息', doc.querySelector('#errTable').textContent.indexOf('PEEK_TTL') !== -1);
  check('错误日志条数统计出现', /最近\s*2\s*条/.test(doc.querySelector('#errCount').textContent));
  check('错误日志带「刷新 / 导出 / 清空」按钮',
    !!doc.querySelector('#errRefresh') && !!doc.querySelector('#errExport') && !!doc.querySelector('#errClear'));
  check('错误日志「显示完整信息」开关存在', !!doc.querySelector('#errDetail'));

  /* ================= 本轮新增：规则体检 / 候选规则 / 场景档位 / 月度回顾 ================= */

  // —— 规则体检 ——
  check('规则体检面板已渲染', !!doc.querySelector('#auditBox'));
  // 夹具里 r2/r3/r4 都是 0 命中且创建超过 7 天 → 应被列出
  const auditTxt = doc.querySelector('#auditBox').textContent;
  check('规则体检列出 0 命中规则', auditTxt.indexOf('冲突女优') !== -1 || auditTxt.indexOf('死标签') !== -1);
  check('规则体检给出「可能的原因 / 建议」表', !!doc.querySelector('#auditBox .auditPk'));
  check('规则体检默认不勾选（防误删）',
    Array.prototype.every.call(doc.querySelectorAll('#auditBox .auditPk'), c => c.checked === false));
  check('规则体检提供「全选」复选框', !!doc.querySelector('#auditAllZero'));
  check('规则体检有「删除勾选」与「全部关闭」按钮',
    !!doc.querySelector('#auditDel') && !!doc.querySelector('#auditMute'));
  check('规则体检统计文案已填充',
    (doc.querySelector('#auditCount').textContent || '').length > 0);
  // 原因分类要能说清"为什么没生效"：r2 的匹配方式是 contains，不该说"精确"；
  // 夹具的 g1 分组是关闭的，r4 无分组。这里断言"精确"提示只出现在 exact 规则上。
  check('规则体检不会给 contains 规则误报「精确」原因',
    (() => {
      const row = doc.querySelector('#auditBox tr[data-audit="r2"]');
      return !!row && row.textContent.indexOf('精确') === -1;
    })());

  // —— 影响面预演（建议 ④）——
  check('影响面预演面板已渲染', !!doc.querySelector('#simBox'));
  check('影响面预演有「开始预演」按钮与范围下拉',
    !!doc.querySelector('#simRun') && !!doc.querySelector('#simScope'));
  check('预演范围下拉提供三档',
    ['all', 'block', 'enabled'].every(v => !!doc.querySelector('#simScope option[value="' + v + '"]')));
  check('预演初始为未计算状态（不预先臆测）',
    doc.querySelector('#simBox').querySelector('table') === null);
  // 点「开始预演」后应算出明细
  doc.querySelector('#simRun').click();
  const simTxt = doc.querySelector('#simBox').textContent;
  check('预演后渲染出明细表', !!doc.querySelector('#simBox table'));
  // 夹具发现库：5 条 actress（新垣结衣 / 三上悠亚 / 三上悠亚(旧名) / 冲突女优a / 冲突女优b）
  //             + 3 条 tag（死标签x / 巨乳 / 巨乳系）
  check('预演总览显示发现库条数', /发现库\s*8\s*条/.test(simTxt));
  check('预演按规则列出命中数', simTxt.indexOf('三上悠亚') !== -1);
  // contains 语义：'三上悠亚' 命中 2 条 actress（精确那条 + 带后缀的 '三上悠亚(旧名)'）
  check('预演按 contains 语义算命中（三上悠亚 → 2/5）',
    (() => {
      const rows = Array.from(doc.querySelectorAll('#simBox tbody tr'));
      const r = rows.find(tr => tr.textContent.indexOf('三上悠亚') !== -1);
      return !!r && /2\s*\/\s*5/.test(r.textContent);
    })());
  // 零命中也要显示出来（不是静默略过）
  check('预演把「零命中」规则也列出来（tag 类 0/3）',
    (() => {
      const rows = Array.from(doc.querySelectorAll('#simBox tbody tr'));
      return rows.some(tr => /0\s*\/\s*3\s*（0%）/.test(tr.textContent));
    })());
  // 重叠：冲突女优 同时被 block + favorite 两条规则命中 → 必须列出来
  check('预演标出被多条规则同时命中的条目', simTxt.indexOf('重叠命中') !== -1);
  // 番号/表达式类无法用发现库离线演算 → 必须显式说明，不能让用户以为"全部安全"
  // 夹具里的 8 条规则都落在发现库覆盖的维度内，所以这里改用「只挑屏蔽类 + 断言已算」的反向验证：
  // 确认预演确实没有把任何可算规则静默丢掉。
  check('预演把可演算的规则全部列出（8 条）',
    doc.querySelectorAll('#simBox tbody tr').length === 8);
  // 预演是只读操作：不能碰规则（本文件此处已累积 8 条规则）
  check('预演不修改任何规则',
    store.sf_data_v1.rules.length === 8 && store.sf_data_v1.rules[0].enabled === true);

  // —— 候选规则（自动学习）——
  check('候选规则面板已渲染', !!doc.querySelector('#learnBox'));
  const learnTxt = doc.querySelector('#learnBox').textContent;
  check('候选规则列出学习到的建议', learnTxt.indexOf('巨乳') !== -1 && learnTxt.indexOf('某片商') !== -1);
  check('候选规则显示覆盖率与精确率', learnTxt.indexOf('覆盖率') !== -1 && learnTxt.indexOf('精确率') !== -1 &&
    learnTxt.indexOf('80%') !== -1 && learnTxt.indexOf('90%') !== -1);
  check('候选规则显示证据（来自哪些条目）', learnTxt.indexOf('来自 5 条已有规则') !== -1);
  check('候选规则每条都有「采纳 / 忽略」', 
    doc.querySelectorAll('#learnBox [data-learnok]').length === 3 &&
    doc.querySelectorAll('#learnBox [data-learnno]').length === 3);
  check('候选规则有「清空已忽略名单」按钮', !!doc.querySelector('#learnClearNo'));

  // —— 场景档位 ——
  check('场景档位面板已渲染', !!doc.querySelector('#profBox'));
  check('场景档位列出已有档位', doc.querySelector('#profBox').textContent.indexOf('日常') !== -1);
  check('场景档位统计文案正确', doc.querySelector('#profCount').textContent.indexOf('1 个档位') !== -1);
  check('场景档位有「切换到这套 / 更新 / 改名 / 删除」',
    !!doc.querySelector('[data-profapply="p_test1"]') && !!doc.querySelector('[data-profupd="p_test1"]') &&
    !!doc.querySelector('[data-profren="p_test1"]') && !!doc.querySelector('[data-profdel="p_test1"]'));
  check('场景档位有「以当前状态新建档位」', !!doc.querySelector('#profAdd') && !!doc.querySelector('#profName'));
  check('场景档位写明「不含规则内容本身」的边界',
    doc.querySelector('#profBox').textContent.indexOf('不含规则内容本身') !== -1);

  // —— 月度回顾 ——
  check('月度回顾面板已渲染', !!doc.querySelector('#monthBox'));
  const monthTxt = doc.querySelector('#monthBox').textContent;
  check('月度回顾显示四项：屏蔽 / 收藏 / 高亮 / 标记已看',
    monthTxt.indexOf('屏蔽') !== -1 && monthTxt.indexOf('收藏') !== -1 &&
    monthTxt.indexOf('高亮') !== -1 && monthTxt.indexOf('标记已看') !== -1);
  check('月度回顾有柱状区域与图例',
    monthTxt.indexOf('近 6 个月动作量') !== -1);
  check('月度回顾给出「本月有动作的天数」', monthTxt.indexOf('本月有动作的天数') !== -1);
  check('月度回顾统计文案已填充', (doc.querySelector('#monthCount').textContent || '').length > 0);

  // —— 加密导出：按钮与说明 ——
  check('备份卡片有「导出加密备份」按钮', !!doc.querySelector('#expEncBtn'));
  check('备份卡片说明提到 AES-GCM 与 PBKDF2',
    doc.querySelector('#pane-settings').textContent.indexOf('AES-GCM') !== -1 &&
    doc.querySelector('#pane-settings').textContent.indexOf('PBKDF2') !== -1);
  check('导入按钮文案已更新为「明文或加密」',
    (doc.querySelector('#impBtn').textContent || '').indexOf('加密') !== -1);

  // —— 备份快照留多份（建议 ⑤ 前半）——
  check('自动备份卡片有「快照轮换」下拉', !!doc.querySelector('#backupKeep'));
  check('轮换下拉提供 1/7/30/不轮换 四档',
    ['1', '7', '30', '0'].every(v => !!doc.querySelector('#backupKeep option[value="' + v + '"]')));
  check('轮换下拉默认回填 7 份', doc.querySelector('#backupKeep').value === '7');
  check('备份提示文案已说明「文件名含时分秒」（不再一天一份）',
    doc.querySelector('#pane-settings').textContent.indexOf('时分秒') !== -1);

  // —— 分项回滚（建议 ⑤ 后半）——
  check('分项回滚卡片有选文件按钮与隐藏 file input',
    !!doc.querySelector('#partialPick') && !!doc.querySelector('#partialFile'));
  check('未选文件时给出说明（不预先臆测）',
    doc.querySelector('#partialBox').textContent.indexOf('默认全部不勾选') !== -1);
  check('分项回滚提示「恢复前会自动先导出」',
    doc.querySelector('#partialBox').textContent.indexOf('自动') !== -1);

  // —— 临时规则有效期：规则表新增「有效期」列 ——
  check('规则表表头含「有效期」列', doc.querySelector('#ruleTable thead').textContent.indexOf('有效期') !== -1);
  check('永久规则显示「永久」', doc.querySelector('#ruleTable').textContent.indexOf('永久') !== -1);

  // —— 自动学习开关进入通用设置 ——
  check('通用设置出现「自动记录已看」开关', !!doc.querySelector('#switches input[data-k="autoSeen"]'));
  check('通用设置出现「建规则前估算影响面」开关', !!doc.querySelector('#switches input[data-k="auditWarn"]'));

  // —— 采纳一条候选规则：应建出规则并写入 dismissedLearn ——
  const adoptBtn = doc.querySelector('#learnBox [data-learnok]');
  if (adoptBtn) adoptBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  setTimeout(() => {
    const rl = store.sf_data_v1.rules || [];
    check('采纳候选规则后规则库多了一条（巨乳）',
      rl.some(r => r.value === '巨乳' && r.action === 'block'));
    check('采纳的规则带 learnedFrom 溯源信息',
      rl.some(r => r.value === '巨乳' && r.learnedFrom && typeof r.learnedFrom.coverage === 'number'));
    check('采纳后写入 dismissedLearn（不再重复推荐）',
      !!(store.sf_data_v1.dismissedLearn || {})['block|tag|巨乳']);

    // —— 切换场景档位：应把 g1 分组关掉、activeProfile 记下 ——
    const applyBtn = doc.querySelector('[data-profapply="p_test1"]');
    if (applyBtn) applyBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    setTimeout(() => {
      check('切换到档位后 activeProfile 被记录', store.sf_data_v1.activeProfile === 'p_test1');
      const g = (store.sf_data_v1.groups || []).filter(x => x.id === 'g1')[0];
      check('切换到档位后分组开关按档位设置生效（g1 关闭）', !!g && g.on === false);

      // 撤销：删除一条规则 → 撤销恢复
      const before = (store.sf_data_v1.rules || []).length;
      const delBtn = doc.querySelector('#ruleTable tbody tr[data-id="r1"] button[data-act="del"]');
      delBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      const afterDel = (store.sf_data_v1.rules || []).length;
      check('删除规则后数量 -1', afterDel === before - 1);
      doc.querySelector('#undoBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      const afterUndo = (store.sf_data_v1.rules || []).length;
      check('撤销后规则数量恢复', afterUndo === before);

      // 冲突一键修复
      doc.querySelector('#fixConflicts').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      setTimeout(() => {
        // 注意判据要指名 favorite：修复后**允许**残留的是「放行（例外）」——它不该被删。
        // 早先这里写的是 `r.action !== 'block'`，那只在"除 block 外只剩冲突项"时才成立。
        const stillFav = (store.sf_data_v1.rules || []).some(r => r.value === '冲突女优' && r.action === 'favorite');
        check('一键修复后冲突的收藏规则被移除', !stillFav);
        const blockKept = (store.sf_data_v1.rules || []).some(r => r.value === '冲突女优' && r.action === 'block');
        check('一键修复保留了屏蔽规则', blockKept);
        // 例外不是冲突（它和屏蔽是刻意共存的），一键修复不该把用户的逃生门一起删掉
        const allowKept = (store.sf_data_v1.rules || []).some(r => r.value === '冲突女优' && r.action === 'allow');
        check('一键修复不会误删同值的「放行（例外）」规则', allowKept);
        check('存储里仍保留 watchlist（未被设置页写丢）', !!store.sf_data_v1.watchlist && !!store.sf_data_v1.watchlist['ABC-777']);
        check('存储里仍保留 recFeedbackDaily（未被写丢）', !!store.sf_data_v1.recFeedbackDaily);
        // 软屏蔽的放行记录同样不能被设置页写丢（save() 是整体写回）
        check('存储里仍保留 peeks["ABC-555"]（未被设置页写丢）',
          !!(store.sf_data_v1.peeks && store.sf_data_v1.peeks['ABC-555']));
        // 新字段同样不能被写丢（这是"整体写回丢字段"最容易出事的地方）
        check('存储里仍保留 learned.items（未被设置页写丢）',
          !!store.sf_data_v1.learned && Array.isArray(store.sf_data_v1.learned.items));
        check('存储里仍保留 expiredLog（未被设置页写丢）',
          Array.isArray(store.sf_data_v1.expiredLog) && store.sf_data_v1.expiredLog.length >= 1);
        // —— 放行时长可调：改成 48 后写入 settings.peekHours ——
        const ph = doc.querySelector('#peekHours');
        if (ph) { ph.value = '48'; ph.dispatchEvent(new win.Event('change', { bubbles: true })); }
        setTimeout(() => {
          check('放行时长保存为 48 小时', (store.sf_data_v1.settings || {}).peekHours === 48);

          // —— 撤销单条放行记录 ——
          const delPeek = doc.querySelector('#peekList [data-peekdel="ABC-666"]');
          check('放行记录行带「撤销」按钮', !!delPeek);
          if (delPeek) delPeek.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
          setTimeout(() => {
            check('撤销后 ABC-666 从 peeks 移除', !(store.sf_data_v1.peeks || {})['ABC-666']);
            check('撤销后 ABC-555 仍在 peeks（未被连带清掉）', !!(store.sf_data_v1.peeks || {})['ABC-555']);

            /* ===== 分项回滚：真的能只恢复「规则」而不动收藏 =====
               走完整 UI 路径：伪造 FileReader → 选中 #partialFile → 渲染出区块表
               → 只勾「规则库」→ 点恢复 → 断言规则变了、收藏 / 已看原样。 */
            const BK = {
              schemaVersion: 6,
              rules: [{ id: 'rb1', type: 'actress', value: '从备份恢复的女优', action: 'block', match: 'contains', scope: 'actress', enabled: true, hits: 0, createdAt: now }],
              groups: [{ id: 'gb1', name: '备份分组', enabled: true }],
              seen: { 'FROM_BACKUP': 123 },
              favCodes: { 'ZZZ-999': { t: '备份收藏', u: '', s: 'javbus', at: now } },
            };
            const favBefore = JSON.stringify(store.sf_data_v1.favCodes || {});
            const seenBefore = JSON.stringify(store.sf_data_v1.seen || {});
            const rulesCountBefore = (store.sf_data_v1.rules || []).length;

            win.FileReader = function () {
              this.readAsText = () => { this.result = JSON.stringify(BK); this.onload && this.onload(); };
            };
            const pf = doc.querySelector('#partialFile');
            Object.defineProperty(pf, 'files', { value: [{ name: 'backup-test.json' }], configurable: true });
            pf.dispatchEvent(new win.Event('change', { bubbles: true }));

            setTimeout(() => {
              check('选择备份后渲染出区块表', !!doc.querySelector('#partialBox table'));
              check('区块表列出「规则库」', doc.querySelector('#partialBox').textContent.indexOf('规则库') !== -1);
              const secs = doc.querySelectorAll('#partialBox .prSec');
              check('所有区块默认不勾选（防误操作）',
                secs.length > 0 && Array.prototype.every.call(secs, c => c.checked === false));
              check('备份里没有的区块被标注「无法恢复」',
                doc.querySelector('#partialBox').textContent.indexOf('无法恢复') !== -1);

              /* ---- 干跑差异预览 ----
                 回滚页此前只说「备份里有多少条」，那说的是**备份**，不是**后果**：
                 replace 型区块会整体替换，当前有、备份里没有的条目会被静默丢掉。
                 这里断言「恢复后会发生什么」被算出来并显示，且 merge 型不会被误标成会删。 */
              check('回滚表有「恢复后（相对当前）」列',
                doc.querySelector('#partialBox').textContent.indexOf('恢复后（相对当前）') !== -1);
              const rowTxt = k => {
                const cb = Array.prototype.find.call(secs, c => c.value === k);
                const tr = cb && cb.closest ? cb.closest('tr') : null;
                return tr ? tr.textContent : '';
              };
              const rulesRowTxt = rowTxt('rules');
              check('干跑：规则库标出「+1 新增」', /\+\d+ 新增/.test(rulesRowTxt));
              check('干跑：规则库标出会丢失 ' + rulesCountBefore + ' 条（replace 型整体替换，当前多出的会被丢掉）',
                rulesRowTxt.indexOf('−' + rulesCountBefore + ' 条丢失') !== -1);
              const favRowTxt = rowTxt('favCodes');
              check('干跑：番号收藏是 merge 型，只增不删（不出现「丢失」字样）',
                /\+\d+ 新增/.test(favRowTxt) && favRowTxt.indexOf('丢失') === -1);

              // 只勾「规则库」
              const rulesCb = Array.prototype.find.call(secs, c => c.value === 'rules');
              check('找到「规则库」勾选框', !!rulesCb);
              if (rulesCb) rulesCb.checked = true;
              const applyBtn = doc.querySelector('#prApply');
              check('有「恢复勾选的区块」按钮', !!applyBtn);
              let confirmMsg = '';
              win.confirm = msg => { confirmMsg = msg; return true; };
              if (applyBtn) applyBtn.click();
              check('确认框带上了后果（区块名 + 会丢多少），而不只是区块名',
                confirmMsg.indexOf('规则库') !== -1 && confirmMsg.indexOf('丢掉') !== -1);
              check('确认框说明了未勾选区块不受影响',
                confirmMsg.indexOf('未勾选的区块保持现状不变') !== -1);

              setTimeout(() => {
                const rulesAfter = store.sf_data_v1.rules || [];
                check('分项恢复：规则确实被替换成备份里的内容',
                  rulesAfter.length === BK.rules.length &&
                  rulesAfter[0] && rulesAfter[0].value === '从备份恢复的女优');
                check('分项恢复：规则数从 ' + rulesCountBefore + ' 变为备份里的 ' + BK.rules.length,
                  rulesAfter.length !== rulesCountBefore);
                check('分项恢复：未勾选的收藏原样未动（' + favBefore + '）',
                  JSON.stringify(store.sf_data_v1.favCodes || {}) === favBefore);
                check('分项恢复：未勾选的已看记录原样未动',
                  JSON.stringify(store.sf_data_v1.seen || {}) === seenBefore);
                check('分项恢复：未勾选的分组原样未动',
                  !(store.sf_data_v1.groups || []).some(g => g && g.id === 'gb1'));

                finishTests();
              }, 250);
            }, 150);
          }, 150);
        }, 150);
      }, 200);
    }, 220);
  }, 220);
}, 300);

/* =====================================================================
 * C：规则命中时效画像（数据结构 v7）
 *
 * 为什么单独起一份设置页实例，而不是在上面那套夹具里加规则：
 *   ① 上面的断言对「规则条数」敏感（有 4 条 / 7 条之类的硬编码），
 *      往夹具里塞规则会连带改好几处无关断言；
 *   ② options.js 首行是 'use strict' —— 经 win.eval 执行时，它的 var/function
 *      只落在 **eval 自己的变量环境**里，不会挂到 window 上（严格模式 eval 的语义，
 *      已实测确认）。所以拿不到 win.renderAudit()，调不了内部函数。
 * 于是改为「按场景重建一份设置页，断言 renderAll 的产物」—— 反而更接近真实路径。
 * ===================================================================== */
function bootOptionsWithRules(rules) {
  const st = {
    sf_data_v1: Object.assign({}, store.sf_data_v1, { rules: JSON.parse(JSON.stringify(rules)) }),
  };
  const d = new JSDOM(html, {
    url: 'chrome-extension://abc/options.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = d.window;
  const get = (k, cb) => {
    const o = {};
    if (typeof k === 'string') o[k] = st[k]; else Object.keys(k).forEach(x => o[x] = st[x]);
    cb(o);
  };
  const set = (o, cb) => { Object.assign(st, o); if (cb) cb(); };
  w.chrome = {
    storage: { local: { get, set }, sync: { get, set }, onChanged: { addListener() { } } },
    runtime: { sendMessage() { }, openOptionsPage() { }, onMessage: { addListener() { } } },
  };
  w.alert = function () { };
  w.confirm = function () { return true; };
  w.prompt = function () { return ''; };
  w.URL.createObjectURL = function () { return 'blob:x'; };
  w.URL.revokeObjectURL = function () { };
  // options.js 里 <a download> 的静音与主夹具同理
  w.HTMLAnchorElement.prototype.click = function () { };
  w.eval(fs.readFileSync(path.join(EXT, 'site-templates.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(EXT, 'expr.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(EXT, 'rulecheck.js'), 'utf8'));
  w.eval(js);
  return w;
}

function finishTests() {
  // 与 todayStr() / statsLog 同一口径：月、日不补零
  const dk = off => {
    const d = new Date(Date.now() - off * 864e5);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  };
  const base = {
    type: 'actress', action: 'block', match: 'contains', scope: 'actress',
    color: '', sites: [], enabled: true, expr: '', expiresAt: 0,
    createdAt: now - 200 * 864e5,
  };
  const rules = [
    // ④ 近期失效：**曾经命中过**（hits>0），但分桶里只有 45 天前的记录 → 近 30 天 0
    Object.assign({}, base, {
      id: 'cStale', value: '改版后失效的女优', hits: 12,
      lastHit: Date.now() - 45 * 864e5, hitDays: { [dk(45)]: 8 },
    }),
    // 窗口判据的另一侧：也有 50 天前的桶（窗口外）、但 20 天前有命中（窗口内）→ 不算失效
    Object.assign({}, base, {
      id: 'cAlive', value: '有点冷但还在命中的女优', hits: 40,
      lastHit: Date.now() - 20 * 864e5, hitDays: { [dk(50)]: 30, [dk(20)]: 2 },
    }),
    // 升级前的老数据：有 hits 有 lastHit，但**没有分桶** → 绝不能被报成失效
    Object.assign({}, base, {
      id: 'cLegacy', value: '升级前的老规则', hits: 20, lastHit: Date.now() - 90 * 864e5,
    }),
    // 规则表：近期活跃 → 命中列显示「近 30 天 3」
    Object.assign({}, base, {
      id: 'cFresh', value: '近期活跃的女优', hits: 3,
      lastHit: Date.now() - 3600e3, hitDays: { [dk(0)]: 3 },
    }),
  ];

  const w = bootOptionsWithRules(rules);
  setTimeout(() => {
    const doc = w.document;
    const audit = doc.querySelector('#auditBox').textContent;
    const auditCnt = doc.querySelector('#auditCount').textContent;

    check('[C][体检] 统计文案出现「近期失效」', auditCnt.indexOf('近期失效') !== -1);
    check('[C][体检] 「曾经命中、近 30 天断档」的规则被列出', audit.indexOf('改版后失效的女优') !== -1);
    check('[C][体检] 提示要先去核对站点、别急着删（不是直接删掉）', audit.indexOf('站点改版') !== -1);
    check('[C][体检] 失效规则不进「从未命中」那类（两类互斥）',
      doc.querySelector('#auditBox tr[data-audit="cStale"]') === null);
    // —— 窗口判据两侧 ——
    check('[C][体检] 30 天窗口：45 天前的桶不算命中 → 判为失效', audit.indexOf('改版后失效的女优') !== -1);
    check('[C][体检] 30 天窗口：20 天前有命中 → 不判失效', audit.indexOf('有点冷但还在命中的女优') === -1);
    // —— 老数据回归（最关键）——
    check('[C][回归] 无分桶数据的老规则不被误报为「近期失效」', audit.indexOf('升级前的老规则') === -1);
    check('[C][回归] 老规则也不进「从未命中」类（它有 hits，不该被一刀切）',
      doc.querySelector('#auditBox tr[data-audit="cLegacy"]') === null);

    const rt = doc.querySelector('#ruleTable').textContent;
    check('[C] 规则表命中列出现「近 30 天」', rt.indexOf('近 30 天') !== -1);
    check('[C] 「近 30 天」显示的是窗口内增量（cFresh = 3）', /近 30 天\s*3/.test(rt));
    check('[C] 近期为 0 的规则照常显示「近 30 天 0」（0 是有信息的，不该省略）',
      /近 30 天\s*0/.test(rt));
    const legacyRow = doc.querySelector('#ruleTable tr[data-id="cLegacy"]');
    check('[C] 无分桶数据的老规则那一行不显示「近 30 天」（null 不渲染成 0）',
      !!legacyRow && legacyRow.textContent.indexOf('近 30 天') === -1);

    // 月度回顾：有分桶 → 走精确路径（本月增量），不再拿累计值冒充
    const month = doc.querySelector('#monthBox').textContent;
    check('[C][月度] 有分桶时表头用「本月命中」', month.indexOf('本月命中') !== -1);
    check('[C][月度] 有分桶时不再显示「累计命中」冒充月增量', month.indexOf('累计命中') === -1);
    check('[C][月度] 说明里写明是精确的本月增量', month.indexOf('精确值') !== -1);

    // 老数据（无分桶）→ 退回近似路径，并**明确标注是近似**
    const wOld = bootOptionsWithRules([
      Object.assign({}, base, { id: 'oL1', value: '老规则甲', hits: 5, lastHit: Date.now() - 3600e3 }),
      Object.assign({}, base, { id: 'oL2', value: '老规则乙', hits: 9, lastHit: Date.now() - 7200e3 }),
    ]);
    setTimeout(() => {
      const doc2 = wOld.document;
      const month2 = doc2.querySelector('#monthBox').textContent;
      check('[C][月度][回归] 无分桶时退回近似路径（表头标「近似」）', month2.indexOf('（近似）') !== -1);
      check('[C][月度][回归] 近似路径下用「累计命中」并说明原因', month2.indexOf('累计命中') !== -1);
      check('[C][月度][回归] 老数据不显示「近 30 天」（无数据 ≠ 0）',
        doc2.querySelector('#ruleTable').textContent.indexOf('近 30 天') === -1);
      check('[C][体检][回归] 老数据不会被报成「近期失效」',
        doc2.querySelector('#auditCount').textContent.indexOf('近期失效') === -1);

      console.log(pass ? '\n设置页测试全部通过 ✅' : '\n存在失败 ❌');
      process.exit(pass ? 0 : 1);
    }, 300);
  }, 300);
}

