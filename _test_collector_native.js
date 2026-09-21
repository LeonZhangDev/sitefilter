'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const codePath = path.join(__dirname, 'collector-native.js');
let passed = 0;
let failed = 0;
function check(name, value) {
  if (value) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function event() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    fire(arg) { listeners.slice().forEach(fn => fn(arg)); },
  };
}

function harness(seed) {
  const ports = [];
  const store = Object.assign({}, seed || {});
  const notices = [];
  const chrome = {
    runtime: {
      lastError: null,
      connectNative(name) {
        const port = { name, sent: [], onMessage: event(), onDisconnect: event() };
        port.postMessage = msg => port.sent.push(msg);
        ports.push(port);
        return port;
      },
      getURL(p) { return 'chrome-extension://id/' + p; },
    },
    storage: { local: {
      get(key, cb) { const out = {}; out[key] = store[key]; cb(out); },
      set(values, cb) { Object.assign(store, values); if (cb) cb(); },
    } },
    notifications: {
      create(id, options, cb) { notices.push({ id, options }); if (cb) cb(id); },
    },
  };
  const context = { chrome, console, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(codePath, 'utf8'), context, { filename: codePath });
  return { chrome, ports, store, notices, bridge: context.SiteFilterCollectorBridge };
}

function reply(port, sent, result) {
  port.onMessage.fire({ v: 1, id: sent.id, ok: true, result });
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
  const extensionId = Array.from(digest).map(byte =>
    String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join('');
  check('manifest public key derives the installed native-host extension id', extensionId === 'jaihdgjnnpmiabeoefmihmjhoodcjlhf');
  check('manifest grants nativeMessaging without localhost host permissions',
    manifest.permissions.includes('nativeMessaging') && !(manifest.host_permissions || []).some(x => /localhost|127\.0\.0\.1/.test(x)));
  const background = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  check('background imports native transport and routes collector messages asynchronously',
    /importScripts\(['"]collector-native\.js['"]\)/.test(background) && /return true;/.test(background));
  const packager = fs.readFileSync(path.join(__dirname, 'make_package.py'), 'utf8');
  check('packaging whitelist and syntax checks include native transport',
    (packager.match(/'collector-native\.js'/g) || []).length >= 2);
  check('collector-native.js exports one global bridge', fs.existsSync(codePath) && !!harness().bridge);

  const h1 = harness();
  const a = h1.bridge.request('ping', {}, 100);
  const b = h1.bridge.request('get-task', { task_id: 7 }, 100);
  check('one native port is shared by concurrent requests', h1.ports.length === 1 && h1.ports[0].sent.length === 2);
  const p1 = h1.ports[0];
  reply(p1, p1.sent[1], { id: 7, status: 'running' });
  reply(p1, p1.sent[0], { collector: { status: 'ok' } });
  check('responses correlate by id even out of order', (await a).collector.status === 'ok' && (await b).id === 7);

  let timedOut = false;
  try { await h1.bridge.request('ping', {}, 5); } catch (e) { timedOut = e.code === 'native-timeout'; }
  check('request timeout has a stable classification', timedOut);

  const pending = h1.bridge.request('ping', {}, 100);
  h1.chrome.runtime.lastError = { message: 'Native messaging host has exited.' };
  p1.onDisconnect.fire();
  let disconnected = false;
  try { await pending; } catch (e) { disconnected = e.code === 'native-host-disconnected'; }
  h1.chrome.runtime.lastError = null;
  const after = h1.bridge.request('ping', {}, 100);
  check('disconnect rejects pending work and next request reconnects', disconnected && h1.ports.length === 2);
  reply(h1.ports[1], h1.ports[1].sent[0], { collector: { status: 'ok' } });
  await after;

  const bad = h1.bridge.request('ping', {}, 100);
  const p2 = h1.ports[1];
  p2.onMessage.fire({ v: 2, id: p2.sent[1].id, ok: true, result: {} });
  let incompatible = false;
  try { await bad; } catch (e) { incompatible = e.code === 'incompatible-protocol'; }
  check('incompatible response protocol is rejected', incompatible);

  const missingHarness = harness();
  const missing = missingHarness.bridge.request('ping', {}, 100);
  missingHarness.chrome.runtime.lastError = { message: 'Specified native messaging host not found.' };
  missingHarness.ports[0].onDisconnect.fire();
  let hostMissing = false;
  try { await missing; } catch (e) { hostMissing = e.code === 'native-host-missing'; }
  check('missing host is distinct from ordinary disconnect', hostMissing);

  const activeKey = 'sf_collector_active_tasks_v1';
  const h2 = harness();
  await h2.bridge.trackTask({ id: 41, status: 'running', name: 'Album' });
  check('active task is persisted', h2.store[activeKey] && h2.store[activeKey]['41'].status === 'running');
  const restored = harness(h2.store);
  const poll = restored.bridge.restoreAndPoll();
  await wait(0);
  const rp = restored.ports[0];
  check('service-worker restart restores and polls active task', rp.sent[0].action === 'get-task' && rp.sent[0].payload.task_id === 41);
  reply(rp, rp.sent[0], { id: 41, status: 'success', name: 'Album' });
  await poll;
  check('terminal task creates one notification', restored.notices.length === 1 && /41$/.test(restored.notices[0].id));
  await restored.bridge.observeTask({ id: 41, status: 'success', name: 'Album' });
  check('same terminal task is notified only once', restored.notices.length === 1);
  check('terminal task is removed from active persistence', Object.keys(restored.store[activeKey] || {}).length === 0);

  const click = restored.bridge.openNotification('sf_collector_task_41');
  const cp = restored.ports[0];
  const openSent = cp.sent[1];
  check('notification click asks host to open task deep link', openSent.action === 'open-task' && openSent.payload.task_id === 41);
  reply(cp, openSent, { opened: true });
  await click;

  const h3 = harness();
  const routed = h3.bridge.routeMessage({ type: 'sf_collector_create', url: 'https://xchina.co/photo/id-6664761937f5a.html', media: 'image' });
  const createSent = h3.ports[0].sent[0];
  check('sf_collector_create routes to allowlisted create action', createSent.action === 'create-or-reuse' && createSent.payload.media === 'image');
  reply(h3.ports[0], createSent, { task_id: 88, status: 'running', disposition: 'created' });
  const created = await routed;
  check('created active task is tracked', created.task_id === 88 && h3.store[activeKey]['88'].status === 'running');

  let unsupported = false;
  try { await h3.bridge.routeMessage({ type: 'sf_collector_shell' }); } catch (e) { unsupported = e.code === 'unsupported-message'; }
  check('unknown sf_collector route is rejected', unsupported);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
