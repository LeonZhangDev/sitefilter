/* SiteFilter -> Universal Web Collector Native Messaging transport. */
'use strict';

(function (root) {
  var HOST_NAME = 'dev.zackzhang.sitefilter_collector';
  var PROTOCOL_VERSION = 1;
  var ACTIVE_KEY = 'sf_collector_active_tasks_v1';
  var TERMINAL = { success: true, partial: true, failed: true, cancelled: true };
  var CONTENT_KEY = /^xchina_(?:gallery|video):[0-9a-f]{13}$/;
  var port = null;
  var portGeneration = 0;
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

  function runtimeError() {
    try { return chrome.runtime.lastError && chrome.runtime.lastError.message; } catch (_) { return ''; }
  }

  function disconnectCode(message) {
    return /(?:specified\s+)?native messaging host (?:not found|is not registered)/i.test(message || '') ||
      /找不到.*本机消息/i.test(message || '') ? 'native-host-missing' : 'native-host-disconnected';
  }

  function normalizeActive(raw) {
    var clean = Object.create(null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
    try {
      Object.keys(raw).forEach(function (key) {
        if (!/^[1-9]\d{0,15}$/.test(key)) return;
        var value = raw[key];
        var id = value && value.taskId;
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
          !Number.isSafeInteger(id) || id <= 0 || String(id) !== key ||
          typeof value.terminalNotified !== 'boolean' ||
          !(value.contentKey === null || (typeof value.contentKey === 'string' && CONTENT_KEY.test(value.contentKey)))) return;
        clean[key] = { contentKey: value.contentKey, taskId: id, terminalNotified: value.terminalNotified };
      });
    } catch (_) { return Object.create(null); }
    return clean;
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
    if (!item || item.port !== sourcePort || item.generation !== generation) return;
    delete pending[id];
    clearTimeout(item.timer);
    if (!message || message.v !== PROTOCOL_VERSION) {
      item.reject(bridgeError('incompatible-protocol', '本机桥接版本不兼容，请重新运行安装程序。'));
    } else if (message.ok === true && Object.prototype.hasOwnProperty.call(message, 'result')) {
      item.resolve(message.result);
    } else if (message.ok === false && message.error && typeof message.error.code === 'string') {
      item.reject(bridgeError(message.error.code, message.error.message, message.error.retriable));
    } else {
      item.reject(bridgeError('invalid-native-response', '本机桥接返回了无效响应。'));
    }
    scheduleRelease(sourcePort, generation);
  }

  function onDisconnect(sourcePort, generation) {
    if (port !== sourcePort || portGeneration !== generation) return;
    var message = runtimeError() || '';
    port = null;
    var code = disconnectCode(message);
    rejectGeneration(generation, bridgeError(code,
      code === 'native-host-missing' ? '未安装 SiteFilter 本机桥接，请运行安装程序。' : '本机桥接连接已断开，请重试。', true));
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
      throw bridgeError('native-host-missing', '未安装 SiteFilter 本机桥接，请运行安装程序。');
    }
  }

  function readActive() {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(ACTIVE_KEY, function (values) {
        if (runtimeError()) { reject(bridgeError('storage-failed', '无法读取 Collector 任务状态。', true)); return; }
        resolve(normalizeActive(values && values[ACTIVE_KEY]));
      });
    });
  }

  function writeActive(tasks) {
    return new Promise(function (resolve, reject) {
      var values = {}; values[ACTIVE_KEY] = normalizeActive(tasks);
      chrome.storage.local.set(values, function () {
        if (runtimeError()) { reject(bridgeError('storage-failed', '无法保存 Collector 任务状态。', true)); return; }
        resolve();
      });
    });
  }

  function mutateActive(change) {
    function run() {
      return readActive().then(function (tasks) {
        return Promise.resolve(change(tasks)).then(function (result) {
          return writeActive(tasks).then(function () { return result; });
        });
      });
    }
    storageMutation = storageMutation.then(run, run);
    return storageMutation;
  }

  function maybeRelease(sourcePort, generation) {
    if (!sourcePort || port !== sourcePort || portGeneration !== generation) return Promise.resolve(false);
    if (Object.keys(pending).some(function (id) { return pending[id].generation === generation; })) return Promise.resolve(false);
    return readActive().then(function (tasks) {
      var hasActive = Object.keys(tasks).some(function (id) { return !tasks[id].terminalNotified; });
      if (port !== sourcePort || portGeneration !== generation || hasActive) return false;
      if (Object.keys(pending).some(function (id) { return pending[id].generation === generation; })) return false;
      port = null;
      try { sourcePort.disconnect(); } catch (_) { }
      return true;
    }).catch(function () { return false; });
  }

  function scheduleRelease(sourcePort, generation) {
    setTimeout(function () { maybeRelease(sourcePort, generation); }, 0);
  }

  function request(action, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var connection;
      try { connection = connect(); } catch (e) { reject(e); return; }
      var id = 'sf-' + Date.now().toString(36) + '-' + (++sequence).toString(36);
      var timeout = typeof timeoutMs === 'number' ? timeoutMs : (action === 'preview' ? 160000 : 20000);
      var timer = setTimeout(function () {
        var item = pending[id];
        if (!item || item.generation !== connection.generation) return;
        delete pending[id];
        reject(bridgeError('native-timeout', 'Collector 响应超时，请重试。', true));
        scheduleRelease(connection.port, connection.generation);
      }, timeout);
      pending[id] = { resolve: resolve, reject: reject, timer: timer, port: connection.port, generation: connection.generation };
      try {
        connection.port.postMessage({ v: PROTOCOL_VERSION, id: id, action: action, payload: payload || {} });
      } catch (e) {
        var failure = bridgeError('native-host-disconnected', '无法发送本机桥接请求，请重试。', true);
        if (port === connection.port && portGeneration === connection.generation) port = null;
        rejectGeneration(connection.generation, failure);
        try { connection.port.disconnect(); } catch (_) { }
      }
    });
  }

  function taskId(task) {
    if (!task || typeof task !== 'object') return NaN;
    return task.id != null ? task.id : task.task_id;
  }

  function trackTask(task, contentKey) {
    var id = taskId(task);
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.reject(bridgeError('invalid-task', '任务编号无效。'));
    var normalizedKey = typeof contentKey === 'string' && CONTENT_KEY.test(contentKey) ? contentKey : null;
    return mutateActive(function (tasks) {
      var previous = tasks[String(id)];
      tasks[String(id)] = {
        contentKey: normalizedKey || (previous && previous.contentKey) || null,
        taskId: id,
        terminalNotified: !!(TERMINAL[String(task.status || '')] && previous && previous.terminalNotified)
      };
      return task;
    });
  }

  function terminalNotification(task) {
    var id = taskId(task);
    var status = String(task.status || '');
    var outcome = {
      success: { title: 'Collector 下载完成', label: '已完成' },
      partial: { title: 'Collector 部分完成', label: '部分完成' },
      failed: { title: 'Collector 任务失败', label: '失败' },
      cancelled: { title: 'Collector 任务已取消', label: '已取消' }
    }[status] || { title: 'Collector 任务已结束', label: '已结束' };
    return new Promise(function (resolve, reject) {
      chrome.notifications.create('sf_collector_task_' + id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: outcome.title,
        message: (task.name ? String(task.name) + ' · ' : '') + outcome.label + '，点击查看任务详情。'
      }, function () {
        if (runtimeError()) { reject(bridgeError('notification-failed', '无法显示 Collector 任务通知。', true)); return; }
        resolve();
      });
    });
  }

  function finishNotification(id) {
    return mutateActive(function (tasks) {
      if (tasks[String(id)]) tasks[String(id)].terminalNotified = true;
    }).then(function () {
      return true;
    });
  }

  function observeTask(task) {
    var id = taskId(task);
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.reject(bridgeError('invalid-task', '任务编号无效。'));
    var status = String(task.status || '');
    if (!TERMINAL[status]) return trackTask(task);
    if (notifying[id]) return Promise.resolve(task);
    notifying[id] = true;
    return readActive().then(function (tasks) {
      var record = tasks[String(id)];
      if (!record) return task;
      if (record.terminalNotified) return task;
      return terminalNotification(task).then(function () {
        return finishNotification(id).then(function () { return task; });
      });
    }).then(function (result) {
      delete notifying[id];
      return maybeRelease(port, portGeneration).then(function () { return result; });
    }, function (error) {
      delete notifying[id];
      throw error;
    });
  }

  function restoreAndPoll() {
    return readActive().then(function (tasks) {
      return Promise.all(Object.keys(tasks).map(function (id) {
        if (tasks[id].terminalNotified) return null;
        return request('get-task', { task_id: Number(id) }).then(observeTask).catch(function () {
          return null;
        });
      }));
    });
  }

  function restoreContent(contentKey) {
    if (typeof contentKey !== 'string' || !CONTENT_KEY.test(contentKey)) {
      return Promise.reject(bridgeError('invalid-content-key', '页面内容标识无效。'));
    }
    return readActive().then(function (tasks) {
      var latest = Object.keys(tasks).reduce(function (selected, id) {
        var record = tasks[id];
        if (record.contentKey !== contentKey) return selected;
        return !selected || record.taskId > selected.taskId ? record : selected;
      }, null);
      if (!latest) return { found: false };
      return request('get-task', { task_id: latest.taskId }).then(function (task) {
        return observeTask(task).then(function () { return { found: true, task: task }; });
      });
    });
  }

  function createOrReuse(msg) {
    var payload = { url: msg.url };
    if (msg.media != null) payload.media = msg.media;
    if (msg.force_new != null) payload.force_new = msg.force_new;
    return request('create-or-reuse', payload).then(function (result) {
      var task = { id: result && result.task_id, status: result && result.status, name: result && result.name };
      return trackTask(task, result && result.content_key).then(function () {
        return observeTask(task);
      }).then(function () { return result; }, function () {
        return result; // The native create succeeded; do not invite a duplicate retry on local storage failure.
      });
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
    if (msg.type === 'sf_collector_restore') return restoreContent(msg.content_key);
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
    restoreContent: restoreContent,
    restoreAndPoll: restoreAndPoll,
    openNotification: openNotification,
    activeStorageKey: ACTIVE_KEY
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
