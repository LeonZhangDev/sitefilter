/* SiteFilter -> Universal Web Collector Native Messaging transport. */
'use strict';

(function (root) {
  var HOST_NAME = 'dev.zackzhang.sitefilter_collector';
  var PROTOCOL_VERSION = 1;
  var ACTIVE_KEY = 'sf_collector_active_tasks_v1';
  var TERMINAL = { success: true, partial: true, failed: true, cancelled: true };
  var port = null;
  var sequence = 0;
  var pending = Object.create(null);
  var notifying = Object.create(null);
  var storageMutation = Promise.resolve();

  function bridgeError(code, message, retriable) {
    var err = new Error(message || code);
    err.code = code;
    err.retriable = !!retriable;
    return err;
  }

  function disconnectCode(message) {
    return /(?:specified\s+)?native messaging host (?:not found|is not registered)/i.test(message || '') ||
      /找不到.*本机消息/i.test(message || '') ? 'native-host-missing' : 'native-host-disconnected';
  }

  function rejectAll(err) {
    Object.keys(pending).forEach(function (id) {
      var item = pending[id];
      delete pending[id];
      clearTimeout(item.timer);
      item.reject(err);
    });
  }

  function onMessage(message) {
    var id = message && message.id;
    var item = typeof id === 'string' ? pending[id] : null;
    if (!item) return;
    delete pending[id];
    clearTimeout(item.timer);
    if (!message || message.v !== PROTOCOL_VERSION) {
      item.reject(bridgeError('incompatible-protocol', '本机桥接版本不兼容，请重新运行安装程序。'));
      return;
    }
    if (message.ok === true && Object.prototype.hasOwnProperty.call(message, 'result')) {
      item.resolve(message.result);
      return;
    }
    if (message.ok === false && message.error && typeof message.error.code === 'string') {
      item.reject(bridgeError(message.error.code, message.error.message, message.error.retriable));
      return;
    }
    item.reject(bridgeError('invalid-native-response', '本机桥接返回了无效响应。'));
  }

  function onDisconnect() {
    var message = '';
    try { message = (chrome.runtime.lastError && chrome.runtime.lastError.message) || ''; } catch (_) { }
    port = null;
    var code = disconnectCode(message);
    rejectAll(bridgeError(code,
      code === 'native-host-missing' ? '未安装 SiteFilter 本机桥接，请运行安装程序。' : '本机桥接连接已断开，请重试。', true));
  }

  function connect() {
    if (port) return port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
      return port;
    } catch (e) {
      port = null;
      throw bridgeError('native-host-missing', '未安装 SiteFilter 本机桥接，请运行安装程序。');
    }
  }

  function request(action, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var nativePort;
      try { nativePort = connect(); } catch (e) { reject(e); return; }
      var id = 'sf-' + Date.now().toString(36) + '-' + (++sequence).toString(36);
      var timeout = typeof timeoutMs === 'number' ? timeoutMs : (action === 'preview' ? 160000 : 20000);
      var timer = setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        reject(bridgeError('native-timeout', 'Collector 响应超时，请重试。', true));
      }, timeout);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      try {
        nativePort.postMessage({ v: PROTOCOL_VERSION, id: id, action: action, payload: payload || {} });
      } catch (e) {
        delete pending[id];
        clearTimeout(timer);
        port = null;
        reject(bridgeError('native-host-disconnected', '无法发送本机桥接请求，请重试。', true));
      }
    });
  }

  function readActive() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(ACTIVE_KEY, function (values) {
        resolve((values && values[ACTIVE_KEY]) || {});
      });
    });
  }

  function writeActive(tasks) {
    return new Promise(function (resolve) {
      var values = {}; values[ACTIVE_KEY] = tasks;
      chrome.storage.local.set(values, resolve);
    });
  }

  function mutateActive(change) {
    storageMutation = storageMutation.then(function () {
      return readActive().then(function (tasks) {
        return Promise.resolve(change(tasks)).then(function (result) {
          return writeActive(tasks).then(function () { return result; });
        });
      });
    });
    return storageMutation;
  }

  function taskId(task) {
    return Number(task && (task.id || task.task_id));
  }

  function trackTask(task) {
    var id = taskId(task);
    if (!Number.isInteger(id) || id <= 0) return Promise.reject(bridgeError('invalid-task', '任务编号无效。'));
    return mutateActive(function (tasks) {
      tasks[String(id)] = {
        id: id,
        status: String(task.status || 'pending'),
        name: String(task.name || ''),
        updatedAt: Date.now()
      };
      return task;
    });
  }

  function terminalNotification(task) {
    var id = taskId(task);
    var status = String(task.status || '');
    var succeeded = status === 'success';
    return new Promise(function (resolve) {
      chrome.notifications.create('sf_collector_task_' + id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: succeeded ? 'Collector 下载完成' : 'Collector 任务已结束',
        message: (task.name ? String(task.name) + ' · ' : '') + status + '，点击查看任务详情。'
      }, function () { resolve(); });
    });
  }

  function observeTask(task) {
    var id = taskId(task);
    if (!Number.isInteger(id) || id <= 0) return Promise.reject(bridgeError('invalid-task', '任务编号无效。'));
    var status = String(task.status || '');
    if (!TERMINAL[status]) return trackTask(task);
    if (notifying[id]) return Promise.resolve(task);
    notifying[id] = true;
    return mutateActive(function (tasks) {
      if (!tasks[String(id)]) return false;
      delete tasks[String(id)];
      return true;
    }).then(function (wasActive) {
      if (!wasActive) return task;
      return terminalNotification(task).then(function () { return task; });
    });
  }

  function restoreAndPoll() {
    return readActive().then(function (tasks) {
      return Promise.all(Object.keys(tasks).map(function (id) {
        return request('get-task', { task_id: Number(id) }).then(observeTask).catch(function () {
          return null; // Keep persisted work for the next service-worker wake-up.
        });
      }));
    });
  }

  function createOrReuse(msg) {
    var payload = { url: msg.url };
    if (msg.media != null) payload.media = msg.media;
    if (msg.force_new != null) payload.force_new = msg.force_new;
    return request('create-or-reuse', payload).then(function (result) {
      var task = {
        id: result && result.task_id,
        status: result && result.status,
        name: result && result.name
      };
      return trackTask(task).then(function () { return observeTask(task); }).then(function () { return result; });
    });
  }

  function routeMessage(msg) {
    msg = msg || {};
    if (msg.type === 'sf_collector_ping') return request('ping', {});
    if (msg.type === 'sf_collector_preview') {
      var preview = { url: msg.url };
      if (msg.media != null) preview.media = msg.media;
      return request('preview', preview);
    }
    if (msg.type === 'sf_collector_create') return createOrReuse(msg);
    if (msg.type === 'sf_collector_get_task') {
      return request('get-task', { task_id: msg.task_id }).then(function (task) {
        return observeTask(task).then(function () { return task; });
      });
    }
    if (msg.type === 'sf_collector_open_task') return request('open-task', { task_id: msg.task_id });
    if (msg.type === 'sf_collector_start_login') return request('start-login', { url: msg.url });
    return Promise.reject(bridgeError('unsupported-message', '不支持的 Collector 消息。'));
  }

  function openNotification(notificationId) {
    var match = /^sf_collector_task_(\d+)$/.exec(String(notificationId || ''));
    if (!match) return Promise.resolve(false);
    return request('open-task', { task_id: Number(match[1]) }).then(function () { return true; });
  }

  root.SiteFilterCollectorBridge = Object.freeze({
    request: request,
    routeMessage: routeMessage,
    trackTask: trackTask,
    observeTask: observeTask,
    restoreAndPoll: restoreAndPoll,
    openNotification: openNotification,
    activeStorageKey: ACTIVE_KEY
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
