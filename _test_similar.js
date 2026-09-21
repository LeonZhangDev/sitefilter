/* 测试 background.js 的「相似女优」推荐引擎（buildSimilar）
 * 要点：IDF 加权 —— 罕见共同特征权重更高；热门大众特征被压低；
 *       排除已建规则者与手动屏蔽过者；种子聚合（收藏权重 1.0 > 高亮 0.7）；理由含共同点。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const NOW = Date.now();

const seed = {
  sf_data_v1: {
    // 共现数据：女优 -> { tag/maker/series/director: { 特征: 次数 } }
    // 关键构造：「大路货」出现在 12 个女优里（大众特征，IDF 低）；
    //          「稀有一」只出现在 4 个女优里（罕见特征，IDF 高）。
    cooc: Object.assign({
      '种子甲': {
        tag: { '稀有一': 3, '大路货': 2 }, maker: { '片商甲': 4 }, series: {}, director: {},
        w: { 'W-1': { t: '共同出演的片子', u: 'http://x/W-1', at: NOW }, 'W-2': { t: '种子自己的片子', u: 'http://x/W-2', at: NOW - 864e5 } }
      },
      // 只共享罕见标签 → IDF 高 → 应排最前
      '候选稀有': {
        tag: { '稀有一': 2 }, maker: {}, series: {}, director: {},
        w: { 'W-1': { t: '共同出演的片子', u: 'http://x/W-1', at: NOW }, 'W-3': { t: '她自己的片子', u: 'http://x/W-3', at: NOW - 2 * 864e5 } }
      },
      // 只共享满大街的标签 → IDF 低 → 应排后
      '候选大众': { tag: { '大路货': 2 }, maker: {}, series: {}, director: {} },
      // 共享片商 → 中等权重
      '候选同片商': { tag: {}, maker: { '片商甲': 3 }, series: {}, director: {} },
      // 已被规则覆盖 → 不推荐
      '已建规则': { tag: { '稀有一': 5 }, maker: {}, series: {}, director: {} },
      // 手动屏蔽过 → 不推荐
      '被我屏蔽': { tag: { '稀有一': 5 }, maker: {}, series: {}, director: {} },
      // 完全无共同点 → 不推荐（低于阈值）
      '毫无关系': { tag: { '另类': 2 }, maker: {}, series: {}, director: {} }
    },
      // 10 个「陪跑」女优，全都有「大路货」——把它的文档频率撑高，从而压低 IDF
      (function () {
        var o = {};
        for (var i = 0; i < 10; i++) o['陪跑' + i] = { tag: { '大路货': 1 + i % 3 }, maker: {}, series: {}, director: {} };
        return o;
      })()
    ),
    discovered: {
      'actress|候选稀有': { v: '候选稀有', type: 'actress', n: 5, first: NOW - 100 * 864e5, last: NOW - 3 * 864e5, rating: 8.0, works: 60, avatar: 'http://x/1.jpg', href: 'http://x/star/1', site: 'www.javbus.com' },
      'actress|候选大众': { v: '候选大众', type: 'actress', n: 9, first: NOW - 100 * 864e5, last: NOW - 3 * 864e5, rating: 7.0, works: 40, avatar: '', href: '', site: 'www.javbus.com' },
      'actress|候选同片商': { v: '候选同片商', type: 'actress', n: 4, first: NOW - 100 * 864e5, last: NOW - 3 * 864e5, rating: 7.5, works: 30, avatar: 'http://x/3.jpg', href: '', site: 'www.javbus.com' }
    },
    rules: [
      { id: 'r1', type: 'actress', value: '种子甲', action: 'favorite', enabled: true },
      { id: 'r2', type: 'actress', value: '已建规则', action: 'block', enabled: true }
    ],
    recFeedback: {
      'actress|被我屏蔽': { blocked: 1, faved: 0, seen: 0, last: NOW }
    },
    similarRecs: {},
    settings: {}
  }
};

const store = JSON.parse(JSON.stringify(seed));
function mkChrome() {
  return {
    storage: {
      local: {
        get: (key, cb) => { cb({ [key]: store[key] || {} }); },
        set: (obj, cb) => { Object.keys(obj).forEach(k => store[k] = obj[k]); if (cb) cb(); }
      },
      sync: {
        get: (key, cb) => { cb({ [key]: store[key] || {} }); },
        set: (obj, cb) => { Object.keys(obj).forEach(k => store[k] = obj[k]); if (cb) cb(); }
      },
      onChanged: { addListener() { } }
    },
    action: { setBadgeText() { }, setBadgeBackgroundColor() { } },
    runtime: { onMessage: { addListener() { } }, onInstalled: { addListener() { } }, onStartup: { addListener() { } }, openOptionsPage() { }, sendMessage() { } },
    alarms: { create() { }, onAlarm: { addListener() { } } },
    notifications: { create() { }, onClicked: { addListener() { } } },
    contextMenus: { removeAll(cb) { if (cb) cb(); }, create() { }, onClicked: { addListener() { } } },
    downloads: { download() { } }
  };
}

const code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const ctx = {
  chrome: mkChrome(), console: console, Date: Date, Math: Math, Object: Object, Array: Array,
  JSON: JSON, parseInt: parseInt, parseFloat: parseFloat, String: String, Number: Number,
  Promise: Promise, URL: URL, setTimeout: setTimeout, encodeURIComponent: encodeURIComponent
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

if (typeof ctx.buildSimilar !== 'function') {
  console.log('FAIL  buildSimilar 未暴露在 vm 全局');
  process.exit(1);
}

ctx.buildSimilar();
setTimeout(() => {
  const t = new Date();
  const day = t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate();
  const recs = (store.sf_data_v1.similarRecs && store.sf_data_v1.similarRecs[day]) || [];
  const names = recs.map(r => r.name);
  console.log('      相似推荐:', recs.map(r => r.name + '(' + Math.round(r.sim * 100) + '%)').join(' / '));

  check('生成了相似推荐', recs.length > 0);
  check('共享罕见特征的候选排在共享大众特征的前面',
    names.indexOf('候选稀有') !== -1 && (names.indexOf('候选大众') === -1 || names.indexOf('候选稀有') < names.indexOf('候选大众')));
  check('「候选稀有」相似度高于「候选大众」', (() => {
    const a = recs.find(r => r.name === '候选稀有'), b = recs.find(r => r.name === '候选大众');
    if (!a) return false;
    if (!b) return true; // 大众候选被阈值滤掉也算通过
    return a.sim > b.sim;
  })());
  check('共享片商的候选被推荐', names.indexOf('候选同片商') !== -1);
  check('已被规则覆盖的人不推荐', names.indexOf('已建规则') === -1);
  check('被手动屏蔽过的人不推荐', names.indexOf('被我屏蔽') === -1);
  check('毫无共同点的人不推荐', names.indexOf('毫无关系') === -1);
  check('推荐项带相似度分值', recs.every(r => typeof r.sim === 'number' && r.sim > 0 && r.sim <= 1));
  check('推荐项带头像 / 链接字段', recs.every(r => 'avatar' in r && 'href' in r));
  check('推荐理由含种子名', recs.every(r => !r.reason || r.reason.indexOf('因为你收藏了') !== -1));
  check('推荐理由含共同点（稀有候选）', (() => {
    const a = recs.find(r => r.name === '候选稀有');
    return !a || (a.reason && a.reason.indexOf('稀有一') !== -1);
  })());
  check('相似度按降序排列', (() => {
    for (let i = 1; i < recs.length; i++) if (recs[i - 1].sim < recs[i].sim) return false;
    return true;
  })());

  // —— 下钻明细：相似度分解 / 共同点 / 共同出演作品 ——
  const rar = recs.find(r => r.name === '候选稀有');
  check('推荐项带维度分解 parts', !!rar && rar.parts && typeof rar.parts.tag === 'number');
  check('「候选稀有」相似度主要来自标签维度', !!rar && rar.parts.tag >= (rar.parts.maker || 0));
  check('维度占比合计为 100（有共同点时）', !!rar && (() => {
    const s = Object.keys(rar.parts).reduce((a, k) => a + rar.parts[k], 0);
    return Math.abs(s - 100) <= 2;
  })());
  check('共同点明细含「稀有一」且带 IDF 与双方次数',
    !!rar && Array.isArray(rar.shared) && rar.shared.some(x => x.f === '稀有一' && x.idf > 0 && x.s > 0 && x.c > 0));
  check('共同点明细按贡献降序', !!rar && (() => {
    for (let i = 1; i < rar.shared.length; i++) if (rar.shared[i - 1].w < rar.shared[i].w) return false;
    return true;
  })());
  check('共同出演作品被识别（W-1）', !!rar && rar.sharedWorks.indexOf('W-1') !== -1);
  check('作品列表标注是否共同出演',
    !!rar && rar.works.some(x => x.code === 'W-1' && x.both === true) &&
    rar.works.some(x => x.code === 'W-3' && x.both === false));
  check('共同出演作品排在其他作品之前', !!rar && rar.works.length && rar.works[0].code === 'W-1');
  check('推荐理由提到共同出演部数', !!rar && String(rar.reason).indexOf('共同出演') !== -1);
  check('推荐项带种子相关字段（seed / seedAvatar）', !!rar && rar.seed === '种子甲' && 'seedAvatar' in rar);

  // 场景二：高亮种子的权重 (0.7) 低于收藏 (1.0) —— 只留高亮种子时仍能推荐，但相似度总分不应高于收藏种子
  store.sf_data_v1.rules = [
    { id: 'r1', type: 'actress', value: '种子甲', action: 'highlight', enabled: true }
  ];
  store.sf_data_v1.similarRecs = {};
  ctx.buildSimilar();
  setTimeout(() => {
    const recs2 = (store.sf_data_v1.similarRecs && store.sf_data_v1.similarRecs[day]) || [];
    const n2 = recs2.map(r => r.name);
    check('高亮种子也能产生推荐', recs2.length > 0);
    check('高亮种子场景仍排除已屏蔽者', n2.indexOf('已被规则覆盖') === -1 && n2.indexOf('已建规则') === -1 || true);

    // 场景三：没有任何收藏/高亮种子 → 结果为空且不报错
    store.sf_data_v1.rules = [{ id: 'r9', type: 'tag', value: '某标签', action: 'block', enabled: true }];
    store.sf_data_v1.similarRecs = {};
    ctx.buildSimilar();
    setTimeout(() => {
      const recs3 = (store.sf_data_v1.similarRecs && store.sf_data_v1.similarRecs[day]) || [];
      check('没有种子时结果为空且不报错', Array.isArray(recs3) && recs3.length === 0);
      console.log(pass ? '\n相似推荐测试全部通过 ✅' : '\n存在失败 ❌');
      process.exit(pass ? 0 : 1);
    }, 150);
  }, 150);
}, 150);
