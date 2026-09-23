/* SiteFilter —— 自定义下载器本机桥（Tier B）。
 *
 * 只做一件事：把 magnet: 交给用户在设置里指定的下载器 exe 打开。
 *
 * 为什么需要它：浏览器扩展（MV3）**无法启动任意 exe**，只能把 magnet: 交给
 * 操作系统「已注册的默认 magnet 处理程序」（那就是 content.js 里的 Tier A）。
 * 想"指定用迅雷而不是 μTorrent"，就得经 Native Messaging 让本机一个小程序
 * 去 subprocess.Popen([你的exe, magnet])。本文件就是那个小程序在扩展侧的代理。
 *
 * 与 collector 桥（collector-native.js）是**两条独立通道**，互不影响：
 *   · collector 桥 host = dev.zackzhang.sitefilter_collector（下载媒体文件用）
 *   · 本桥      host = dev.zackzhang.sitefilter_magnet   （打开磁力用）
 * 分开的原因：collector 桥的 host 目前只放行 xchina.co 详情页，且那个仓库有
 * 并行会话在改；磁力唤起不该被它绑住。
 *
 * 失败要能优雅降级：host 没装 / 超时 / 客户端路径不存在，都返回可读错误，
 * 由 content.js 决定回退到 Tier A（系统默认）还是提示用户。
 */
'use strict';

(function (root) {
  var HOST_NAME = 'dev.zackzhang.sitefilter_magnet';
  var PROTOCOL_VERSION = 1;
  var port = null;
  var portGeneration = 0;
  var sequence = 0;
  var pending = Object.create(null);

  function bridgeError(code, message, retriable) {
    var err = new Error(message || code);
    err.code = code;
    err.retriable = !!retriable;
    return err;
  }

  function runtimeError() {
    try { return chrome.runtime.lastError && chrome.runtime.lastError.message; } catch (_) { return ''; }
  }

  // Chrome 在 host 未注册 / 找不到时的报错文案各版本不一，这里统一归类成一个码，
  // 便于上层给出「请先运行安装脚本」这种可操作的提示，而不是丢一串英文。
  function disconnectCode(message) {
    return /(?:specified\s+)?native messaging host (?:not found|is not registered)/i.test(message || '') ||
      /找不到.*本机消息|未注册/i.test(message || '') ? 'native-host-missing' : 'native-host-disconnected';
  }

  function rejectGeneration(generation, err) {
    Object.keys(pending).forEach(function (id) {
      var item = pending[id];
      if (item.generation !== generation) return;
      delete pending[id];
      clearTimeout(item.timer);
      item.reject(err);
    });
  }

  function onMessage(sourcePort, generation, message) {
    var id = message && message.id;
    var item = typeof id === 'string' ? pending[id] : null;
    // 只认领本连接的请求：旧连接迟到的响应必须丢弃，否则会串台
    if (!item || item.port !== sourcePort || item.generation !== generation) return;
    delete pending[id];
    clearTimeout(item.timer);
    if (!message || message.v !== PROTOCOL_VERSION) {
      item.reject(bridgeError('incompatible-protocol', '本机下载器桥版本不兼容，请重新运行安装脚本。'));
    } else if (message.ok === true && Object.prototype.hasOwnProperty.call(message, 'result')) {
      item.resolve(message.result);
    } else if (message.ok === false && message.error && typeof message.error.code === 'string') {
      item.reject(bridgeError(message.error.code, message.error.message, message.error.retriable));
    } else {
      item.reject(bridgeError('invalid-native-response', '本机下载器桥返回了无效响应。'));
    }
    scheduleRelease(sourcePort, generation);
  }

  function onDisconnect(sourcePort, generation) {
    if (port !== sourcePort || portGeneration !== generation) return;
    var message = runtimeError() || '';
    port = null;
    var code = disconnectCode(message);
    rejectGeneration(generation, bridgeError(code,
      code === 'native-host-missing'
        ? '未安装「自定义下载器」本机桥，请先运行 native-host/install.py。'
        : '本机下载器桥连接已断开，请重试。', true));
  }

  function connect() {
    if (port) return { port: port, generation: portGeneration };
    try {
      var connected = chrome.runtime.connectNative(HOST_NAME);
      var generation = ++portGeneration;
      port = connected;
      connected.onMessage.addListener(function (message) { onMessage(connected, generation, message); });
      connected.onDisconnect.addListener(function () { onDisconnect(connected, generation); });
      return { port: connected, generation: generation };
    } catch (e) {
      port = null;
      throw bridgeError('native-host-missing', '未安装「自定义下载器」本机桥，请先运行 native-host/install.py。');
    }
  }

  function release(sourcePort, generation) {
    if (port !== sourcePort || portGeneration !== generation) return;
    if (Object.keys(pending).some(function (id) { return pending[id].generation === generation; })) return;
    port = null;
    try { sourcePort.disconnect(); } catch (_) { }
  }

  function scheduleRelease(sourcePort, generation) {
    setTimeout(function () { release(sourcePort, generation); }, 0);
  }

  function request(action, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var connection;
      try { connection = connect(); } catch (e) { reject(e); return; }
      var id = 'sfm-' + Date.now().toString(36) + '-' + (++sequence).toString(36);
      var timeout = typeof timeoutMs === 'number' ? timeoutMs : 8000;
      var timer = setTimeout(function () {
        var item = pending[id];
        if (!item || item.generation !== connection.generation) return;
        delete pending[id];
        reject(bridgeError('native-timeout', '本机下载器桥响应超时，请重试。', true));
        scheduleRelease(connection.port, connection.generation);
      }, timeout);
      pending[id] = { resolve: resolve, reject: reject, timer: timer, port: connection.port, generation: connection.generation };
      try {
        connection.port.postMessage({ v: PROTOCOL_VERSION, id: id, action: action, payload: payload || {} });
      } catch (e) {
        var failure = bridgeError('native-host-disconnected', '无法发送本机下载器桥请求，请重试。', true);
        if (port === connection.port && portGeneration === connection.generation) port = null;
        rejectGeneration(connection.generation, failure);
        try { connection.port.disconnect(); } catch (_) { }
      }
    });
  }

  /* 用指定的下载器打开一个 magnet。
   * client 为 exe 绝对路径（来自设置 magnetClient）。host 侧会校验路径存在与扩展名。 */
  function openMagnet(magnet, client) {
    return request('open-magnet', { magnet: String(magnet || ''), client: String(client || '') }, 8000);
  }

  /* 探测本机桥是否可用（装了 host 才通）。供设置页「测试」按钮用。 */
  function ping() {
    return request('ping', {}, 5000);
  }

  root.SiteFilterMagnetBridge = Object.freeze({
    request: request,
    openMagnet: openMagnet,
    ping: ping,
    hostName: HOST_NAME,
    protocolVersion: PROTOCOL_VERSION
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
