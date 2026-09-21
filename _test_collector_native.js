'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const bridgeCode = fs.readFileSync(path.join(__dirname, 'collector-native.js'), 'utf8');
const backgroundCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
let passed = 0;
let failed = 0;
function check(name, value) {
  if (value) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}
function wait(ms = 0) { return new Promise(resolve => setTimeout(resolve, ms)); }

function event() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    fire(...args) { return listeners.slice().map(fn => fn(...args)); },
  };
}

function harness(seed) {
  const ports = [];
  const store = Object.assign({}, seed || {});
  const notices = [];
  const tabs = [];
  const controls = { failNextGet: false, failNextSet: false, failNextNotification: false };
  const chrome = {
    runtime: {
      lastError: null,
      connectNative(name) {
        const nativePort = {
          name, sent: [], disconnects: 0, onMessage: event(), onDisconnect: event(),
          postMessage(msg) { this.sent.push(msg); },
          disconnect() { this.disconnects++; this.onDisconnect.fire(); },
        };
        ports.push(nativePort);
        return nativePort;
      },
      getURL(p) { return 'chrome-extension://id/' + p; },
    },
    storage: { local: {
      get(key, cb) {
        const out = {}; out[key] = store[key];
        if (controls.failNextGet) {
          controls.failNextGet = false; chrome.runtime.lastError = { message: 'get failed' };
          cb(out); chrome.runtime.lastError = null; return;
        }
        cb(out);
      },
      set(values, cb) {
        if (controls.failNextSet) {
          controls.failNextSet = false; chrome.runtime.lastError = { message: 'set failed' };
          cb(); chrome.runtime.lastError = null; return;
        }
        Object.assign(store, values); if (cb) cb();
      },
    } },
    notifications: {
      create(id, options, cb) {
        notices.push({ id, options });
        if (controls.failNextNotification) {
          controls.failNextNotification = false; chrome.runtime.lastError = { message: 'notification failed' };
          cb(); chrome.runtime.lastError = null; return;
        }
        if (cb) cb(id);
      },
    },
    tabs: { create(options) { tabs.push(options); } },
  };
  const context = { chrome, console, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(bridgeCode, context, { filename: 'collector-native.js' });
  return { chrome, ports, store, notices, tabs, controls, bridge: context.SiteFilterCollectorBridge };
}

function reply(nativePort, sent, result) {
  nativePort.onMessage.fire({ v: 1, id: sent.id, ok: true, result });
}

function backgroundHarness(seed) {
  const h = harness(seed);
  const runtimeMessage = event();
  const alarm = event();
  const notificationClick = event();
  let optionsOpened = 0;
  Object.assign(h.chrome.runtime, {
    onMessage: runtimeMessage,
    onInstalled: event(),
    onStartup: event(),
    sendMessage() { return Promise.resolve(); },
    openOptionsPage() { optionsOpened++; },
  });
  h.chrome.storage.sync = h.chrome.storage.local;
  h.chrome.storage.onChanged = event();
  h.chrome.contextMenus = { onClicked: event(), create() {}, removeAll(cb) { if (cb) cb(); } };
  h.chrome.action = { setBadgeBackgroundColor() {}, setBadgeText() {} };
  h.chrome.downloads = { download(_o, cb) { if (cb) cb(); } };
  h.chrome.alarms = { onAlarm: alarm, create() {} };
  h.chrome.notifications.onClicked = notificationClick;
  const context = { chrome: h.chrome, console, setTimeout, clearTimeout, Date, Promise };
  context.globalThis = context;
  context.importScripts = name => {
    if (name !== 'collector-native.js') throw new Error('unexpected import');
    vm.runInContext(bridgeCode, context, { filename: name });
  };
  vm.createContext(context);
  vm.runInContext(backgroundCode, context, { filename: 'background.js' });
  return Object.assign(h, { context, runtimeMessage, alarm, notificationClick, get optionsOpened() { return optionsOpened; } });
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
  const extensionId = Array.from(digest).map(byte =>
    String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join('');
  check('manifest key derives installed extension id', extensionId === 'jaihdgjnnpmiabeoefmihmjhoodcjlhf');
  check('nativeMessaging has no localhost host permission', manifest.permissions.includes('nativeMessaging') &&
    !(manifest.host_permissions || []).some(x => /localhost|127\.0\.0\.1/.test(x)));
  const packager = fs.readFileSync(path.join(__dirname, 'make_package.py'), 'utf8');
  check('packager includes transport in whitelist and syntax checks', (packager.match(/'collector-native\.js'/g) || []).length >= 2);

  const h1 = harness();
  const a = h1.bridge.request('ping', {}, 100);
  const b = h1.bridge.request('get-task', { task_id: 7 }, 100);
  const p1 = h1.ports[0];
  check('concurrent requests share one native port', h1.ports.length === 1 && p1.sent.length === 2);
  reply(p1, p1.sent[1], { id: 7, status: 'running' });
  reply(p1, p1.sent[0], { collector: { status: 'ok' } });
  check('out-of-order responses correlate by id', (await a).collector.status === 'ok' && (await b).id === 7);

  const idle = harness();
  const idlePing = idle.bridge.request('ping', {}, 100);
  reply(idle.ports[0], idle.ports[0].sent[0], { collector: { status: 'ok' } });
  await idlePing; await wait(5);
  check('idle bridge releases native port for MV3 suspension', idle.ports[0].disconnects === 1);
  const idleAgain = idle.bridge.request('ping', {}, 100);
  check('request after idle release reconnects', idle.ports.length === 2);
  reply(idle.ports[1], idle.ports[1].sent[0], {}); await idleAgain;

  const generations = harness();
  const oldRequest = generations.bridge.request('ping', {}, 100);
  const oldPort = generations.ports[0];
  oldPort.onDisconnect.fire();
  try { await oldRequest; } catch (_) { }
  const newRequest = generations.bridge.request('ping', {}, 100);
  const newPort = generations.ports[1];
  oldPort.onMessage.fire({ v: 1, id: newPort.sent[0].id, ok: true, result: { stale: true } });
  oldPort.onDisconnect.fire();
  reply(newPort, newPort.sent[0], { fresh: true });
  check('stale port message/disconnect cannot affect new generation', (await newRequest).fresh === true);

  const timeoutHarness = harness();
  let timedOut = false;
  try { await timeoutHarness.bridge.request('ping', {}, 5); } catch (e) { timedOut = e.code === 'native-timeout'; }
  check('timeout has stable classification', timedOut);

  const incompatibleHarness = harness();
  const incompatibleRequest = incompatibleHarness.bridge.request('ping', {}, 100);
  const incompatiblePort = incompatibleHarness.ports[0];
  incompatiblePort.onMessage.fire({ v: 2, id: incompatiblePort.sent[0].id, ok: true, result: {} });
  let incompatible = false;
  try { await incompatibleRequest; } catch (e) { incompatible = e.code === 'incompatible-protocol'; }
  check('incompatible protocol is rejected', incompatible);

  const missingHarness = harness();
  const missing = missingHarness.bridge.request('ping', {}, 100);
  missingHarness.chrome.runtime.lastError = { message: 'Specified native messaging host not found.' };
  missingHarness.ports[0].onDisconnect.fire();
  missingHarness.chrome.runtime.lastError = null;
  let hostMissing = false;
  try { await missing; } catch (e) { hostMissing = e.code === 'native-host-missing'; }
  check('missing host is classified separately', hostMissing);

  const activeKey = 'sf_collector_active_tasks_v1';
  const active = harness();
  await active.bridge.trackTask({ id: 41, status: 'running' }, 'xchina_gallery:6664761937f5a');
  check('active schema persists only canonical fields', JSON.stringify(active.store[activeKey]['41']) ===
    JSON.stringify({ contentKey: 'xchina_gallery:6664761937f5a', taskId: 41, terminalNotified: false }));
  const poll = active.bridge.restoreAndPoll(); await wait();
  reply(active.ports[0], active.ports[0].sent[0], { id: 41, status: 'running' }); await poll; await wait(5);
  check('active tracked work keeps native port connected', active.ports[0].disconnects === 0);

  const notifyFail = harness(active.store);
  const failedPoll = notifyFail.bridge.restoreAndPoll(); await wait();
  notifyFail.controls.failNextNotification = true;
  reply(notifyFail.ports[0], notifyFail.ports[0].sent[0], { id: 41, status: 'success', name: 'Album' });
  await failedPoll;
  check('failed notification retains retryable unnotified record',
    notifyFail.store[activeKey]['41'].terminalNotified === false);
  const retry = harness(notifyFail.store);
  const retryPoll = retry.bridge.restoreAndPoll(); await wait();
  reply(retry.ports[0], retry.ports[0].sent[0], { id: 41, status: 'success', name: 'Album' });
  await retryPoll; await wait(5);
  check('restart retries fixed-id terminal notification then persists delivery',
    retry.notices.length === 1 && retry.notices[0].id === 'sf_collector_task_41' && retry.store[activeKey]['41'].terminalNotified === true);
  const afterNotifyRestart = harness(retry.store);
  await afterNotifyRestart.bridge.restoreAndPoll();
  check('completed notification is not duplicated after restart', afterNotifyRestart.notices.length === 0 && afterNotifyRestart.ports.length === 0);

  const poison = JSON.parse('{"1":{"contentKey":null,"taskId":1,"terminalNotified":false},"__proto__":{"contentKey":null,"taskId":2,"terminalNotified":false},"2":{"contentKey":"bad","taskId":2,"terminalNotified":false},"3":{"contentKey":null,"taskId":"3","terminalNotified":false}}');
  const hardened = harness({ [activeKey]: poison });
  const hardenedPoll = hardened.bridge.restoreAndPoll(); await wait();
  check('bad storage keys and records are filtered', hardened.ports.length === 1 && hardened.ports[0].sent.length === 1 && hardened.ports[0].sent[0].payload.task_id === 1);
  reply(hardened.ports[0], hardened.ports[0].sent[0], { id: 1, status: 'running' }); await hardenedPoll;
  hardened.controls.failNextSet = true;
  let firstSetFailed = false;
  try { await hardened.bridge.trackTask({ id: 61, status: 'running' }); } catch (e) { firstSetFailed = e.code === 'storage-failed'; }
  await hardened.bridge.trackTask({ id: 62, status: 'running' });
  check('storage mutation queue recovers after rejection', firstSetFailed && hardened.store[activeKey]['62'].taskId === 62);

  const createStorageFail = harness();
  const create = createStorageFail.bridge.routeMessage({ type: 'sf_collector_create', url: 'https://xchina.co/photo/id-6664761937f5a.html' });
  createStorageFail.controls.failNextSet = true;
  reply(createStorageFail.ports[0], createStorageFail.ports[0].sent[0], {
    task_id: 88, status: 'running', disposition: 'created', content_key: 'xchina_gallery:6664761937f5a'
  });
  check('successful native create remains successful when persistence fails', (await create).task_id === 88);

  const bg = backgroundHarness();
  let response;
  const returns = bg.runtimeMessage.fire({ type: 'sf_collector_ping' }, {}, value => { response = value; });
  check('actual background listener keeps async response channel open', returns[0] === true);
  reply(bg.ports[0], bg.ports[0].sent[0], { collector: { status: 'ok' } }); await wait();
  check('actual background listener returns correlated response', response && response.ok === true);

  const alarmSeed = { [activeKey]: { '73': { contentKey: null, taskId: 73, terminalNotified: false } } };
  const bgLifecycle = backgroundHarness(alarmSeed);
  bgLifecycle.alarm.fire({ name: 'sf_collector_tasks' }); await wait();
  check('collector alarm restores persisted work', bgLifecycle.ports[0].sent[0].payload.task_id === 73);
  reply(bgLifecycle.ports[0], bgLifecycle.ports[0].sent[0], { id: 73, status: 'success' }); await wait(5);
  bgLifecycle.notificationClick.fire('sf_collector_task_73');
  const clickPort = bgLifecycle.ports[bgLifecycle.ports.length - 1];
  const clickMessage = clickPort.sent[clickPort.sent.length - 1];
  check('notification click routes through allowlisted open-task action', clickMessage.action === 'open-task' && clickMessage.payload.task_id === 73);
  check('background never opens an untrusted URL directly', bgLifecycle.tabs.length === 0);
  reply(clickPort, clickMessage, { opened: true }); await wait();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
