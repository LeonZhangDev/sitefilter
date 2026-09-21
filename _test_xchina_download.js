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

function wait() { return new Promise(resolve => setTimeout(resolve, 0)); }

function fixture(url, heading = '<h1>测试标题</h1>') {
  const dom = new JSDOM('<!doctype html><html><body>' + heading + '<div class="cf-host"></div></body></html>', {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const host = window.document.querySelector('.cf-host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div id="collectorSlot" class="cf-xchina-panel-slot"></div>';
  const sent = [];
  const responses = [];
  window.chrome = { runtime: {
    lastError: null,
    sendMessage(message, callback) {
      sent.push(message);
      const response = responses.length ? responses.shift() : { ok: true, result: {} };
      Promise.resolve(response).then(callback);
    },
  } };
  window.__SF_XCHINA_DISABLE_AUTO = true;
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
    check('photo menu does not offer video-only', !h.document.querySelector('[data-media="video"]'));

    let releasePreview;
    h.responses.push(new Promise(resolve => { releasePreview = resolve; }));
    h.document.querySelector('.sf-xchina-primary').click();
    check('both locations share disabled state while pending', h.document.querySelector('.sf-xchina-primary').disabled && h.shadow.querySelector('.sf-xchina-primary').disabled);
    check('both locations share loading status', h.document.querySelector('.sf-xchina-status').textContent === h.shadow.querySelector('.sf-xchina-status').textContent && /预览/.test(h.document.querySelector('.sf-xchina-status').textContent));
    releasePreview({ ok: true, result: {
      collector: 'xchina_gallery', group: 'Collector 标题', photos: 12, videos: 2,
      video_bytes: 1048576, output_dir: 'D:/Downloads', sampled: true,
      warning: '这是警告', disposition: 'reused-active',
    } });
    await wait();
    check('photo primary previews with media auto', h.sent.length === 1 && h.sent[0].type === 'sf_collector_preview' && h.sent[0].media === 'auto');
    const modal = h.document.querySelector('[data-sf-xchina="modal"]');
    check('preview modal has accessible dialog', modal && modal.getAttribute('role') === 'dialog' && modal.getAttribute('aria-modal') === 'true');
    check('preview fields rendered', modal && /Collector 标题/.test(modal.textContent) && /xchina_gallery/.test(modal.textContent) && /12/.test(modal.textContent) && /2/.test(modal.textContent) && /1 MB/.test(modal.textContent) && /D:\/Downloads/.test(modal.textContent) && /抽样/.test(modal.textContent) && /这是警告/.test(modal.textContent) && /复用活动任务/.test(modal.textContent));
    check('modal initial focus on confirm', h.document.activeElement && h.document.activeElement.dataset.action === 'confirm');

    const confirms = modal.querySelectorAll('[data-action="confirm"]');
    h.responses.push({ ok: true, result: { task_id: 7, disposition: 'created', content_key: page.contentKey } });
    confirms[0].click(); confirms[0].click();
    await wait();
    check('double confirm creates once', h.sent.filter(x => x.type === 'sf_collector_create').length === 1);
    check('shared loading/disabled state clears together', [...h.document.querySelectorAll('.sf-xchina-primary')].every(b => !b.disabled));
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
    h.responses.push({ ok: true, result: { collector: 'xchina_video', title: '视频标题', photos: 0, videos: 1, sampled: false } });
    h.document.querySelector('.sf-xchina-primary').click();
    await wait();
    check('video primary uses automatic Collector media', h.sent[0] && h.sent[0].type === 'sf_collector_preview' && !Object.prototype.hasOwnProperty.call(h.sent[0], 'media'));
  }

  for (const url of [
    'https://example.com/photo/id-6664761937f5a.html',
    'https://xchina.co/',
    'https://xchina.co/photo/id-short.html',
    'http://xchina.co/photo/id-6664761937f5a.html',
  ]) {
    const h = fixture(url);
    h.api.init();
    check('unsupported URL injects nothing: ' + url, !h.document.querySelector('[data-sf-xchina]') && !h.shadow.querySelector('[data-sf-xchina]'));
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
    h.responses.push({ ok: true, result: { collector: 'xchina_gallery', group: 'A', photos: 1, videos: 0 } });
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch(error => { console.error(error); process.exit(1); });
