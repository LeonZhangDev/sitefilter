/* 规则体检 / 影响面预演 共用匹配口径（rulecheck.js）专项测试
 *
 * 背景：options.js 里 simHits() 与 ruleImpact() 都要拿「一条规则」去匹配
 * 「发现库里的一个实体名」，但历史上口径不一致 —— simHits 尊重 match(精确/正则)
 * 与别名，ruleImpact 却用裸 indexOf 子串，于是「影响面预演」算得准、「规则体检」
 * 的过宽判定却会漏判正则/精确/别名规则。本套件把口径收口到 rulecheck.js::matchEntity，
 * 并钉死它和 content.js::matchRule 的关键词判定完全一致（防止日后两份逻辑再漂走）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const EXT = 'C:\\Users\\admin\\Desktop\\site-filter';
const contentCode = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
const rulecheckCode = fs.readFileSync(path.join(EXT, 'rulecheck.js'), 'utf8');
const exprCode = fs.readFileSync(path.join(EXT, 'expr.js'), 'utf8');

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BASE_SETTINGS = {
  enabled: true, sfw: false, onlyFav: false, onlyFavCode: false, boss: false,
  showBall: true, pinHighlight: true, markSeen: true, favBtn: false,
  watchBtn: false, showWhy: false, blockDisplay: 'placeholder',
  hlColor: '#00e5ff', ball: { right: 24, bottom: 24 }, onboarded: true,
  probeLinks: true, probeMark: true, probeAnySite: true, backfill: 'off',
};
const PAGE = '<!doctype html><html><body><div class="container"></div></body></html>';

function build() {
  const dom = new JSDOM(PAGE, { url: 'https://example.com/page', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  win.Element.prototype.getBoundingClientRect = function () { return { width: 220, height: 320, top: 0, left: 0, right: 220, bottom: 320, x: 0, y: 0 }; };
  const store = {};
  store['sf_data_v1'] = {
    settings: Object.assign({}, BASE_SETTINGS),
    sites: [], rules: [], groups: [], seen: {}, favCodes: {}, discovered: {},
    dailyRecs: [], recHistory: [], peeks: {}, errLog: [],
  };
  win.chrome = {
    storage: { local: {}, sync: {}, onChanged: { addListener() { } } },
    runtime: { sendMessage() { return Promise.resolve(); }, onMessage: { addListener() { } } },
  };
  const dlGet = (k, cb) => cb({ [k]: store[k] });
  const dlSet = (o, cb) => { Object.assign(store, o); if (cb) cb(); };
  const chromeProxy = new Proxy(win.chrome, {
    get(t, k) {
      if (k === 'storage') return new Proxy(t.storage, { get(s, area) {
        if (area === 'local') return { get: dlGet, set: dlSet };
        if (area === 'sync') return { get: (k2, cb) => cb({}), set: dlSet };
        return s[area];
      } });
      return t[k];
    },
  });
  const sandbox = {
    window: win, document: win.document, location: win.location, navigator: win.navigator, chrome: chromeProxy,
    setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win),
    addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win), MutationObserver: win.MutationObserver,
    Node: win.Node, Element: win.Element, HTMLElement: win.HTMLElement,
    KeyboardEvent: win.KeyboardEvent, MouseEvent: win.MouseEvent, CustomEvent: win.CustomEvent,
    Map, Set, WeakMap, Promise, JSON, Math, Date, URL, URLSearchParams,
    RegExp, String, Number, Boolean, Array, Object, Error,
    console: { log() { }, warn() { }, error() { } },
    decodeURIComponent, encodeURIComponent, parseInt, parseFloat, isNaN,
    atob: win.atob.bind(win), btoa: win.btoa.bind(win),
  };
  sandbox.globalThis = sandbox;
  win.__siteFilterTestApi = 'magnet-only';
  vm.createContext(sandbox);
  vm.runInContext(exprCode, sandbox, { filename: 'expr.js' });
  vm.runInContext(rulecheckCode, sandbox, { filename: 'rulecheck.js' });
  vm.runInContext(contentCode, sandbox, { filename: 'content.js' });
  return { win, sandbox };
}

(async () => {
  const { win: W, sandbox: SB } = build();
  await sleep(700);
  // 注意：vm 沙箱里 globalThis === sandbox，rulecheck.js 把 SF_RULECHECK 挂到 sandbox 上；
  // 真实浏览器里 window === globalThis，options.js 用 window.SF_RULECHECK 即可（见 _test_options.js）。
  const me = SB.SF_RULECHECK && SB.SF_RULECHECK.matchEntity;
  const hook = W.__sfHook;

  check('[初始化] SF_RULECHECK.matchEntity 已加载', typeof me === 'function');
  check('[初始化] 只读测试钩子已挂载（matchRule 可比对）', hook && typeof hook.matchRule === 'function');

  /* ============ 第一层：matchEntity 自身语义 ============ */
  // contains
  check('[contains] 子串命中（巨乳 ⊂ 巨乳系）', me({ value: '巨乳' }, '巨乳系', 'tag') === true);
  check('[contains] 子串不命中（轻乳 ⊄ 巨乳系）', me({ value: '轻乳' }, '巨乳系', 'tag') === false);
  // exact：边界判定（这是 ruleImpact 旧实现会错的地方）
  check('[exact] 全等命中', me({ value: '巨乳', match: 'exact' }, '巨乳', 'tag') === true);
  check('[exact] 词内子串不算命中（巨乳系 ≠ 巨乳）', me({ value: '巨乳', match: 'exact' }, '巨乳系', 'tag') === false);
  check('[exact] 带分隔符的同词算命中（|巨乳|）', me({ value: '巨乳', match: 'exact' }, 'a|巨乳|b', 'tag') === true);
  // regex
  check('[regex] 正则命中', me({ value: '^abc', match: 'regex' }, 'abcdef', 'actress') === true);
  check('[regex] 正则不命中（非开头）', me({ value: '^abc', match: 'regex' }, 'xabc', 'actress') === false);
  check('[regex] 坏正则当不命中', me({ value: '(', match: 'regex' }, 'x(y)', 'actress') === false);
  // aliases：任一别名命中即算
  check('[aliases] 别名命中（Mikami）', me({ value: '三上', aliases: ['Mikami'] }, 'Mikami Yua', 'actress') === true);
  check('[aliases] 本体+别名都不命中', me({ value: '三上', aliases: ['Mikami'] }, '新垣结衣', 'actress') === false);
  // 大小写不敏感（这是修复 content.js::matchRule 前的静默漏匹配：只小写规则值、不小写卡片文本）
  check('[contains] 大小写不敏感：Mikami ⊂ Mikami Yua', me({ value: 'Mikami', match: 'contains' }, 'Mikami Yua', 'actress') === true);
  check('[回归] matchRule 大小写不敏感（Mikami 命中 Mikami Yua）', hook.matchRule({ value: 'Mikami', match: 'contains', scope: 'actress', enabled: true }, { actress: 'Mikami Yua', all: 'Mikami Yua', tag: '', maker: '', series: '', director: '' }) === true);
  // 跳过：expr / 无主体词
  check('[skip] 纯表达式规则返回 null（无法离线判定）', me({ expr: 'rating>=4' }, 'x', 'actress') === null);
  check('[skip] 无主体词返回 null', me({ value: '' }, 'x', 'actress') === null);

  /* ============ 第二层：matchEntity 必须与 content.js::matchRule 完全一致 ============
   * 这是收口的意义：规则体检(ruleImpact)与影响面预演(simHits)都改用 matchEntity 后，
   * 它们和线上真实匹配(matchRule)口径必须吻合，否则「体检说安全」但线上仍会挡。 */
  const fixtures = [
    { rule: { value: '巨乳', match: 'contains', scope: 'tag', enabled: true }, name: '巨乳系', scope: 'tag', want: true },
    { rule: { value: '巨乳', match: 'contains', scope: 'tag', enabled: true }, name: '轻乳', scope: 'tag', want: false },
    { rule: { value: '巨乳', match: 'exact', scope: 'tag', enabled: true }, name: '巨乳', scope: 'tag', want: true },
    { rule: { value: '巨乳', match: 'exact', scope: 'tag', enabled: true }, name: '巨乳系', scope: 'tag', want: false },
    { rule: { value: '^abc', match: 'regex', scope: 'actress', enabled: true }, name: 'abcdef', scope: 'actress', want: true },
    { rule: { value: '^abc', match: 'regex', scope: 'actress', enabled: true }, name: 'xabc', scope: 'actress', want: false },
    { rule: { value: '三上', aliases: ['Mikami'], match: 'contains', scope: 'actress', enabled: true }, name: 'Mikami Yua', scope: 'actress', want: true },
    { rule: { value: '三上', match: 'contains', scope: 'actress', enabled: true }, name: '新垣结衣', scope: 'actress', want: false },
    { rule: { value: '高清', match: 'contains', scope: 'all', enabled: true }, name: '高清中文', scope: 'all', want: true },
  ];
  let allAgree = true;
  fixtures.forEach(function (f) {
    const a = me(f.rule, f.name, f.scope);
    const ctx = { actress: '', tag: '', maker: '', series: '', director: '', all: '' };
    ctx[f.scope] = f.name; ctx.all = f.name;
    const b = hook.matchRule(f.rule, ctx);
    if (a !== b) {
      console.log('    DBG scope=' + f.scope + ' ctx=' + JSON.stringify(ctx) + ' matchRule=' + b + ' matchEntity=' + a);
      allAgree = false;
      console.log('      ✗ 不一致: rule=' + JSON.stringify(f.rule) + ' name=' + f.name + ' matchEntity=' + a + ' matchRule=' + b);
    }
  });
  check('[一致性] matchEntity 与 matchRule 在 ' + fixtures.length + ' 组实体样例上完全吻合', allAgree);

  console.log(pass ? '\n✅ 全部通过' : '\n❌ 有失败项');
  process.exit(pass ? 0 : 1);
})();
