/* 测试 background.js 的每日推荐生成逻辑（buildDaily）：
 * 新面孔优先 + 旧高质量 + 排除已收藏/屏蔽/近期已推荐 + 评分/作品/人气/活跃度质量分
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const NOW = Date.now();
const DAY = 864e5;
const d = (n) => new Date(NOW - n * DAY).toISOString();

// 预置数据
const seed = {
  sf_data_v1: {
    discovered: {
      'actress|新人A': { v: '新人A', type: 'actress', n: 1, first: NOW - 2 * DAY, last: NOW - 1 * DAY, site: 'www.javbus.com', rating: 0, works: 0, avatar: 'http://x/a.jpg' },
      'actress|新人B': { v: '新人B', type: 'actress', n: 2, first: NOW - 5 * DAY, last: NOW - 3 * DAY, site: 'www.javbus.com', rating: 0, works: 0, avatar: '' },
      'actress|老牌高分': { v: '老牌高分', type: 'actress', n: 40, first: NOW - 400 * DAY, last: NOW - 10 * DAY, site: 'www.javbus.com', rating: 9.2, works: 320, avatar: 'http://x/c.jpg' },
      'actress|老牌中分': { v: '老牌中分', type: 'actress', n: 15, first: NOW - 300 * DAY, last: NOW - 20 * DAY, site: 'www.javbus.com', rating: 6.0, works: 60, avatar: '' },
      'actress|低质': { v: '低质', type: 'actress', n: 3, first: NOW - 200 * DAY, last: NOW - 50 * DAY, site: 'www.javbus.com', rating: 3.0, works: 5, avatar: '' },
      'actress|已屏蔽': { v: '已屏蔽', type: 'actress', n: 99, first: NOW - 100 * DAY, last: NOW - 1 * DAY, site: 'www.javbus.com', rating: 9.9, works: 500, avatar: '' },
      'actress|已推过': { v: '已推过', type: 'actress', n: 20, first: NOW - 90 * DAY, last: NOW - 2 * DAY, site: 'www.javbus.com', rating: 8.5, works: 200, avatar: '' },
      'actress|熟脸半看': { v: '熟脸半看', type: 'actress', n: 7, first: NOW - 250 * DAY, last: NOW - 8 * DAY, site: 'www.javbus.com', rating: 8.0, works: 80, avatar: '', seen: 6 },
      'maker|某片商A': { v: '某片商A', type: 'maker', n: 12, first: NOW - 300 * DAY, last: NOW - 4 * DAY, site: 'www.javbus.com', rating: 0, works: 0, avatar: '' },
      'series|某系列B': { v: '某系列B', type: 'series', n: 9, first: NOW - 200 * DAY, last: NOW - 6 * DAY, site: 'www.javbus.com', rating: 0, works: 0, avatar: '' },
      'actress|反馈屏蔽者': { v: '反馈屏蔽者', type: 'actress', n: 30, first: NOW - 300 * DAY, last: NOW - 3 * DAY, site: 'www.javbus.com', rating: 9.0, works: 200, avatar: '' },
      // 已看粒度（细化到具体作品）：以下两人作品都「够多（≥3）」，走 cooc.w ∩ seen 的比例判断
      'actress|看光了的': { v: '看光了的', type: 'actress', n: 20, first: NOW - 400 * DAY, last: NOW - 5 * DAY, site: 'www.javbus.com', rating: 9.0, works: 300, avatar: '' },
      'actress|看了小半的': { v: '看了小半的', type: 'actress', n: 20, first: NOW - 400 * DAY, last: NOW - 5 * DAY, site: 'www.javbus.com', rating: 9.0, works: 300, avatar: '' }
    },
    // 共现库：w = 她在哪些番号出现过（键为番号）
    cooc: {
      '看光了的': { tag: {}, maker: {}, series: {}, director: {}, w: { 'X-001': 1, 'X-002': 1, 'X-003': 1, 'X-004': 1 } },
      '看了小半的': { tag: {}, maker: {}, series: {}, director: {}, w: { 'Y-001': 1, 'Y-002': 1, 'Y-003': 1, 'Y-004': 1 } }
    },
    // 已看记录（键为番号）→ 看光了的 4/4 全看；看了小半的 仅 1/4
    seen: { 'X-001': NOW, 'X-002': NOW, 'X-003': NOW, 'X-004': NOW, 'Y-001': NOW },
    recFeedback: {
      'actress|反馈屏蔽者': { blocked: 2, faved: 0, seen: 0, last: NOW }
    },
    rules: [
      { id: 'r1', type: 'actress', value: '已屏蔽', action: 'block', enabled: true }
    ],
    recHistory: [
      { name: '已推过', date: new Date(NOW - 5 * DAY).toISOString().slice(0, 10) }
    ],
    recSettings: { enabled: true, max: 12, newMax: 6, minQuality: 35, windowDays: 14 },
    dailyRecs: {},
    // 软屏蔽的「仍然查看」放行记录：buildDaily 走 getData→setData，必须原样保留
    peeks: { 'Z-999': NOW },
    settings: {}
  }
};

// 内存存储
const store = JSON.parse(JSON.stringify(seed));
function mkChrome() {
  return {
    storage: {
      local: {
        get: (key, cb) => { cb({ [key]: store[key] || {} }); },
        set: (obj, cb) => { Object.keys(obj).forEach(k => store[k] = obj[k]); if (cb) cb(); }
      },
      onChanged: { addListener() { } }
    },
    action: { setBadgeText() { }, setBadgeBackgroundColor() { } },
    runtime: { onMessage: { addListener() { } }, onInstalled: { addListener() { } }, onStartup: { addListener() { } }, openOptionsPage() { }, sendMessage() { } },
    alarms: { create() { }, onAlarm: { addListener() { } } },
    notifications: { create() { }, onClicked: { addListener() { } } },
    contextMenus: { removeAll(cb) { if (cb) cb(); }, create() { }, onClicked: { addListener() { } } }
  };
}

const code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const ctx = {
  chrome: mkChrome(), console: console, Date: Date, Math: Math, Object: Object, Array: Array,
  JSON: JSON, parseInt: parseInt, String: String, Promise: Promise, URL: URL, setTimeout: setTimeout
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

if (typeof ctx.buildDaily !== 'function') {
  console.log('FAIL  buildDaily 未暴露在 vm 全局');
  process.exit(1);
}

ctx.buildDaily(true);
setTimeout(() => {
  const today = new Date(); const day = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  const recs = (store.sf_data_v1.dailyRecs && store.sf_data_v1.dailyRecs[day]) || [];
  const names = recs.map(r => r.name);
  console.log('      今日推荐:', names.join(' / '));

  check('推荐数量在 1~12 之间', recs.length > 0 && recs.length <= 12);
  check('新人A 被推荐（新面孔）', names.indexOf('新人A') !== -1);
  check('新人B 被推荐（新面孔）', names.indexOf('新人B') !== -1);
  check('老牌高分 被推荐（高质量）', names.indexOf('老牌高分') !== -1);
  check('老牌中分 被推荐（质量达标）', names.indexOf('老牌中分') !== -1);
  check('已屏蔽 不推荐（被规则覆盖）', names.indexOf('已屏蔽') === -1);
  check('已推过 不推荐（近期已展示）', names.indexOf('已推过') === -1);
  check('低质 不推荐（质量分未达阈值 35）', names.indexOf('低质') === -1);
  check('每条推荐都带姓名', recs.every(r => r.name));
  check('每条推荐带质量分', recs.every(r => typeof r.quality === 'number'));
  check('每条推荐带头像或为空（不报错）', recs.every(r => 'avatar' in r));
  check('推荐历史已追加本次推荐', (store.sf_data_v1.recHistory || []).length >= 3);
  check('buildDaily 未写丢 peeks（软屏蔽放行记录）',
    !!(store.sf_data_v1.peeks && store.sf_data_v1.peeks['Z-999']));

  // 排序：新面孔整体排在旧用户之前；旧用户内部按质量降序
  const firstOldIdx = recs.findIndex(r => r.reasonType === 'quality');
  const newCount = recs.filter(r => r.reasonType === 'new').length;
  const oldPart = firstOldIdx >= 0 ? recs.slice(firstOldIdx).map(r => r.quality) : [];
  const oldDesc = oldPart.length <= 1 || oldPart.every((q, i) => i === 0 || oldPart[i - 1] >= q);
  check('新面孔整体排在旧用户之前', firstOldIdx === -1 || firstOldIdx === newCount);
  check('旧用户内部质量降序', oldDesc);
  check('熟脸半看 默认被排除（已看占比过半）', names.indexOf('熟脸半看') === -1);

  // 第二场景：关闭 excludeSeen 后，熟脸半看应被纳入推荐
    store.sf_data_v1.recSettings.excludeSeen = false;
  ctx.buildDaily(true);
  setTimeout(() => {
    const recs2 = (store.sf_data_v1.dailyRecs && store.sf_data_v1.dailyRecs[day]) || [];
    const names2 = recs2.map(r => r.name);
    check('关闭「排除已看」后 熟脸半看 被纳入', names2.indexOf('熟脸半看') !== -1);

    // 反馈闭环：被每日推荐后手动屏蔽过的，不再推荐
    check('反馈屏蔽者 不推荐（recFeedback.blocked>0 排除）', names2.indexOf('反馈屏蔽者') === -1);

    // 维度扩展：纳入片商/系列后，某片商A 与 某系列B 应出现（隔离窗口，先清历史）
    store.sf_data_v1.recHistory = [];
    store.sf_data_v1.recSettings.excludeSeen = true;
    store.sf_data_v1.recSettings.minQuality = 0;
    store.sf_data_v1.recSettings.dim = ['actress', 'maker', 'series'];
    ctx.buildDaily(true);
    setTimeout(() => {
      const recs3 = (store.sf_data_v1.dailyRecs && store.sf_data_v1.dailyRecs[day]) || [];
      const names3 = recs3.map(r => r.name);
      const types3 = recs3.map(r => r.type);
      check('纳入片商维度后 某片商A 被推荐', names3.indexOf('某片商A') !== -1);
      check('纳入系列维度后 某系列B 被推荐', names3.indexOf('某系列B') !== -1);
      check('推荐结果含 maker/series 类型', types3.indexOf('maker') !== -1 && types3.indexOf('series') !== -1);

      // 权重：把评分权重调到 0、人气权重调到 100，重新生成，质量分应重新计算（老牌高分仍入选因 n 高）
      store.sf_data_v1.recHistory = [];
      store.sf_data_v1.recSettings.dim = ['actress'];
      store.sf_data_v1.recSettings.minQuality = 0;
      store.sf_data_v1.recSettings.weights = { rating: 0, works: 0, pop: 1, recency: 0 };
      store.sf_data_v1.recSettings.autoWeights = false;
      ctx.buildDaily(true);
      setTimeout(() => {
        const recs4 = (store.sf_data_v1.dailyRecs && store.sf_data_v1.dailyRecs[day]) || [];
        check('自定义权重后仍正常生成（人气权重生效、无报错）', recs4.length > 0);

        /* 已看粒度细化：从「整体点击占比」升级为「她的具体片子看过多少」
           —— 已知作品 ≥3 部时，用 cooc[name].w ∩ seen 求比例，比例≥阈值则排除。 */
        store.sf_data_v1.recHistory = [];
        Object.assign(store.sf_data_v1.recSettings, {
          excludeSeen: true, seenWorkRatio: 0.75, dim: ['actress'],
          minQuality: 35, autoWeights: false,
          weights: { rating: 0.4, works: 0.25, pop: 0.2, recency: 0.15 }
        });
        ctx.buildDaily(true);
        setTimeout(() => {
          const recs5 = (store.sf_data_v1.dailyRecs && store.sf_data_v1.dailyRecs[day]) || [];
          const names5 = recs5.map(r => r.name);
          const half = recs5.filter(r => r.name === '看了小半的')[0];

          check('[粒度] 作品已看光的（4/4）被排除', names5.indexOf('看光了的') === -1);
          check('[粒度] 只看了小半的（1/4）仍被推荐', names5.indexOf('看了小半的') !== -1);
          check('[粒度] 推荐项带 knownW/seenW 明细', !!half && half.knownW === 4 && half.seenW === 1);
          check('[粒度] 推荐理由写明「你已看 1/4 部」', !!half && /你已看 1\/4 部/.test(half.reason));
          console.log('      粒度样本:', JSON.stringify(half ? { n: half.name, knownW: half.knownW, seenW: half.seenW, reason: half.reason } : null));

          // 阈值可调：降到 0.2 → 1/4 = 25% ≥ 20% 也应被排除
          store.sf_data_v1.recHistory = [];
          store.sf_data_v1.recSettings.seenWorkRatio = 0.2;
          ctx.buildDaily(true);
          setTimeout(() => {
            const recs6 = (store.sf_data_v1.dailyRecs && store.sf_data_v1.dailyRecs[day]) || [];
            const names6 = recs6.map(r => r.name);
            check('[粒度] seenWorkRatio=0.2 时 看了小半的(25%) 被排除', names6.indexOf('看了小半的') === -1);
            console.log(pass ? '\n全部通过 ✅' : '\n存在失败 ❌');
            process.exit(pass ? 0 : 1);
          }, 200);
        }, 200);
      }, 200);
    }, 200);
  }, 200);
}, 200);
