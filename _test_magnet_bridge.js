/* SiteFilter —— 「自定义下载器」本机桥（magnet-native.js）专项测试。
 *
 * 这个模块跑在 background（service worker）里，用 chrome.runtime.connectNative
 * 连本机 host。它没有 UI、也没有页面可点，属于"出错只会静默失败"的那类代码 ——
 * 恰恰最需要有断言钉住：请求报文结构、响应分发、错误码归类、端口复用与释放。
 *
 * 这里用一个假的 chrome.runtime.connectNative 当"本机 host"，按需返回成功 /
 * 业务错误 / 协议不兼容 / 断开，逐一验证桥的行为。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = __dirname;
const code = fs.readFileSync(path.join(EXT, 'magnet-native.js'), 'utf8');

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 造一个假的 native 端口。reply 决定 host 如何回应：
   'ok' | 'err' | 'badproto' | 'silent'（不回，用于超时） */
function fakeHost(behavior) {
  const state = { sent: [], ports: 0, disconnects: 0, lastPort: null };
  function makePort() {
    state.ports++;
    const msgListeners = [], discListeners = [];
    const port = {
      postMessage(m) {
        state.sent.push(m);
        if (behavior === 'silent') return;
        setTimeout(() => {
          let resp;
          if (behavior === 'ok') resp = { v: 1, id: m.id, ok: true, result: { launched: true, client: 'C:\\t.exe', pid: 42 } };
          else if (behavior === 'err') resp = { v: 1, id: m.id, ok: false, error: { code: 'client-not-found', message: '找不到下载器。' } };
          else if (behavior === 'badproto') resp = { v: 9, id: m.id, ok: true, result: {} };
          else resp = { v: 1, id: m.id, ok: true, result: {} };
          msgListeners.forEach(fn => fn(resp));
        }, 0);
      },
      onMessage: { addListener(fn) { msgListeners.push(fn); } },
      onDisconnect: { addListener(fn) { discListeners.push(fn); } },
      disconnect() { state.disconnects++; },
      // 测试用：模拟 host 主动发来一条消息 / 断开
      _fireMessage(resp) { msgListeners.forEach(fn => fn(resp)); },
      _fireDisconnect(msg) { discListeners.forEach(fn => fn(msg)); },
    };
    state.lastPort = port;
    return port;
  }
  return { state, makePort };
}

function build(opts) {
  opts = opts || {};
  const host = fakeHost(opts.behavior || 'ok');
  const chrome = {
    runtime: {
      lastError: opts.lastError ? { message: opts.lastError } : null,
      connectNative(name) {
        host.state.hostName = name;
        if (opts.throwOnConnect) { const e = new Error('Specified native messaging host not found.'); throw e; }
        return host.makePort();
      },
    },
  };
  const sandbox = { chrome, setTimeout, clearTimeout, Promise, console, Error, JSON, Object, String, Number, Array };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'magnet-native.js' });
  return { bridge: sandbox.SiteFilterMagnetBridge, host, sandbox };
}

(async () => {
  /* ---------------- 导出面 ---------------- */
  {
    const { bridge } = build();
    check('[导出] SiteFilterMagnetBridge 已挂载', !!bridge);
    check('[导出] host 名固定为 dev.zackzhang.sitefilter_magnet',
      bridge.hostName === 'dev.zackzhang.sitefilter_magnet');
    check('[导出] 协议版本为 1', bridge.protocolVersion === 1);
    check('[导出] openMagnet / ping 都是函数',
      typeof bridge.openMagnet === 'function' && typeof bridge.ping === 'function');
  }

  /* ---------------- 成功路径 + 报文结构 ---------------- */
  {
    const { bridge, host } = build({ behavior: 'ok' });
    const r = await bridge.openMagnet('magnet:?xt=urn:btih:abc', 'C:\\Thunder.exe');
    check('[成功] openMagnet 解析出 host 返回的 result', r && r.launched === true && r.pid === 42);
    const m = host.state.sent[0];
    check('[报文] 带协议版本 v=1', m.v === 1);
    check('[报文] action = open-magnet', m.action === 'open-magnet');
    check('[报文] magnet / client 原样放进 payload',
      m.payload.magnet === 'magnet:?xt=urn:btih:abc' && m.payload.client === 'C:\\Thunder.exe');
    check('[报文] 带唯一 id', typeof m.id === 'string' && m.id.length > 0);
    check('[报文] 用的是约定的 host 名',
      host.state.hostName === 'dev.zackzhang.sitefilter_magnet');
  }

  /* ---------------- ping ---------------- */
  {
    const { bridge, host } = build({ behavior: 'ok' });
    await bridge.ping();
    check('[ping] action = ping', host.state.sent[0].action === 'ping');
  }

  /* ---------------- host 业务错误 ---------------- */
  {
    const { bridge } = build({ behavior: 'err' });
    let err = null;
    try { await bridge.openMagnet('magnet:?xt=urn:btih:abc', 'C:\\bad.exe'); } catch (e) { err = e; }
    check('[错误] host 返回的 error.code 透传', !!err && err.code === 'client-not-found');
    check('[错误] host 返回的 error.message 透传', !!err && /找不到下载器/.test(err.message));
  }

  /* ---------------- 协议不兼容 ---------------- */
  {
    const { bridge } = build({ behavior: 'badproto' });
    let err = null;
    try { await bridge.openMagnet('magnet:?xt=urn:btih:abc', 'C:\\t.exe'); } catch (e) { err = e; }
    check('[协议] 版本不匹配 → incompatible-protocol', !!err && err.code === 'incompatible-protocol');
  }

  /* ---------------- 未安装 host（connectNative 抛错） ---------------- */
  {
    const { bridge } = build({ throwOnConnect: true, lastError: 'Specified native messaging host not found.' });
    let err = null;
    try { await bridge.openMagnet('magnet:?xt=urn:btih:abc', 'C:\\t.exe'); } catch (e) { err = e; }
    check('[未装] connectNative 抛错 → native-host-missing', !!err && err.code === 'native-host-missing');
    check('[未装] 错误信息给出可操作指引（运行 install）', !!err && /install/.test(err.message));
  }

  /* ---------------- 半路断开 ---------------- */
  {
    const { bridge, host } = build({ behavior: 'silent', lastError: 'Specified native messaging host not found.' });
    const p = bridge.openMagnet('magnet:?xt=urn:btih:abc', 'C:\\t.exe');
    await sleep(10);
    host.state.lastPort._fireDisconnect();
    let err = null;
    try { await p; } catch (e) { err = e; }
    check('[断开] 未注册的 host 归类为 native-host-missing', !!err && err.code === 'native-host-missing');
    check('[断开] 标记可重试', !!err && err.retriable === true);
  }
  {
    const { bridge, host } = build({ behavior: 'silent', lastError: 'Native host has exited.' });
    const p = bridge.openMagnet('magnet:?xt=urn:btih:abc', 'C:\\t.exe');
    await sleep(10);
    host.state.lastPort._fireDisconnect();
    let err = null;
    try { await p; } catch (e) { err = e; }
    check('[断开] 其它断开原因归类为 native-host-disconnected',
      !!err && err.code === 'native-host-disconnected');
  }

  /* ---------------- 端口复用与释放 ---------------- */
  {
    const { bridge, host } = build({ behavior: 'ok' });
    await bridge.openMagnet('magnet:?xt=a', 'C:\\t.exe');
    await bridge.openMagnet('magnet:?xt=b', 'C:\\t.exe');
    check('[复用] 连续两次请求复用同一个端口（只连一次）', host.state.ports === 1);
    await sleep(10);
    check('[释放] 无待处理请求后端口被断开（不长期占着 host）', host.state.disconnects >= 1);
  }

  /* ---------------- 串台：id 不匹配的响应必须丢弃 ---------------- */
  {
    const { bridge, host } = build({ behavior: 'silent' });
    let settled = null;
    bridge.openMagnet('magnet:?xt=one', 'C:\\t.exe').then(() => { settled = 'ok'; }, () => { settled = 'err'; });
    await sleep(5);
    // host 回一个 id 对不上的响应（比如上一条请求迟到的回声）
    host.state.lastPort._fireMessage({ v: 1, id: 'nope', ok: true, result: {} });
    await sleep(5);
    check('[串台] id 不匹配的响应被丢弃（请求仍挂起，不会被误判成功）', settled === null);
    // 再回正确的 id，应当立刻被认领
    host.state.lastPort._fireMessage({ v: 1, id: host.state.sent[0].id, ok: true, result: { launched: true } });
    await sleep(5);
    check('[串台] 正确的 id 才能被认领', settled === 'ok');
  }

  /* ---------------- 响应既非 ok 也非 error → 判为无效响应 ---------------- */
  {
    const { bridge, host } = build({ behavior: 'silent' });
    const p = bridge.openMagnet('magnet:?xt=urn:btih:abc', 'C:\\t.exe');
    await sleep(5);
    host.state.lastPort._fireMessage({ v: 1, id: host.state.sent[0].id, something: 'weird' });
    let err = null;
    try { await p; } catch (e) { err = e; }
    check('[无效] 报文结构不对 → invalid-native-response',
      !!err && err.code === 'invalid-native-response');
  }

  console.log(pass ? '\n本机下载器桥专项测试全部通过 ✅' : '\n本机下载器桥专项测试存在失败 ❌');
  process.exit(pass ? 0 : 1);
})();
