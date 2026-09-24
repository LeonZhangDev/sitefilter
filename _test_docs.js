/* 「实时性」文档与代码的一致性守卫。
 *
 * 为什么要有这一套：本项目的文档分两类 ——
 *   ① 实时性（README 的计数与版本声明、`docs/progress.md`、`docs/requirements/README.md` 的状态列）
 *      必须与代码同步；
 *   ② 历史锚定（`CHANGELOG.md`、`docs/aegis/**`、各需求文档的原始讨论）不许回改。
 * 第 ① 类坏掉的方式全部是**静默**的：代码往前走、文档留在原地，谁也不会在本地看出问题，
 * 直到有人照着文档去核对。这个项目已经踩过三次：
 *   · README 的断言计数写 21 套 / 1116，实际是 22 套 / 1141（漏计新增的 _test_assembly.js）；
 *   · README 的文件链少列了 3 个新增模块；
 *   · `docs/progress.md` 与 `docs/features/*` 一直写着「未合并 / 未推送 / 未发布」，而代码早已在
 *     `main` 上并推到了公开远端；`docs/requirements/README.md` 说三项新站的验证「仍未进行」，
 *     同一目录下的 004 报告里却有完整的验证记录。
 *   · `docs/verify/manual-acceptance.md` 的标题版本停在 `v1.3.0`、断言总数停在 1158，而当时已经是
 *     `1.3.1` / 1198。这份清单是**照着它去跑真机**的文档 —— 过期不会报错，只会让人拿着旧包的
 *     预期去验收新包，然后把「预期本来就不对」记成一个失败。
 * 所以这里把「能机械核对的部分」钉死。判不了的部分（比如「N 项断言」的确切数字）不在此列 ——
 * 那要靠跑门禁，不靠读文档，因此**验收清单里索性不再写死断言总数**，改成指向 `ci.py` 的输出。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const EXT = __dirname;
let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

const read = f => fs.readFileSync(path.join(EXT, f), 'utf8');
const readDoc = f => fs.readFileSync(path.join(EXT, f), 'utf8').replace(/\r\n/g, '\n');

const readme = readDoc('README.md');
const manifest = JSON.parse(read('manifest.json'));

/* 测试套数的**唯一**算法（README 与验收清单共用同一份，别各写一套）。
   发现规则与 make_package.py::test_suites() / py_test_suites() 保持一致：
   _smoke.js + 全部 _test_*.js + 全部 _test_*.py。加了套件却忘了改文档会在这里红。 */
const SUITE_COUNT = (() => {
  const files = fs.readdirSync(EXT);
  return (files.includes('_smoke.js') ? 1 : 0)
    + files.filter(n => /^_test_.*\.js$/.test(n)).length
    + files.filter(n => /^_test_.*\.py$/.test(n)).length;
})();

/* ---- 1. README 的版本声明必须等于 manifest.json / SCHEMA_VERSION 的真实值 ---- */
{
  const m = readme.match(/manifest version:\s*([0-9][0-9.]*)/);
  check('README 声明的 manifest version 与 manifest.json 一致'
    + (m ? '（' + m[1] + '）' : '（README 里没找到声明）'),
    !!m && m[1] === String(manifest.version));
}
{
  const declared = (readme.match(/schemaVersion:\s*(\d+)/) || [])[1];
  const grab = f => (read(f).match(/SCHEMA_VERSION\s*=\s*(\d+)/) || [])[1];
  const found = { content: grab('content.js'), background: grab('background.js'), options: grab('options.js') };
  const allSame = found.content && found.content === found.background && found.content === found.options;
  check('content / background / options 三处 SCHEMA_VERSION 一致（' + found.content + '）', !!allSame);
  check('README 声明的 schemaVersion 与代码一致'
    + (declared ? '（' + declared + '）' : '（README 里没找到声明）'),
    !!declared && declared === found.content);
}

/* ---- 2. README 声明的测试套数必须等于「自动发现」的真实套数 ----
   （算法见文件顶部的 SUITE_COUNT —— 不在这里重写一套。） */
{
  const claimed = [...readme.matchAll(/(\d+)\s*套/g)].map(x => x[1]);
  check('README 里每处「N 套」都等于真实套数（' + SUITE_COUNT + '）',
    claimed.length > 0 && claimed.every(c => Number(c) === SUITE_COUNT));
  if (!claimed.every(c => Number(c) === SUITE_COUNT)) {
    console.log('        README 写的：' + claimed.join(' / ') + '，实际：' + SUITE_COUNT);
  }
}

/* ---- 3. 已被事实推翻的说法不许回来 ----
   这些字符串曾经真实存在于文档里 —— 要么是「代码往前走、文档没跟上」，要么是已被明确
   删除 / 推翻的提案。两种情况都不该靠人的记性守着。 */
{
  const STALE = [
    ['docs/progress.md', 'not been merged', '两个仓库的集成都已并入 main 并推送'],
    ['docs/progress.md', 'not committed to main', '已在 main 上'],
    ['docs/progress.md', 'not pushed, and not released', '已推送到公开远端'],
    ['docs/features/xchina-collector-integration.md', 'has not been merged', '集成已在 main 上'],
    ['docs/requirements/README.md', '仍未进行', '004 报告里已有完整验证记录'],
    ['docs/requirements/README.md', '其余待定', '003 的 ①–⑩ 已全部有结论'],
    ['docs/requirements/003-feature-suggestions.md', 'L5',
      '2026-09-24 Leon 要求从建议稿删除该提案：磁力止于 ⑧ 的 Tier A/B，不再单列'],
    ['docs/verify/manual-acceptance.md', '只有 20 个条目',
      'F1 已修：native-host/ 随包分发（zip 20 → 23 个条目）'],
    ['docs/verify/manual-acceptance.md', '被 L2「残缺串丢弃」',
      'F2 已修：截断串其实被当合法磁力收下（一条点开下不动的链接），现在补回完整串'],
    ['docs/verify/manual-acceptance.md', '1158',
      '断言总数不再写死在清单里（判不了、必过期），改指向 `python ci.py` 的输出'],
  ];
  STALE.forEach(([f, bad, why]) => {
    check(f + ' 不再宣称「' + bad + '」（' + why + '）', readDoc(f).indexOf(bad) === -1);
  });
}

/* ---- 4. 已收口的需求文档必须留下「实施状态」痕迹 ----
   否则下一个人读到的仍是一份「待确认的讨论稿」，会照着已经不存在的分歧去讨论。 */
{
  const DONE = {
    'docs/requirements/002-block-display-and-backfill.md': '实施状态',
    'docs/requirements/003-feature-suggestions.md': '实施状态',
    'docs/requirements/004-pagination-and-magnet-site-verification.md': '落地状态',
  };
  Object.keys(DONE).forEach(f => {
    const head = readDoc(f).split('\n').slice(0, 40).join('\n');
    check(f.split('/').pop() + ' 文首有「' + DONE[f] + '」小节', head.indexOf(DONE[f]) !== -1);
  });
  const idx = readDoc('docs/requirements/README.md');
  [['002', '已实施'], ['003', '已全部收口'], ['004', '已全部落地']].forEach(([no, mark]) => {
    const row = idx.split('\n').find(l => l.indexOf('| ' + no + ' |') === 0) || '';
    check('需求索引 ' + no + ' 行标为「' + mark + '」', row.indexOf(mark) !== -1);
  });
}

/* ---- 5. 文档里引用的仓库内文件必须真的存在（防文件链漂移） ---- */
{
  const broken = [];
  ['docs/progress.md', 'docs/features/xchina-collector-integration.md',
    'docs/requirements/README.md', 'docs/README.md'].forEach(f => {
      const dir = path.dirname(path.join(EXT, f));
      for (const m of readDoc(f).matchAll(/\]\(([^)#]+\.md)\)/g)) {
        if (!fs.existsSync(path.resolve(dir, m[1]))) broken.push(f + ' → ' + m[1]);
      }
    });
  check('文档内部链接指向的文件都存在', broken.length === 0);
  if (broken.length) console.log('        断链：' + broken.join(', '));
}

/* ---- 6. 人工验收清单的版本与套数必须与当前构建一致 ----
   这份清单是「照着它去跑真机」的实时文档：标题版本与文中每处「N 套」一旦过期，
   验收的人就会拿着**旧包的预期**去核**新包**，把「预期本来就不对」记成一个失败。
   清单里的「N 项断言」不在此列 —— 判不了，所以文里已改成指向 `ci.py` 的输出。 */
{
  const doc = readDoc('docs/verify/manual-acceptance.md');

  const v = (doc.match(/^#\s*人工验收清单（v([0-9][0-9.]*)）/m) || [])[1];
  check('人工验收清单的标题版本与 manifest.json 一致'
    + (v ? '（' + v + '）' : '（标题里没找到版本）'),
    !!v && v === String(manifest.version));

  const claimed = [...doc.matchAll(/(\d+)\s*套/g)].map(x => x[1]);
  check('人工验收清单里每处「N 套」都等于真实套数（' + SUITE_COUNT + '）',
    claimed.length > 0 && claimed.every(c => Number(c) === SUITE_COUNT));
  if (!claimed.every(c => Number(c) === SUITE_COUNT)) {
    console.log('        清单写的：' + claimed.join(' / ') + '，实际：' + SUITE_COUNT);
  }
}

console.log('\n' + (pass ? '全部通过' : '存在失败项'));
process.exit(pass ? 0 : 1);
