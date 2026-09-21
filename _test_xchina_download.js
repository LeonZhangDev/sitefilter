'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, 'xchina-download.js'), 'utf8');
let passed = 0;
let failed = 0;

function check(name, value) {
  if (value) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}

function wait(ms = 0) { return new Promise(resolve => setTimeout(resolve, ms)); }

function fixture(url, heading = '<h1>测试标题</h1>', options = {}) {
  const dom = new JSDOM('<!doctype html><html><body>' + heading + '<div class="cf-host"></div></body></html>', {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const host = window.document.querySelector('.cf-host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div id="panel"><div id="stats"></div></div>';
  const sent = [];
  const responses = [];
  window.chrome = { runtime: {
    lastError: null,
    sendMessage(message, callback) {
      sent.push(message);
      const response = responses.length ? responses.shift() :
        (message.type === 'sf_collector_restore' ? { ok: true, result: { found: false } } : { ok: true, result: {} });
      Promise.resolve(response).then(callback);
    },
  } };
  window.__SF_XCHINA_DISABLE_AUTO = true;
  if (options.pollMs != null) window.__SF_XCHINA_POLL_MS = options.pollMs;
  window.eval(code);
  return { dom, window, document: window.document, host, shadow, sent, responses, api: window.SiteFilterXChinaDownload };
}

async function run() {
  {
    const scripts = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')).content_scripts[0].js;
    check('xchina script loads after content script', scripts.indexOf('xchina-download.js') === scripts.indexOf('content.js') + 1);
  }
  {
    const h = fixture('https://xchina.co/photo/id-6664761937F5A/2.html?from=list#gallery');
    const page = h.api.parseUrl(h.window.location.href);
    check('photo paginated URL recognized', page && page.kind === 'photo');
    check('photo provisional key canonical', page && page.contentKey === 'xchina_gallery:6664761937f5a');
    check('query and fragment excluded from request URL', page && page.url === 'https://xchina.co/photo/id-6664761937F5A/2.html');
    h.api.init();
    check('title control beside h1', !!h.document.querySelector('h1 + [data-sf-xchina="title"]'));
    check('panel control rendered', !!h.shadow.querySelector('[data-sf-xchina="panel"]'));
    check('explicit Collector label', [...h.document.querySelectorAll('.sf-xchina-primary')].some(b => b.textContent.includes('交给 Collector 下载')));
    check('photo menu offers image-only', !!h.document.querySelector('[data-media="image"]'));
    check('photo menu offers video-only', !!h.document.querySelector('[data-media="video"]'));

    let releasePreview;
    h.responses.push(new Promise(resolve => { releasePreview = resolve; }));
    h.document.querySelector('.sf-xchina-primary').click();
    check('both locations share disabled state while pending', h.document.querySelector('.sf-xchina-primary').disabled && h.shadow.querySelector('.sf-xchina-primary').disabled);
    check('both locations share loading status', h.document.querySelector('.sf-xchina-status').textContent === h.shadow.querySelector('.sf-xchina-status').textContent && /预览/.test(h.document.querySelector('.sf-xchina-status').textContent));
    releasePreview({ ok: true, result: {
      collector: 'xchina_gallery', group: 'Collector 标题', photos: 12, videos: 2,
      media: ['image', 'video'],
      video_bytes: 1048576, output_dir: 'D:/Downloads/private-user', download_dir: '/home/private-user/downloads', sampled: true,
      warning: '这是警告', disposition: 'reused-active',
    } });
    await wait();
    const photoPreviews = h.sent.filter(x => x.type === 'sf_collector_preview');
    check('photo primary previews with media auto', photoPreviews.length === 1 && photoPreviews[0].media === 'auto');
    const modal = h.document.querySelector('[data-sf-xchina="modal"]');
    check('preview modal has accessible dialog', modal && modal.getAttribute('role') === 'dialog' && modal.getAttribute('aria-modal') === 'true');
    check('preview fields rendered without exposing the local output path', modal && /Collector 标题/.test(modal.textContent) && /xchina_gallery/.test(modal.textContent) && /12/.test(modal.textContent) && /2/.test(modal.textContent) && /1 MB/.test(modal.textContent) && /使用 Collector 当前设置/.test(modal.textContent) && !/private-user|D:\/Downloads|\/home\//.test(h.document.documentElement.outerHTML) && /抽样/.test(modal.textContent) && /这是警告/.test(modal.textContent) && /复用活动任务/.test(modal.textContent));
    check('modal initial focus on confirm', h.document.activeElement && h.document.activeElement.dataset.action === 'confirm');

    const confirms = modal.querySelectorAll('[data-action="confirm"]');
    h.responses.push({ ok: true, result: { task_id: 7, disposition: 'created', content_key: page.contentKey } });
    confirms[0].click(); confirms[0].click();
    await wait();
    check('double confirm creates once', h.sent.filter(x => x.type === 'sf_collector_create').length === 1);
    check('shared loading/disabled state clears together', [...h.document.querySelectorAll('.sf-xchina-primary')].every(b => !b.disabled));
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: '仅图片', media: ['image'], photos: 12, videos: null, sampled: false } });
    h.document.querySelector('[data-media="image"]').click(); await wait();
    check('image-only action sends media image and accepts excluded null count', h.sent.filter(x => x.type === 'sf_collector_preview').slice(-1)[0].media === 'image' && !!h.document.querySelector('[data-sf-xchina="modal"]'));
    h.document.querySelector('[data-action="cancel"]').click();
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: '仅视频', media: ['video'], photos: null, videos: 2, sampled: false } });
    h.document.querySelector('[data-media="video"]').click(); await wait();
    check('photo video-only action sends media video', h.sent.filter(x => x.type === 'sf_collector_preview').slice(-1)[0].media === 'video' && !!h.document.querySelector('[data-sf-xchina="modal"]'));
    h.document.querySelector('[data-action="cancel"]').click();
    h.api.destroy();
    check('destroy removes all DOM', !h.document.querySelector('[data-sf-xchina]') && !h.shadow.querySelector('[data-sf-xchina]'));
  }

  {
    const h = fixture('https://xchina.co/video/id-6aaee7c9a12e8.html', '<main><h1>视频标题</h1></main>');
    h.api.init();
    const page = h.api.current();
    check('video provisional key canonical', page && page.contentKey === 'xchina_video:6aaee7c9a12e8');
    check('video menu offers video-only', !!h.document.querySelector('[data-media="video"]'));
    check('video menu does not offer image-only', !h.document.querySelector('[data-media="image"]'));
    h.responses.push({ ok: true, result: { collector: 'xchina_video', title: '视频标题', media: ['video'], photos: 0, videos: 1, sampled: false } });
    h.document.querySelector('.sf-xchina-primary').click();
    await wait();
    const videoPreviews = h.sent.filter(x => x.type === 'sf_collector_preview');
    check('video primary uses automatic Collector media', videoPreviews[0] && !Object.prototype.hasOwnProperty.call(videoPreviews[0], 'media'));
  }

  for (const url of [
    'https://example.com/photo/id-6664761937f5a.html',
    'https://xchina.co/',
    'https://xchina.co/photo/id-short.html',
    'http://xchina.co/photo/id-6664761937f5a.html',
  ]) {
    const h = fixture(url);
    h.api.init();
    check('unsupported URL injects nothing: ' + url, !h.document.querySelector('[data-sf-xchina]') && !h.shadow.querySelector('[data-sf-xchina]') && !h.shadow.querySelector('#collectorSlot'));
  }
  {
    const h = fixture('https://xchina.co/');
    check('raw explicit default port is rejected', h.api.parseUrl('https://xchina.co:443/photo/id-6664761937f5a.html') === null);
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html', '');
    h.api.init();
    check('missing heading keeps panel fallback', !h.document.querySelector('[data-sf-xchina="title"]') && !!h.shadow.querySelector('[data-sf-xchina="panel"]'));
    const heading = h.document.createElement('h1'); heading.textContent = '延迟标题'; h.document.body.appendChild(heading);
    await wait(); await wait();
    check('DOM mutation adds title control later', !!h.document.querySelector('h1 + [data-sf-xchina="title"]'));
    h.window.history.pushState({}, '', '/model/id-6664761937f5a.html');
    h.api.reconcile();
    check('navigation tears down controls', !h.document.querySelector('[data-sf-xchina]') && !h.shadow.querySelector('[data-sf-xchina]'));
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html');
    h.api.init();
    const opener = h.document.querySelector('.sf-xchina-primary');
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: 'A', media: ['image'], photos: 1, videos: 0, sampled: false } });
    opener.focus(); opener.click(); await wait();
    const modal = h.document.querySelector('[data-sf-xchina="modal"]');
    const cancel = modal.querySelector('[data-action="cancel"]');
    modal.querySelector('[data-action="confirm"]').focus();
    h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    check('focus trap wraps inside modal', h.document.activeElement && h.document.activeElement.dataset.action === 'cancel');
    h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes modal', !h.document.querySelector('[data-sf-xchina="modal"]'));
    check('modal restores opener focus', h.document.activeElement === opener);
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html');
    h.api.init();
    let release;
    h.responses.push(new Promise(resolve => { release = resolve; }));
    h.document.querySelector('.sf-xchina-primary').click();
    h.window.history.pushState({}, '', '/video/id-6aaee7c9a12e8.html');
    h.api.reconcile();
    release({ ok: true, result: { collector: 'xchina_gallery', group: '旧页面', media: ['image'], photos: 1, videos: 0, sampled: false } });
    await wait();
    check('pending preview from page A is ignored after navigation to B', !h.document.querySelector('[data-sf-xchina="modal"]') && h.api.current().contentKey === 'xchina_video:6aaee7c9a12e8');
    check('new page controls are not left busy by stale preview', !h.document.querySelector('.sf-xchina-primary').disabled);
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html');
    h.api.init();
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: 'A', media: ['image'], photos: 1, videos: 0, sampled: false } });
    h.document.querySelector('.sf-xchina-primary').click(); await wait();
    check('page A modal exists before navigation', !!h.document.querySelector('[data-sf-xchina="modal"]'));
    h.window.history.pushState({}, '', '/video/id-6aaee7c9a12e8.html'); h.api.reconcile();
    check('navigation tears down page A modal', !h.document.querySelector('[data-sf-xchina="modal"]'));
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html');
    h.api.init();
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: 'A', media: ['image'], photos: 1, videos: 0, sampled: false } });
    h.document.querySelector('.sf-xchina-primary').click(); await wait();
    let release;
    h.responses.push(new Promise(resolve => { release = resolve; }));
    h.document.querySelector('[data-action="confirm"]').click();
    h.window.history.pushState({}, '', '/video/id-6aaee7c9a12e8.html'); h.api.reconcile();
    release({ ok: true, result: { task_id: 91, disposition: 'created', content_key: 'xchina_gallery:6664761937f5a' } });
    await wait();
    check('stale create response does not pollute page B', !/91/.test(h.document.querySelector('.sf-xchina-status').textContent) && !h.document.querySelector('[data-sf-xchina="modal"]'));
  }

  {
    const invalidCases = [
      { name: 'missing result', response: { ok: true } },
      { name: 'array result', response: { ok: true, result: [] } },
      { name: 'wrong preview count', response: { ok: true, result: { collector: 'xchina_gallery', group: 'A', media: ['image'], photos: -1, videos: 0, sampled: false } } },
    ];
    for (const item of invalidCases) {
      const h = fixture('https://xchina.co/photo/id-6664761937f5a.html');
      h.api.init(); h.responses.push(item.response);
      h.document.querySelector('.sf-xchina-primary').click(); await wait();
      check('malformed preview rejected: ' + item.name, /协议响应无效/.test(h.document.querySelector('.sf-xchina-status').textContent) && !h.document.querySelector('[data-sf-xchina="modal"]'));
      h.api.destroy();
    }
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html');
    h.api.init();
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: 'A', media: ['image'], photos: 1, videos: 0, sampled: false } });
    h.document.querySelector('.sf-xchina-primary').click(); await wait();
    const modal = h.document.querySelector('[data-sf-xchina="modal"]');
    h.responses.push({ ok: true, result: { task_id: 3, disposition: 'created', content_key: 'xchina_gallery:aaaaaaaaaaaaa' } });
    modal.querySelector('[data-action="confirm"]').click(); await wait();
    check('mismatched create identity rejected', /协议响应无效/.test(h.document.querySelector('.sf-xchina-status').textContent));
    check('mismatched create keeps modal open', h.document.querySelector('[data-sf-xchina="modal"]') === modal && !modal.querySelector('[data-action="confirm"]').disabled);
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html');
    h.responses.push({ ok: true, result: { found: true, task: {
      id: 77, status: 'downloading', resource_counts: { done: 3, pending: 2 }
    } } });
    h.api.init(); await wait();
    check('page load restores latest task by content identity', h.sent[0].type === 'sf_collector_restore' &&
      h.sent[0].content_key === 'xchina_gallery:6664761937f5a' && /#77/.test(h.document.querySelector('.sf-xchina-status').textContent) &&
      /3\/5/.test(h.document.querySelector('.sf-xchina-status').textContent));
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html');
    let releaseRestore;
    h.responses.push(new Promise(resolve => { releaseRestore = resolve; }));
    h.api.init();
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: 'A', media: ['image'], photos: 1, videos: 0, sampled: false } });
    h.document.querySelector('.sf-xchina-primary').click(); await wait();
    releaseRestore({ ok: true, result: { found: true, task: { id: 76, status: 'failed', resource_counts: { total: 1, failed: 1 } } } });
    await wait();
    check('late page restoration cannot overwrite a newer preview flow', !!h.document.querySelector('[data-sf-xchina="modal"]') &&
      /\u9884\u89c8\u5df2\u5c31\u7eea/.test(h.document.querySelector('.sf-xchina-status').textContent));
  }

  async function openReadyPreview(h) {
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: 'A', media: ['image'], photos: 1, videos: 0, sampled: false } });
    h.document.querySelector('.sf-xchina-primary').click(); await wait();
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html'); h.api.init(); await wait();
    await openReadyPreview(h);
    h.responses.push({ ok: true, result: { task_id: 31, status: 'success', disposition: 'confirm-redownload', content_key: 'xchina_gallery:6664761937f5a' } });
    h.document.querySelector('[data-action="confirm"]').click(); await wait();
    check('completed task requires a second explicit redownload confirmation', /\u91cd\u65b0\u4e0b\u8f7d/.test(h.document.querySelector('[data-action="confirm"]').textContent) &&
      h.sent.filter(x => x.type === 'sf_collector_create')[0].force_new === false);
    h.document.querySelector('[data-action="cancel"]').click(); await wait();
    check('cancelled redownload confirmation never sends force_new', h.sent.filter(x => x.type === 'sf_collector_create').length === 1);
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html'); h.api.init(); await wait();
    await openReadyPreview(h);
    h.responses.push({ ok: true, result: { task_id: 31, status: 'success', disposition: 'confirm-redownload', content_key: 'xchina_gallery:6664761937f5a' } });
    h.document.querySelector('[data-action="confirm"]').click(); await wait();
    h.responses.push({ ok: true, result: { task_id: 32, status: 'pending', disposition: 'created', content_key: 'xchina_gallery:6664761937f5a' } });
    h.document.querySelector('[data-action="confirm"]').click(); await wait();
    const createMessages = h.sent.filter(x => x.type === 'sf_collector_create');
    check('confirmed completed redownload sends force_new exactly once', createMessages.length === 2 && createMessages[1].force_new === true);
  }

  for (const recommendation of [
    ['recommend-retry', '\u67e5\u770b\u5e76\u91cd\u8bd5', '\u5efa\u8bae\u91cd\u8bd5'],
    ['recommend-resume', '\u67e5\u770b\u5e76\u6062\u590d', '\u5efa\u8bae\u6062\u590d'],
  ]) {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html'); h.api.init(); await wait();
    await openReadyPreview(h);
    h.responses.push({ ok: true, result: { task_id: 44, status: 'failed', disposition: recommendation[0], content_key: 'xchina_gallery:6664761937f5a' } });
    h.document.querySelector('[data-action="confirm"]').click(); await wait();
    const action = h.document.querySelector('[data-sf-collector-next-action]');
    check(recommendation[0] + ' renders one stable next action', action && action.textContent.includes(recommendation[1]) &&
      h.document.querySelector('.sf-xchina-status').textContent.includes(recommendation[2]));
    h.responses.push({ ok: true, result: { opened: true } }); action.click(); await wait();
    check(recommendation[0] + ' next action opens the existing task', h.sent.some(x => x.type === 'sf_collector_open_task' && x.task_id === 44));
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html'); h.api.init(); await wait();
    h.responses.push({ ok: false, error: { code: 'native-host-missing', message: 'missing', retriable: true } });
    h.document.querySelector('.sf-xchina-primary').click(); await wait();
    const redetect = h.document.querySelector('[data-sf-collector-next-action]');
    check('missing host shows installer path and one re-detect action', /install-native-host\.ps1/.test(h.document.querySelector('.sf-xchina-status').textContent) &&
      redetect && /\u91cd\u65b0\u68c0\u6d4b/.test(redetect.textContent));
    check('missing host never opens a management page automatically', !h.sent.some(x => x.type === 'sf_collector_open_task'));
    h.responses.push({ ok: true, result: { collector: { status: 'ok' } } }); redetect.click(); await wait();
    check('re-detect explicitly pings the bridge', h.sent.some(x => x.type === 'sf_collector_ping'));
  }

  {
    const h = fixture('https://xchina.co/video/id-6aaee7c9a12e8.html'); h.api.init(); await wait();
    h.responses.push({ ok: false, error: { code: 'login-required', message: 'login', retriable: false } });
    h.document.querySelector('.sf-xchina-primary').click(); await wait();
    const login = h.document.querySelector('[data-sf-collector-next-action]');
    check('login required offers an explicit login action without cookie transfer language', login && /\u542f\u52a8\u767b\u5f55/.test(login.textContent) &&
      !/cookie|\u5bfc\u51fa|\u4f20\u8f93/i.test(h.document.querySelector('.sf-xchina-status').textContent));
    check('login session is not started before user click', !h.sent.some(x => x.type === 'sf_collector_start_login'));
    h.responses.push({ ok: true, result: { started: true } }); login.click(); await wait();
    check('login session starts only after explicit click', h.sent.some(x => x.type === 'sf_collector_start_login' && x.url === 'https://xchina.co/video/id-6aaee7c9a12e8.html'));
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html'); h.api.init(); await wait();
    h.responses.push({ ok: false, error: { code: 'future-unknown-code', message: 'unsafe upstream detail', retriable: false } });
    h.document.querySelector('.sf-xchina-primary').click(); await wait();
    const fallback = h.document.querySelector('[data-sf-collector-next-action]');
    check('unknown error code uses a safe retry fallback', fallback && /\u91cd\u8bd5/.test(fallback.textContent) &&
      !/unsafe upstream detail/.test(h.document.querySelector('.sf-xchina-status').textContent));
  }

  for (const badStatus of [undefined, 'running', 'failed']) {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html'); h.api.init(); await wait();
    await openReadyPreview(h);
    const result = { task_id: 51, disposition: 'confirm-redownload', content_key: 'xchina_gallery:6664761937f5a' };
    if (badStatus !== undefined) result.status = badStatus;
    h.responses.push({ ok: true, result });
    h.document.querySelector('[data-action="confirm"]').click(); await wait();
    const creates = h.sent.filter(x => x.type === 'sf_collector_create');
    check('redownload authorization rejects confirm disposition with status ' + String(badStatus),
      creates.length === 1 && creates[0].force_new === false &&
      !/\u786e\u8ba4\u91cd\u65b0\u4e0b\u8f7d/.test(h.document.querySelector('[data-action="confirm"]').textContent) &&
      /\u534f\u8bae\u54cd\u5e94\u65e0\u6548/.test(h.document.querySelector('.sf-xchina-status').textContent));
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html', '<h1>测试标题</h1>', { pollMs: 2 });
    h.responses.push({ ok: true, result: { found: true, task: { id: 90, status: 'pending', resource_counts: { total: 4, done: 0, failed: 0, filtered: 0 } } } });
    h.responses.push({ ok: true, result: { id: 90, status: 'downloading', progress: 50, resource_counts: { total: 4, done: 2, failed: 0, filtered: 0 } } });
    h.responses.push({ ok: true, result: { id: 90, status: 'success', progress: 100, resource_counts: { total: 4, done: 4, failed: 0, filtered: 0 } } });
    h.api.init(); await wait(100);
    check('restored active task polls pending through downloading to success', /#90/.test(h.document.querySelector('.sf-xchina-status').textContent) &&
      /\u5df2\u5b8c\u6210/.test(h.document.querySelector('.sf-xchina-status').textContent) &&
      h.sent.filter(x => x.type === 'sf_collector_get_task').length === 2);
    const stoppedAt = h.sent.length; await wait(10);
    check('terminal success stops page polling', h.sent.length === stoppedAt);
    h.api.destroy();
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html', '<h1>测试标题</h1>', { pollMs: 2 });
    h.responses.push({ ok: true, result: { found: true, task: { id: 91, status: 'pending', resource_counts: { total: 2, done: 0 } } } });
    h.responses.push({ ok: true, result: { id: 91, status: 'failed', progress: 25, resource_counts: { total: 2, done: 0, failed: 1 } } });
    h.api.init(); await wait(80);
    check('failed poll renders terminal state and stable retry guidance', /\u5931\u8d25/.test(h.document.querySelector('.sf-xchina-status').textContent) &&
      /\u67e5\u770b\u5e76\u91cd\u8bd5/.test(h.document.querySelector('[data-sf-collector-next-action]').textContent));
    const stoppedAt = h.sent.length; await wait(10);
    check('terminal failure stops page polling', h.sent.length === stoppedAt);
    h.api.destroy();
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html', '<h1>测试标题</h1>', { pollMs: 2 });
    let releasePoll;
    h.responses.push({ ok: true, result: { found: true, task: { id: 92, status: 'pending', resource_counts: { total: 1, done: 0 } } } });
    h.responses.push(new Promise(resolve => { releasePoll = resolve; }));
    h.api.init(); await wait(8);
    check('page polling is single-flight while a status request is pending', h.sent.filter(x => x.type === 'sf_collector_get_task').length === 1);
    h.window.history.pushState({}, '', '/video/id-6aaee7c9a12e8.html'); h.api.reconcile();
    releasePoll({ ok: true, result: { id: 92, status: 'success', progress: 100, resource_counts: { total: 1, done: 1 } } });
    await wait(10);
    check('navigation cancels polling and ignores stale task responses', h.sent.filter(x => x.type === 'sf_collector_get_task').length === 1 &&
      !/#92/.test(h.document.querySelector('.sf-xchina-status').textContent));
    h.api.destroy();
  }

  {
    const h = fixture('https://xchina.co/photo/id-6664761937f5a.html', '<h1>测试标题</h1>', { pollMs: 2 }); h.api.init(); await wait();
    await openReadyPreview(h);
    h.responses.push({ ok: true, result: { task_id: 93, status: 'pending', disposition: 'created', content_key: 'xchina_gallery:6664761937f5a' } });
    h.responses.push({ ok: true, result: { id: 93, status: 'success', progress: 100, resource_counts: { total: 1, done: 1 } } });
    h.document.querySelector('[data-action="confirm"]').click(); await wait(80);
    check('new active task starts bounded page polling', h.sent.some(x => x.type === 'sf_collector_get_task' && x.task_id === 93) &&
      /\u5df2\u5b8c\u6210/.test(h.document.querySelector('.sf-xchina-status').textContent));
    h.api.destroy();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch(error => { console.error(error); process.exit(1); });
