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

console.log('\n' + (pass ? '全部通过' : '存在失败项'));
process.exit(pass ? 0 : 1);
