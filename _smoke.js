/* SiteFilter 冒烟测试：jsdom 中模拟一个类 JavBus 列表页，验证卡片识别 / 女优标签提取 / 规则生效 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = 'C:\\Users\\admin\\Desktop\\site-filter';
const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');

function card(code_, star, genre, maker, series) {
  return `<div class="item">
    <a class="movie-box" href="/${code_}">
      <div class="photo-frame"><img src="x.jpg" alt="${code_}"></div>
      <div class="photo-info">
        <span class="title">Title ${code_}</span>
        ${star ? `<a href="/star/99">${star}</a>` : ''}
        ${genre ? `<a href="/genre/1">${genre}</a>` : ''}
        ${maker ? `<a href="/studio/7">${maker}</a>` : ''}
        ${series ? `<a href="/series/3">${series}</a>` : ''}
      </div>
    </a>
  </div>`;
}

const body = '<div class="container">' + [
  card('ABC-001', '三上悠亚', '高清', 'S1 片商', '某系列'),
  card('ABC-002', '三上悠亚', '丝袜', 'S1 片商', ''),
  card('ABC-003', '明日花绮罗', '高清', 'Moodyz', ''),
  card('ABC-004', '大桥未久', '', 'S1 片商', ''),
  card('ABC-005', '', '丝袜', '', '某系列'),
  '<div class="item"><a class="movie-box" href="/ABC-006"><div class="photo-frame"><img src="x.jpg" alt="ABC-006"></div>' +
  '<div class="photo-info"><span class="title">Title ABC-006</span><a href="/genre/1">高清</a><a href="/studio/7">S1 片商</a>' +
  '<span class="date">2024-05-12</span><span class="rating">4.5</span></div></a></div>',
].join('') + '</div>' +
  // 模拟详情页的磁力：藏在 data-clipboard-text 里 + 一个裸文本 magnet + 一个网盘链接
  '<div id="dl"><a href="#" data-clipboard-text="magnet:?xt=urn:btih:AAAABBBBCCCCDDDDEEEEFFFF0000111122223333&dn=Test.1080p">复制磁力</a>' +
  '<div class="row">magnet:?xt=urn:btih:1111222233334444555566667777888899990000 2.5GB 1080p</div>' +
  '<a href="https://pan.baidu.com/s/1abcdefg">百度网盘</a>' +
  '<a href="https://xxx.com/a.torrent">种子</a></div>';

const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
  url: 'https://www.javbus.com/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;

// jsdom 无布局，伪造尺寸
win.Element.prototype.getBoundingClientRect = function () {
  return { width: 220, height: 320, top: 0, left: 0, right: 220, bottom: 320, x: 0, y: 0 };
};

// 伪造 chrome API
const store = {};
store['sf_data_v1'] = {
  settings: { enabled: true, sfw: false, onlyFav: false, boss: false, showBall: true, pinHighlight: true, markSeen: true, hlColor: '#00e5ff', ball: { right: 24, bottom: 24 } },
  sites: [{ id: 's1', pattern: '*://*.javbus.com/*', enabled: true, selector: '', note: 'JavBus' }],
  rules: [
    { id: 'r1', type: 'actress', value: '三上悠亚', aliases: [], action: 'block', match: 'contains', scope: 'actress', color: '', sites: [], enabled: true, hits: 0 },
    { id: 'r2', type: 'tag', value: '丝袜', aliases: [], action: 'highlight', match: 'contains', scope: 'tag', color: '#ff4d6d', sites: [], enabled: true, hits: 0 },
    { id: 'r3', type: 'actress', value: '大桥未久', aliases: [], action: 'favorite', match: 'contains', scope: 'actress', color: '', sites: [], enabled: true, hits: 0 },
    { id: 'r4', type: 'maker', value: 'Moodyz', aliases: [], action: 'block', match: 'contains', scope: 'maker', color: '', sites: [], enabled: true, hits: 0 },
    // 该规则处于「已关闭的分组」中，应当不生效（用于验证分组启停）
    { id: 'r5', type: 'tag', value: '高清', aliases: [], action: 'block', match: 'contains', scope: 'tag', color: '', sites: [], enabled: true, hits: 0, groupId: 'g_x' },
    // 冲突检测：同一目标同时被「屏蔽」和「收藏」（该女优不出现在任何卡片上，不影响卡片断言）
    { id: 'r6', type: 'actress', value: '冲突女优', aliases: [], action: 'block', match: 'contains', scope: 'actress', color: '', sites: [], enabled: true, hits: 0 },
    { id: 'r7', type: 'actress', value: '冲突女优', aliases: [], action: 'favorite', match: 'contains', scope: 'actress', color: '', sites: [], enabled: true, hits: 0 },
  ],
  groups: [
    { id: 'g_x', name: '临时试试', enabled: false },
  ],
  seen: { 'ABC-004': Date.now() },
  favCodes: { 'ABC-003': { t: 'Title ABC-003', u: '/ABC-003', s: 'www.javbus.com', at: Date.now() } },
  watchlist: {
    'ABC-777': { t: '待看的片子', u: 'https://www.javbus.com/ABC-777', s: 'www.javbus.com', at: Date.now(), note: '朋友推荐', prio: 2 },
    'ABC-778': { t: '一般想看的', u: '', s: 'www.javbus.com', at: Date.now() - 1000, note: '', prio: 0 },
    'ABC-779': { t: '没设优先级（默认中）', u: '', s: 'www.javbus.com', at: Date.now() - 2000 },
  },
  discovered: {
    'actress|新垣结衣': { v: '新垣结衣', type: 'actress', n: 3, first: Date.now(), last: Date.now() },
    'tag|高清': { v: '高清', type: 'tag', n: 5, first: Date.now(), last: Date.now() },
    'maker|IDEAPOCKET': { v: 'IDEAPOCKET', type: 'maker', n: 2, first: Date.now() - 10 * 864e5, last: Date.now() },
  },
};
(function () {
  const t = new Date(); const day = t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate();
  store['sf_data_v1'].dailyRecs = {};
  store['sf_data_v1'].dailyRecs[day] = [
    { name: '每日新人小美', type: 'actress', avatar: 'http://x/m.jpg', href: 'https://www.javbus.com/star/123', site: 'www.javbus.com', reason: '新面孔 · 首次见于 9月1日', reasonType: 'new', quality: 12, first: Date.now(), last: Date.now(), n: 1, rating: 0, works: 0 },
    { name: '高质量老将', type: 'actress', avatar: '', href: '', site: 'www.javbus.com', reason: '评分 9.0 · 作品 300', reasonType: 'quality', quality: 88, first: Date.now() - 400 * 864e5, last: Date.now() - 10 * 864e5, n: 50, rating: 9.0, works: 300 },
  ];
})();
(function () {
  const t = new Date(); const day = t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate();
  store['sf_data_v1'].similarRecs = {};
  store['sf_data_v1'].similarRecs[day] = [
    {
      name: '相似新人A', type: 'actress', sim: 0.62, avatar: 'http://x/a.jpg', href: 'https://www.javbus.com/star/9',
      reason: '因为你收藏了 大桥未久 · 共同点：丝袜、S1 片商 · 共同出演 1 部', seed: '大桥未久',
      parts: { tag: 70, maker: 30 },
      shared: [
        { dim: 'tag', f: '丝袜', c: 3, s: 2, idf: 1.8, w: 1.2 },
        { dim: 'maker', f: 'S1 片商', c: 2, s: 4, idf: 0.7, w: 0.4 },
      ],
      works: [
        { code: 'ABC-900', t: '共同出演的片子', u: 'https://www.javbus.com/ABC-900', both: true },
        { code: 'ABC-901', t: '她自己的片子', u: '', both: false },
      ],
      sharedWorks: ['ABC-900'], quality: 55,
    },
  ];
})();
win.chrome = {
  storage: {
    local: {
      get(k, cb) { const o = {}; if (typeof k === 'string') o[k] = store[k]; else Object.keys(k).forEach(x => o[x] = store[x]); cb(o); },
      set(o, cb) { Object.assign(store, o); if (cb) cb(); },
    },
    onChanged: { addListener() { } },
  },
  runtime: { sendMessage() { return Promise.resolve(); }, onMessage: { addListener() { } } },
};

// 与真实 content script 一致：先加载共享的表达式引擎，再加载 content.js
win.eval(fs.readFileSync(path.join(EXT, 'expr.js'), 'utf8'));
win.eval(code);

setTimeout(() => {
  const doc = win.document;
  const host = doc.querySelector('.cf-host');
  const sr = host && host.shadowRoot;
  const ball = sr && sr.getElementById('ball');
  const stats = sr && sr.getElementById('stats');
  const items = Array.from(doc.querySelectorAll('.item'));

  // 打开面板，验证女优/标签列表渲染
  ball.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const list = sr.getElementById('list');
  // 面板可能因「有新人」自动切到推荐页，这里显式切回女优页再统计
  sr.querySelector('[data-tab="actress"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const rowsActress = list.querySelectorAll('.cf-row').length;
  sr.querySelector('[data-tab="tag"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const rowsTag = list.querySelectorAll('.cf-row').length;

  const by = {};
  items.forEach(el => {
    const a = el.querySelector('a');
    by[a.getAttribute('href').replace('/', '')] = {
      blocked: el.classList.contains('cf-blocked'),
      fav: el.classList.contains('cf-fav'),
      hl: el.classList.contains('cf-hl'),
      seen: el.classList.contains('cf-seen'),
      favcode: el.classList.contains('cf-favcode'),
      color: el.style.getPropertyValue('--cf-hl-color') || '',
      date: el.dataset.cfDate || '',
      rating: el.dataset.cfRating || '',
      filtout: el.classList.contains('cf-filt-out'),
    };
  });

  let pass = true;
  const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

  check('悬浮球已注入 (shadow DOM)', !!ball);
  check('识别到 6 张卡片', items.length === 6);
  check('面板可点击展开', sr.getElementById('panel').classList.contains('open'));
  check('ABC-001 女优「三上悠亚」→ 屏蔽', by['ABC-001'].blocked === true);
  check('ABC-002 女优命中屏蔽（优先级高于高亮）', by['ABC-002'].blocked === true && !by['ABC-002'].hl);
  check('ABC-003 片商「Moodyz」→ 屏蔽', by['ABC-003'].blocked === true);
  check('ABC-004 女优「大桥未久」→ 收藏金星描边', by['ABC-004'].fav === true && !by['ABC-004'].blocked);
  check('ABC-004 已看灰显', by['ABC-004'].seen === true);
  check('ABC-005 标签「丝袜」→ 高亮', by['ABC-005'].hl === true);
  check('高亮颜色写入 #ff4d6d', by['ABC-005'].color === '#ff4d6d');
  check('高亮卡片已置顶到首位', (items[0].querySelector('img') || {}).alt === 'ABC-005');
  check('女优列表渲染出 3 人', rowsActress === 3);
  check('标签列表渲染出 2 个', rowsTag === 2);

  // —— 新增维度 ——
  const rowsOf = tab => {
    sr.querySelector(`[data-tab="${tab}"]`).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    return list.querySelectorAll('.cf-dlrow, .cf-row').length;
  };
  check('片商页识别出 2 家', rowsOf('maker') === 2);
  check('系列页识别出 1 个', rowsOf('series') === 1);
  check('番号收藏页有 1 条', rowsOf('favcode') === 1);
  // 番号多站直达（codeSearchBtns 默认开）
  check('番号行出现「多站直达」按钮组', list.querySelectorAll('.cf-gosrow .cf-gos').length >= 3);
  check('直达按钮含 javbus 站点', list.textContent.indexOf('Bus') !== -1 || list.textContent.indexOf('bus') !== -1);

  // —— 下载链接探测 ——
  const dlRows = rowsOf('download');
  check('下载页探测到 4 条链接', dlRows === 4);
  check('磁力附带文件大小', list.textContent.indexOf('2.5GB') !== -1);
  check('网盘链接被识别', list.textContent.indexOf('PAN') !== -1);
  check('页面内下载元素已加 cf-dl 标记', doc.querySelectorAll('.cf-dl').length > 0);
  check('卡片已加 cf-card（♥ 定位）', doc.querySelectorAll('.item.cf-card').length > 0);
  check('♥ 收藏按钮已注入', doc.querySelectorAll('.cf-favbtn').length > 0);

  // —— 推荐卡片墙 + 每日新人徽标 ——
  sr.querySelector('[data-tab="recommend"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const wall = list.querySelector('.cf-wall');
  const vcards = list.querySelectorAll('.cf-vcard');
  check('推荐页渲染出卡片墙', !!wall);
  check('卡片墙渲染出 2 张推荐卡（高清已建规则故不推荐）', vcards.length === 2);
  const newBadges = list.querySelectorAll('.cf-vcard .new').length;
  check('新面孔显示 NEW 角标（1 张）', newBadges === 1);
  const recBtn = sr.querySelector('[data-tab="recommend"]');
  check('推荐标签显示新人红色徽标', recBtn.innerHTML.indexOf('cf-badge') !== -1);

  // 点击卡片 → 循环加规则（无→屏蔽）
  const g1 = list.querySelector('.cf-vcard[data-v="新垣结衣"]');
  g1.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const rulesAfter1 = (store['sf_data_v1'].rules || []).filter(r => r.type === 'actress' && r.value === '新垣结衣' && r.action === 'block');
  check('点击卡片 → 自动加「屏蔽」规则', rulesAfter1.length === 1);
  // 再点一次 → 收藏
  list.querySelector('.cf-vcard[data-v="新垣结衣"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const rulesAfter2 = (store['sf_data_v1'].rules || []).filter(r => r.type === 'actress' && r.value === '新垣结衣');
  check('再次点击 → 切换为「收藏」', rulesAfter2.length === 1 && rulesAfter2[0].action === 'favorite');
  // 第三次 → 高亮
  list.querySelector('.cf-vcard[data-v="新垣结衣"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const rulesAfter3 = (store['sf_data_v1'].rules || []).filter(r => r.type === 'actress' && r.value === '新垣结衣');
  check('第三次点击 → 切换为「高亮」', rulesAfter3.length === 1 && rulesAfter3[0].action === 'highlight');

  // —— 新手引导 ——
  const onboard = sr.getElementById('onboard');
  check('未引导过时显示新手引导条', onboard && onboard.style.display !== 'none' && onboard.textContent.indexOf('欢迎') !== -1);
  onboard.querySelector('button[data-act="onboardClose"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('点「知道了」后引导条隐藏', onboard.style.display === 'none');

  // —— 评分 / 日期 提取 ——
  check('ABC-006 提取到发行日期 2024-05-12', by['ABC-006'].date === '2024-05-12');
  check('ABC-006 提取到评分 4.5', by['ABC-006'].rating === '4.5');
  check('无日期卡片 dataset 为空', by['ABC-001'].date === '' && by['ABC-001'].rating === '');

  // —— 分组启停：处于关闭分组里的屏蔽规则不生效 ——
  // ABC-006 含标签「高清」，但阻断它的 r5 在已关闭分组 g_x 中，因此不应被屏蔽
  check('关闭分组内的屏蔽规则不生效（ABC-006 未屏蔽）', by['ABC-006'].blocked === false);

  // —— 评分筛选：设 ≥4.5 后，无评分卡片被隐藏 ——
  sr.getElementById('flRating').value = '4.5';
  sr.getElementById('flRating').dispatchEvent(new win.MouseEvent('change', { bubbles: true }));
  const item006 = doc.querySelector('.item a[href="/ABC-006"]').closest('.item');
  const item004 = doc.querySelector('.item a[href="/ABC-004"]').closest('.item');
  check('评分≥4.5 时 ABC-006（有评分）仍显示', !item006.classList.contains('cf-filt-out'));
  check('评分≥4.5 时 ABC-004（无评分）被隐藏', item004.classList.contains('cf-filt-out'));
  // 清除筛选
  sr.getElementById('flRating').value = '';
  sr.getElementById('flRating').dispatchEvent(new win.MouseEvent('change', { bubbles: true }));
  check('清除筛选后 ABC-004 恢复显示', !item004.classList.contains('cf-filt-out'));

  // 通过「清除」按钮（data-act=flClear）再次验证：先设筛选，再点按钮
  sr.getElementById('flRating').value = '4.5';
  sr.getElementById('flRating').dispatchEvent(new win.MouseEvent('change', { bubbles: true }));
  check('再次设≥4.5 后 ABC-004 又被隐藏', item004.classList.contains('cf-filt-out'));
  sr.querySelector('button[data-act="flClear"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('点「清除」按钮后 ABC-004 恢复显示', !item004.classList.contains('cf-filt-out'));

  // —— 今日推荐图片墙（renderDaily） ——
  sr.querySelector('[data-tab="daily"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const dwall = list.querySelector('.cf-dwall');
  const dcards = list.querySelectorAll('.cf-dcard');
  check('今日推荐页渲染出图片墙', !!dwall);
  check('今日推荐渲染出 2 张卡片', dcards.length === 2);
  check('有头像的卡片含 <img class="dav">', list.querySelectorAll('.cf-dcard img.dav').length >= 1);
  check('无头像的卡片显示首字母占位', list.querySelectorAll('.cf-dcard .dini').length >= 2);
  check('新面孔卡片带 NEW 角标', list.querySelectorAll('.cf-dcard.new').length === 1);
  check('卡片展示质量分', list.textContent.indexOf('质量') !== -1);

  console.log('      统计内容:', stats ? stats.textContent : '(无)');
  console.log('      下载页条目:', dlRows, '| 标记元素:', doc.querySelectorAll('.cf-dl').length, '| 推荐卡:', vcards.length);

  // —— 冲突检测横幅 ——
  const warn = sr.getElementById('warn');
  check('冲突横幅已显示', warn && warn.style.display !== 'none');
  check('冲突横幅点名「冲突女优」', warn && warn.textContent.indexOf('冲突女优') !== -1);

  // —— 待看队列页（优先级看板 + 备注） ——
  sr.querySelector('[data-tab="watch"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('待看看板渲染出 3 个优先级分栏', list.querySelectorAll('.cf-wcol').length === 3);
  check('待看看板渲染出 3 张卡片', list.querySelectorAll('.cf-wcard').length === 3);
  const cols = list.querySelectorAll('.cf-wcol');
  check('「高」分栏有 1 张卡', cols[0].querySelectorAll('.cf-wcard').length === 1);
  check('「中」分栏有 1 张卡（无 prio 字段默认中）', cols[1].querySelectorAll('.cf-wcard').length === 1);
  check('「低」分栏有 1 张卡', cols[2].querySelectorAll('.cf-wcard').length === 1);
  check('待看卡片显示番号', list.textContent.indexOf('ABC-777') !== -1);
  check('待看卡片显示备注', list.textContent.indexOf('朋友推荐') !== -1);
  check('无备注的 2 张卡显示「＋备注」占位', list.querySelectorAll('.cf-wcard .wnote.empty').length === 2);
  check('顶部统计显示分档数量', (list.querySelector('.cf-wstat') || {}).textContent.indexOf('共') !== -1);

  // 优先级循环：高(2) → 低(0)
  let card777 = Array.from(list.querySelectorAll('.cf-wcard')).find(c => c.dataset.wcode === 'ABC-777');
  card777.querySelector('[data-wprio]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('点优先级按钮后 高→低（prio=0）', store['sf_data_v1'].watchlist['ABC-777'].prio === 0);
  card777 = Array.from(list.querySelectorAll('.cf-wcard')).find(c => c.dataset.wcode === 'ABC-777');
  check('改优先级后重新分栏到「低」', !!card777 && card777.closest('.cf-wcol').querySelector('.wchd').textContent.indexOf('低') !== -1);

  // 备注就地编辑：点文本 → 输入框 → 回车保存
  card777.querySelector('.wnote').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const noteInput = sr.getElementById('wnoteInput');
  check('点备注后出现就地输入框', !!noteInput);
  if (noteInput) {
    noteInput.value = '改过的备注';
    noteInput.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    check('回车把备注写入存储', store['sf_data_v1'].watchlist['ABC-777'].note === '改过的备注');
    check('保存后输入框就地还原为文本', !sr.getElementById('wnoteInput'));
  }
  // Esc 取消不覆盖
  const card778 = Array.from(list.querySelectorAll('.cf-wcard')).find(c => c.dataset.wcode === 'ABC-778');
  card778.querySelector('.wnote').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const ni2 = sr.getElementById('wnoteInput');
  if (ni2) {
    ni2.value = '不该被保存';
    ni2.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Esc 取消备注编辑不写库', store['sf_data_v1'].watchlist['ABC-778'].note === '');
  }

  // —— 面板内全局搜索 ——
  const searchEl = sr.getElementById('search');
  searchEl.value = '大桥';
  searchEl.dispatchEvent(new win.Event('input', { bubbles: true }));
  check('全局搜索：搜到「大桥未久」', list.textContent.indexOf('大桥未久') !== -1);
  check('全局搜索：结果含规则条目', list.querySelectorAll('.cf-srow').length >= 1);
  searchEl.value = 'ABC-777';
  searchEl.dispatchEvent(new win.Event('input', { bubbles: true }));
  check('全局搜索：搜到待看番号 ABC-777', list.textContent.indexOf('ABC-777') !== -1);
  searchEl.value = '';
  searchEl.dispatchEvent(new win.Event('input', { bubbles: true }));

  // —— 撤销：加一条规则后再撤销 ——
  sr.querySelector('[data-tab="actress"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const rowBefore = (store['sf_data_v1'].rules || []).length;
  const mini = Array.from(sr.querySelectorAll('.cf-mini')).find(b => b.dataset.a === 'block' && b.dataset.name === '明日花绮罗');
  if (mini) mini.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const added = (store['sf_data_v1'].rules || []).length;
  check('点「屏蔽」后规则数 +1', added === rowBefore + 1);
  sr.querySelector('button[data-act="undo"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const afterUndo = (store['sf_data_v1'].rules || []).length;
  check('点「↶ 撤销」后规则数回到原值', afterUndo === rowBefore);

  // —— 悬停浮层「为什么被处理」 ——
  const cardBlocked = doc.querySelector('.item.cf-blocked');
  if (cardBlocked) {
    cardBlocked.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
    const whyEl = doc.querySelector('.cf-why');
    check('悬停被处理卡片弹出原因浮层', whyEl && whyEl.style.display !== 'none');
    check('原因浮层含「为什么被处理」标题', whyEl && whyEl.textContent.indexOf('为什么被处理') !== -1);
    if (whyEl) whyEl.style.display = 'none';
  } else {
    check('悬停被处理卡片弹出原因浮层', false);
  }

  // —— 相似推荐页：进度条 + 理由下钻 ——
  sr.querySelector('[data-tab="similar"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('相似推荐页渲染出卡片', list.querySelectorAll('.cf-simcard').length === 1);
  const sbarI = list.querySelector('.cf-simcard .sbar i');
  check('相似度以进度条呈现（宽 62%）', !!sbarI && String(sbarI.getAttribute('style')).indexOf('62%') !== -1);
  check('相似度徽章显示 相似 62%', list.textContent.indexOf('相似 62%') !== -1);
  check('详情默认收起', list.querySelectorAll('.sdetail').length === 0);
  list.querySelector('.cf-simcard .stog').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('点「为什么？」后展开详情', list.querySelectorAll('.cf-simcard .sdetail').length === 1);
  check('详情含「相似度构成」', list.textContent.indexOf('相似度构成') !== -1);
  check('详情显示维度占比 70%', list.textContent.indexOf('70%') !== -1);
  check('详情含「共同点明细」', list.textContent.indexOf('共同点明细') !== -1);
  check('共同点明细显示稀有度 1.8', list.textContent.indexOf('稀有 1.8') !== -1);
  check('详情含「共同出演作品」', list.textContent.indexOf('共同出演作品') !== -1);
  check('共同出演列出番号 ABC-900', list.textContent.indexOf('ABC-900') !== -1);
  check('详情含「她的其他作品」', list.textContent.indexOf('她的其他作品') !== -1);
  check('非共同作品 ABC-901 也在列', list.textContent.indexOf('ABC-901') !== -1);
  list.querySelector('.cf-simcard .stog').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('再点一次收起详情', list.querySelectorAll('.sdetail').length === 0);

  // —— 卡片键盘导航（面板打开时 J/K 移动当前卡片） ——
  {
    const navCards = Array.from(doc.querySelectorAll('.cf-card'));
    check('页面存在可导航的 cf-card', navCards.length > 0);
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    const navcur = doc.querySelectorAll('.cf-card.cf-navcur');
    check('按 J 后出现当前卡片高亮（cf-navcur）', navcur.length === 1);
    check('当前卡片是列表第一张', navcur.length === 1 && navcur[0] === navCards[0]);
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    const navcur2 = doc.querySelectorAll('.cf-card.cf-navcur');
    check('再按 J 后当前卡片下移一张', navcur2.length === 1 && navcur2[0] === navCards[1]);
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    const navcur3 = doc.querySelectorAll('.cf-card.cf-navcur');
    check('按 K 后当前卡片上移回第一张', navcur3.length === 1 && navcur3[0] === navCards[0]);
  }

  // —— 卡片右键菜单（页面内自绘） ——
  {
    const c1 = Array.from(doc.querySelectorAll('.cf-card')).find(el => {
      const a = el.querySelector('a[href]');
      return a && a.getAttribute('href') === '/ABC-004';
    });
    check('找到 ABC-004 卡片（含女优「大桥未久」）', !!c1);
    if (c1) {
      c1.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 120 }));
      const menu = doc.querySelector('.cf-cardmenu');
      check('右键卡片弹出菜单', !!menu);
      if (menu) {
        check('菜单显示女优名（大桥未久）', menu.textContent.indexOf('大桥未久') !== -1);
        check('菜单含屏蔽 / 收藏 / 高亮三项', menu.textContent.indexOf('屏蔽') !== -1 && menu.textContent.indexOf('收藏') !== -1 && menu.textContent.indexOf('高亮') !== -1);
        check('菜单含「加入 ⏳ 待看」', menu.textContent.indexOf('待看') !== -1);
        check('菜单含「复制番号」', menu.textContent.indexOf('复制番号') !== -1);
        check('菜单含多站搜索项', menu.querySelectorAll('button[data-cm="gosearch"]').length >= 3);
        // 点空白处关闭
        doc.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
        check('点击别处后菜单关闭', !doc.querySelector('.cf-cardmenu'));
      }
    }
  }

  // —— 重复 pass 的幂等性 + 增量提取缓存 ——
  // 触发一次新的 pass（追加一张卡片 → MutationObserver → schedulePass），
  // 验证：①新卡片被正确标记 ②老卡片的标记没被弄丢/没重复叠加
  // ③我们注入的按钮仍是「每卡一个」（签名排除自身按钮 → 缓存命中 → 不重复注入）
  {
    const beforeBlocked = doc.querySelectorAll('.item.cf-blocked').length;
    const beforeFav = doc.querySelectorAll('.item.cf-fav').length;
    const beforeBtnCount = doc.querySelectorAll('.item .cf-favbtn').length;
    const beforeCardCount = doc.querySelectorAll('.item').length;

    const cont = doc.querySelector('.container');
    const extra = doc.createElement('div');
    extra.className = 'item';
    extra.innerHTML = '<a class="movie-box" href="/ABC-999">' +
      '<div class="photo-frame"><img src="x.jpg" alt="ABC-999"></div>' +
      '<div class="photo-info"><span class="title">Title ABC-999</span>' +
      '<a href="/star/99">三上悠亚</a><a href="/genre/1">高清</a></div></a>';
    cont.appendChild(extra);

    setTimeout(() => {
      check('追加卡片后数量 +1', doc.querySelectorAll('.item').length === beforeCardCount + 1);
      check('新卡片被识别并标记（cf-card）', extra.classList.contains('cf-card'));
      check('新卡片按规则被屏蔽（女优三上悠亚 + 标签高清）', extra.classList.contains('cf-blocked'));
      check('重复 pass 后老卡片的屏蔽标记未丢失', doc.querySelectorAll('.item.cf-blocked').length >= beforeBlocked);
      check('重复 pass 后老卡片的收藏标记未丢失', doc.querySelectorAll('.item.cf-fav').length >= beforeFav);
      check('注入的 ♥ 按钮未被重复叠加（每卡最多一个）',
        doc.querySelectorAll('.item .cf-favbtn').length <= doc.querySelectorAll('.item.cf-card').length &&
        doc.querySelectorAll('.item .cf-favbtn').length >= beforeBtnCount);

      // —— 数据看板：每日 statsLog 写入（flushStats 防抖 3s，需等待） ——
      setTimeout(() => {
        const log = store['sf_data_v1'].statsLog || {};
        const day = new Date(); const key = day.getFullYear() + '-' + (day.getMonth() + 1) + '-' + day.getDate();
        check('statsLog 写入当天每日统计', !!log[key] && typeof log[key].blocked === 'number');
        console.log('      statsLog[' + key + ']:', JSON.stringify(log[key] || null));
        // —— 软屏蔽开关已接入面板（行为细节见 _test_softblock.js） ——
        // 说明：jsdom 对 Shadow DOM 内复选框的 .click() 激活语义不稳定（附加监听器后会失效），
        // 因此这里只校验开关存在；软屏蔽的完整行为用独立、确定性的专项测试覆盖。
        const cbSoft = sr.querySelector('input[data-cb="softBlock"]');
        check('面板存在「软屏蔽」开关', !!cbSoft);
        check('「软屏蔽」以通用 data-cb 机制接线（可被设置页/popup 同步）', !!cbSoft && cbSoft.dataset.cb === 'softBlock');

        // —— 规则预览模式开关（行为细节见 _test_softblock.js 阶段三） ——
        const cbPreview = sr.querySelector('input[data-cb="previewMode"]');
        check('面板存在「规则预览」开关', !!cbPreview);
        check('「规则预览」以通用 data-cb 机制接线', !!cbPreview && cbPreview.dataset.cb === 'previewMode');
        process.exit(pass ? 0 : 1);
      }, 3300);
    }, 600);
  }
}, 400);
