/* SiteFilter 测试用的 content script 装载器。
 *
 * 为什么要有它：content script 现在由多个文件按顺序注入（expr.js / rulecheck.js /
 * magnet-core.js / content.js / xchina-download.js）。过去每个测例都自己
 * `readFileSync('content.js')` —— 那样一旦拆分（或新增）一个 content script，就得记得
 * 去改十几个测试；漏改的表现是加载期 ReferenceError，或者更隐蔽的「某个测例悄悄少测了一层」。
 *
 * 这里把顺序的**单一事实来源**钉死在 manifest.json 的 content_scripts[].js 上，
 * 与 Chrome 实际注入的顺序完全一致。测试只调 contentBundle()。
 *
 * backgroundBundle() 是同一件事的 service worker 版本：background.js 靠 importScripts
 * 载入 site-templates.js / *-native.js，直接 readFileSync 它会在加载期抛「SF_SITES 未加载」。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const EXT = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

/** 按 manifest 声明顺序列出全部 content script 文件名 */
const CONTENT_SCRIPTS = (manifest.content_scripts || [])
  .reduce((acc, cs) => acc.concat(cs.js || []), []);

/** 读单个脚本的源码 */
function readScript(name) {
  return fs.readFileSync(path.join(EXT, name), 'utf8');
}

/** 单个脚本源码（做「源码文本守卫」断言时用，别拿 bundle 去做这种事：
 *  bundle 里还有其它文件，正向断言会被别的文件蒙对，负向断言会被别的文件冤杀） */
function script(name) {
  return readScript(name);
}

/** 按 manifest 顺序拼接后的整体源码，等价于 Chrome 在同一隔离世界里依次注入 */
function contentBundle() {
  return CONTENT_SCRIPTS.map(readScript).join('\n;\n');
}

/** background.js 依赖的 importScripts 目标。
 *  顺序的单一事实来源同样是 background.js 自己 —— 不在这里另抄一份清单。 */
function backgroundImports() {
  const out = [];
  for (const m of readScript('background.js').matchAll(/importScripts\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

/** 等价于 service worker 的加载结果：importScripts 目标（按序）→ background.js 本身。
 *  service worker 里 importScripts 把模块灌进同一个全局；测试里拼接执行是同一件事。 */
function backgroundBundle() {
  return backgroundImports().map(readScript).concat([readScript('background.js')]).join('\n;\n');
}

module.exports = { EXT, manifest, CONTENT_SCRIPTS, readScript, script, contentBundle, backgroundImports, backgroundBundle };
