/* content script 装配守卫。
 *
 * 为什么要有这一套：content script 已经不是单文件了，它由
 *   expr.js → rulecheck.js → site-templates.js → magnet-core.js → content.js → xchina-download.js
 * 依次注入到同一个隔离世界。这种「装配」坏掉的方式几乎都是**静默**的：
 *   ① 顺序颠倒：后加载的模块在加载期读不到前一个的命名空间 → ReferenceError；
 *      若是反过来（模块用到 content.js 的全局）则表现为「功能少一半」；
 *   ② 新脚本漏进打包白名单：本地门禁全绿、装进浏览器直接坏 —— rulecheck.js 真的漏过一次；
 *   ③ 测试自己 readFileSync('content.js') 再 eval：新模块没被加载，
 *      于是这个测例悄悄少测一层（或直接加载期报错，看起来像语法问题）。
 * 三条都在这里钉死。第三条是最容易被漏掉的：它需要「测试内部加载方式」的静态检查。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const EXT = __dirname;
let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const loader = require('./_load.js');

/* 共享模块：内容脚本里「供别人使用」的模块，必须排在 content.js 之前。
   顺序不是随便定的 —— Chrome 按数组顺序注入，后一个执行时前一个的全局已就位。 */
const SHARED = ['expr.js', 'rulecheck.js', 'site-templates.js', 'magnet-core.js'];

const scripts = loader.CONTENT_SCRIPTS;
check('_load.js 的顺序与 manifest 完全一致', (function () {
  const fromManifest = (manifest.content_scripts || []).reduce((a, cs) => a.concat(cs.js || []), []);
  return JSON.stringify(scripts) === JSON.stringify(fromManifest);
})());
check('manifest 声明了 site-templates.js / content.js 与 xchina-download.js',
  ['site-templates.js', 'content.js', 'xchina-download.js'].every(s => scripts.indexOf(s) !== -1));

const iContent = scripts.indexOf('content.js');
SHARED.forEach(s => {
  const i = scripts.indexOf(s);
  check(s + ' 已进 content_scripts 且排在 content.js 之前',
    i !== -1 && i < iContent);
});
check('content.js 是最后一个「通用」脚本（后面只允许站点专用脚本）',
  iContent === scripts.length - 2 && scripts[scripts.length - 1] === 'xchina-download.js');

/* 白名单：manifest 引用的每个文件都必须真的进包。
   与 _test_collector_native.js 的那条是同一件事的两道防线 —— 那条防「有人改坏 make_package」，
   这条防「有人往 manifest 里加文件却忘了白名单」。重复是有意的。 */
{
  const packager = fs.readFileSync(path.join(EXT, 'make_package.py'), 'utf8');
  const block = packager.slice(packager.indexOf('INCLUDE_FILES = ['));
  const whitelist = new Set((block.slice(0, block.indexOf(']')).match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)));
  const refs = [];
  for (const cs of manifest.content_scripts || []) refs.push(...(cs.js || []), ...(cs.css || []));
  const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  for (const m of bg.matchAll(/importScripts\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.push(m[1]);
  const missing = refs.filter(r => !whitelist.has(r.replace(/\\/g, '/')));
  check('打包白名单覆盖 manifest / importScripts 引用的全部文件', missing.length === 0);
  if (missing.length) console.log('        漏配：' + missing.join(', '));
}

/* 共享模块必须能在 Node 下独立 require —— 这是「真的抽出来了」的实证，
   也是它们能被单测的前提。顺带确认命名空间没写错。 */
[['expr.js', 'SF_EXPR'], ['rulecheck.js', 'SF_RULECHECK'],
 ['site-templates.js', 'SF_SITES'], ['magnet-core.js', 'SF_MAGNET']].forEach(([f, ns]) => {
  let ok = false, keys = 0;
  try { const m = require(path.join(EXT, f)); keys = Object.keys(m || {}).length; ok = keys > 0; } catch (e) { ok = false; }
  check(f + ' 可被 Node 独立 require 且导出非空（' + ns + '，' + keys + ' 项）', ok);
});

/* 关键：不允许任何测试再自己 readFileSync('content.js') 去执行。
   做法：找出每个测例里「绑到 content.js 源码」的变量名，再看它有没有被交给 eval/runInContext。
   （只看 content.js；background.js / options.js 是各自独立的入口，不在此列。） */
{
  const files = fs.readdirSync(EXT).filter(f => f === '_smoke.js' || /^_test_.*\.js$/.test(f));
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(EXT, f), 'utf8');
    const names = [];
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*fs\.readFileSync\([^)]*'content\.js'[^)]*\)/g)) names.push(m[1]);
    for (const n of names) {
      const used = new RegExp('(\\bwin\\.eval\\(|\\bvm\\.runInContext\\(|\\beval\\()\\s*' + n + '\\b').test(src);
      if (used) offenders.push(f + ':' + n);
    }
  }
  check('没有测例绕过 _load.js 直接执行 content.js 源码', offenders.length === 0);
  if (offenders.length) console.log('        违规：' + offenders.join(', ') + '（应改用 require(\'./_load\').contentBundle()）');
}

/* 同理守 background.js：它现在依赖 importScripts 进来的 site-templates.js，
   谁再直接 readFileSync('background.js') 去 vm 里执行，就会在加载期抛「SF_SITES 未加载」。
   唯一豁免是自带 importScripts 桩的测例 —— 那正是在测真实的加载机制，比拼接更强。 */
{
  const files = fs.readdirSync(EXT).filter(f => f === '_smoke.js' || /^_test_.*\.js$/.test(f));
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(EXT, f), 'utf8');
    if (/importScripts\s*=/.test(src)) continue;   // 自带桩，合法
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*fs\.readFileSync\([^)]*'background\.js'[^)]*\)/g)) {
      const n = m[1];
      const used = new RegExp('(\\bwin\\.eval\\(|\\bvm\\.runInContext\\(|\\beval\\()\\s*(?:\\w+\\.)?' + n + '\\b').test(src);
      if (used) offenders.push(f + ':' + n);
    }
  }
  check('没有测例绕过 _load.js 直接执行 background.js 源码', offenders.length === 0);
  if (offenders.length) console.log('        违规：' + offenders.join(', ') + '（应改用 require(\'./_load\').backgroundBundle()）');
}

/* Tier B（指定下载器）的本机代理必须进包。
   这条发现不了 —— native-host/ 不被 manifest 引用，它是设置页文案让用户去跑的东西；
   而 INCLUDE_DIRS 曾经只有 icons，EXCLUDE_RE 又顺手排掉所有 .py/.md。
   两件事叠起来：zip 里没有 native-host/、用户照提示找不到 install.py，门禁却全绿。
   行为侧（真的算一遍 collect）由 _test_native_host.py 复核，这里守白名单声明本身。 */
{
  const packager = fs.readFileSync(path.join(EXT, 'make_package.py'), 'utf8');
  const grabList = name => {
    const i = packager.indexOf(name + ' = [');
    if (i === -1) return [];
    return (packager.slice(i, packager.indexOf(']', i)).match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
  };
  const extra = grabList('INCLUDE_DIR_EXTRA');
  const required = ['native-host/host.py', 'native-host/install.py'];
  check('Tier B 的本机代理在显式放行名单里（host.py + install.py）',
    required.every(f => extra.indexOf(f) !== -1));
  check('native-host 在打包目录白名单里（以后往目录里加文件不会静默漏掉）',
    grabList('INCLUDE_DIRS').indexOf('native-host') !== -1);
  check('打包脚本只有一个「会不会进包」的判据 is_packable（不许各处各写一套过滤）',
    /def is_packable\(rel\):/.test(packager) &&
    (packager.match(/EXCLUDE_RE\.search\(/g) || []).length === 1);
}

/* 测试文件不许硬编码本机绝对路径。
 *
 * 这条是补的：12 个测试文件都把仓库路径**写死成开发机的绝对路径**
 * （`const EXT = '<C 盘用户目录>/Desktop/site-filter';` 这种形态，具体串见 git 历史），
 * 其中 3 个真的拿它去 readFileSync —— 于是 GitHub Actions 的 Linux runner 上
 * 直接 ENOENT 抛异常、脚本立刻死（表现为「❌ 通过 0 失败 0」，看着像断言失败其实
 * 一条断言都没跑）。本地 `python ci.py` 永远全绿，因为那台机器上这个路径真的存在。
 *
 * ⇒ **「本地全绿」不等于「CI 绿」**。这条守卫就是让「本地绿、CI 红」不再可能悄悄发生：
 *    ① 只要文件里用到 EXT，它的声明就必须是 __dirname；
 *    ② 不许出现本机用户目录形态的绝对路径（Windows 盘符 + Users，或 macOS /Users/<名字>/）。
 *       只钉这两种形态，是为了不误伤 fixture 里的假路径（如 output_dir: 'D:/Downloads/...'）。
 */
{
  const BAD_PATH = /C:[\\/]{1,2}Users[\\/]|\/Users\/[A-Za-z0-9._-]+\//;
  const all = fs.readdirSync(EXT).filter(f => /^_test_.*\.(js|py)$/.test(f) || f === '_smoke.js');
  const jsFiles = all.filter(f => /\.js$/.test(f));

  const wrongExt = [], pathHits = [];
  for (const f of jsFiles) {
    const src = fs.readFileSync(path.join(EXT, f), 'utf8');
    if (/\bEXT\b/.test(src) && !/const\s+EXT\s*=\s*__dirname\s*;/.test(src)) wrongExt.push(f);
  }
  for (const f of all) {
    fs.readFileSync(path.join(EXT, f), 'utf8').split('\n').forEach((l, i) => {
      if (BAD_PATH.test(l)) pathHits.push(f + ':' + (i + 1) + ' ' + l.trim().slice(0, 80));
    });
  }
  check('用到 EXT 的测试文件都以 __dirname 声明（写死本机路径会让 CI 崩）', wrongExt.length === 0);
  if (wrongExt.length) console.log('        违规：' + wrongExt.join(', '));
  check('测试文件里没有本机用户目录的绝对路径', pathHits.length === 0);
  if (pathHits.length) pathHits.forEach(h => console.log('        ' + h));
}

/* 套件崩溃（0/0 且 exit≠0）必须留下线索。
 * 同上一次踩的坑：崩溃时一行 FAIL 都没有，而 run_tests() 以前只在「失败>0」时收集明细，
 * 于是 CI 日志里只剩「❌ 通过 0 失败 0」—— 结论明明在 stderr 里，被门禁自己吞了。 */
{
  const packager = fs.readFileSync(path.join(EXT, 'make_package.py'), 'utf8');
  check('run_tests() 会区分「崩溃」与「断言失败」',
    /CRASH_TAIL_LINES/.test(packager) && /crashedSuites/.test(packager));
  check('run_tests() 崩溃时会回显套件末尾输出（而不是只印一行 ❌）',
    /末尾/.test(packager) && /record\(/.test(packager));
}

/* iframe 探测：子 frame 只探测 + 上报，顶层 frame 汇总展示。
 *
 * 这条链上有几处「顺手简化一下就会坏」的地方，而且全是静默的：
 *   ① manifest 的 all_frames 被改回 false → 子 frame 里根本不注入，功能整体失效，
 *      但本地测试照样全绿（测试自己塞 sandbox，不读 manifest）；
 *   ② 子 frame 里顺手建 UI / 应用规则 → iframe（这类站点里多为隐藏广告位或播放器）
 *      里长出一个悬浮球，或者规则把 iframe 内部 DOM 改坏（连面板都没有，用户看不到）；
 *   ③ 转发时 frameId 取自 msg 自述而非 sender.frameId → 任何 frame 都能冒充别的 frame；
 *      更要紧的是有人图省事把通道换成 window.top.postMessage —— 那样**页面脚本**也能
 *      往「下载」页签里塞链接，而这些链接最终会被「打开」，不能由页面决定。
 * 行为侧由 _test_magnet.js 用真实 jsdom <iframe> 复核（那边 W.top !== W.self 自然成立），
 * 这里守的是声明本身。 */
{
  const cs = (manifest.content_scripts || [])[0] || {};
  check('manifest 开启 all_frames（否则子 frame 里根本不注入，功能整体失效）', cs.all_frames === true);
  const content = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
  const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  check('content.js 判定「自己是不是顶层 frame」',
    /var IS_TOP =/.test(content) && /window\.top === window\.self/.test(content));
  check('子 frame 走独立启动路径（bootFrame），不建 UI',
    /function bootFrame\(/.test(content) && /if \(!IS_TOP\) \{ bootFrame\(\); return; \}/.test(content));
  check('bootFrame 里不建 UI、不碰面板', (function () {
    const i = content.indexOf('function bootFrame(');
    if (i === -1) return false;
    const body = content.slice(i, content.indexOf('\n  function boot(', i));
    return body.length > 0 && body.indexOf('buildUI') === -1 && body.indexOf('keys(') === -1;
  })());
  check('runPass 在子 frame 里只探测、拿到结果就返回（不应用规则）', (function () {
    const i = content.indexOf('function runPass()');
    if (i === -1) return false;
    const body = content.slice(i, i + 1400);
    return /if \(!IS_TOP\) \{[\s\S]*?probeLinks\(\);[\s\S]*?return;/.test(body);
  })());
  check('子 frame → 顶层 走后台转发，frameId 取自 sender（不信 msg 自述）',
    /msg\.type === 'sf_frame_probe'/.test(bg) && /sender\.frameId/.test(bg));
  check('后台只把上报转给 frameId 0（顶层）', /\{ frameId: 0 \}/.test(bg));
  // 判「有没有用」时先剥掉注释行 —— 否则解释「为什么不用它」的注释会被自己绊倒
  // （这条踩过两次：本文件和 _test_assembly 的路径守卫都被自己的注释命中过）。
  const codeOf = src => src.split('\n')
    .filter(l => { const t = l.trim(); return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')); })
    .join('\n');
  check('通道没有被退化成 window.top.postMessage（那是页面可伪造的）',
    codeOf(content).indexOf('window.top.postMessage') === -1 &&
    codeOf(bg).indexOf('window.top.postMessage') === -1);
}

console.log('\n' + (pass ? '全部通过' : '存在失败项'));
process.exit(pass ? 0 : 1);
