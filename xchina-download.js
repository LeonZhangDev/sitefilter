/* XChina detail-page controls. Collector remains the sole media/task owner. */
'use strict';

(function (root) {
  var state = {
    page: null,
    busy: false,
    status: '',
    nextAction: null,
    controls: [],
    modal: null,
    modalKeydown: null,
    observer: null,
    interval: null,
    taskPollTimer: null,
    taskPollInFlight: false,
    taskPollToken: 0,
    listeners: [],
    lastUrl: '',
    destroyed: false,
    generation: 0,
    operationToken: 0
  };

  var DISPOSITIONS = {
    created: true,
    'reused-active': true,
    'confirm-redownload': true,
    'recommend-retry': true,
    'recommend-resume': true
  };
  var TASK_STATES = {
    pending: true, running: true, extracting: true, downloading: true, paused: true,
    success: true, partial: true, failed: true, cancelled: true
  };
  var TERMINAL_TASK_STATES = { success: true, partial: true, failed: true, cancelled: true };

  function protocolError() {
    var error = new Error('Collector 协议响应无效，请重新预览。');
    error.code = 'invalid-collector-response';
    return error;
  }

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    var proto = Object.getPrototypeOf(value);
    return proto === null || !!(proto.constructor && proto.constructor.name === 'Object');
  }

  function parseUrl(raw) {
    if (typeof raw !== 'string' || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;
    var authority = /^https:\/\/([^\/?#]*)/i.exec(raw);
    if (!authority || authority[1].toLowerCase() !== 'xchina.co') return null;
    var parsed;
    try { parsed = new URL(raw); } catch (_) { return null; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'xchina.co' || parsed.host !== 'xchina.co' ||
      parsed.username || parsed.password || parsed.port) return null;
    var photo = /^\/photo\/id-([0-9a-f]{13})(?:\/\d+)?\.html$/i.exec(parsed.pathname);
    var video = /^\/video\/id-([0-9a-f]{13})\.html$/i.exec(parsed.pathname);
    var match = photo || video;
    if (!match) return null;
    var kind = photo ? 'photo' : 'video';
    return {
      kind: kind,
      gid: match[1].toLowerCase(),
      contentKey: (kind === 'photo' ? 'xchina_gallery:' : 'xchina_video:') + match[1].toLowerCase(),
      url: parsed.origin + parsed.pathname
    };
  }

  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    state.listeners.push(function () { target.removeEventListener(type, fn, options); });
  }

  function send(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          var lastError;
          try { lastError = chrome.runtime.lastError; } catch (_) { lastError = null; }
          if (lastError) { reject(new Error(lastError.message || 'Collector 通信失败。')); return; }
          if (!isPlainObject(response)) { reject(protocolError()); return; }
          if (response.ok !== true) {
            var err = response && response.error;
            if (!isPlainObject(err) || typeof err.message !== 'string' || (err.code != null && typeof err.code !== 'string')) {
              reject(protocolError()); return;
            }
            var failure = new Error((err && err.message) || 'Collector 请求失败。');
            failure.code = err && err.code;
            failure.retriable = !!(err && err.retriable);
            reject(failure);
            return;
          }
          if (!isPlainObject(response.result)) { reject(protocolError()); return; }
          resolve(response.result);
        });
      } catch (error) { reject(error); }
    });
  }

  function roots() {
    var result = [document];
    var host = document.querySelector('.cf-host');
    if (host && host.shadowRoot) result.push(host.shadowRoot);
    return result;
  }

  function all(selector) {
    var found = [];
    roots().forEach(function (scope) {
      Array.prototype.forEach.call(scope.querySelectorAll(selector), function (node) { found.push(node); });
    });
    return found;
  }

  function updateControls() {
    state.controls = all('[data-sf-xchina-control]');
    state.controls.forEach(function (control) {
      var buttons = control.querySelectorAll('button');
      Array.prototype.forEach.call(buttons, function (button) { button.disabled = state.busy; });
      var status = control.querySelector('.sf-xchina-status');
      if (status) {
        if (status.textContent !== state.status) status.textContent = state.status;
        if (status.hidden !== !state.status) status.hidden = !state.status;
      }
      var action = control.querySelector('[data-sf-collector-next-action]');
      if (action) {
        var actionHidden = !state.nextAction;
        if (action.hidden !== actionHidden) action.hidden = actionHidden;
        if (action.disabled !== state.busy) action.disabled = state.busy;
        var actionLabel = state.nextAction ? state.nextAction.label : '';
        if (action.textContent !== actionLabel) action.textContent = actionLabel;
      }
      var ariaBusy = state.busy ? 'true' : 'false';
      if (control.getAttribute('aria-busy') !== ariaBusy) control.setAttribute('aria-busy', ariaBusy);
    });
  }

  function setState(busy, status) {
    state.busy = !!busy;
    state.status = status || '';
    updateControls();
  }

  function setNextAction(label, run) {
    state.nextAction = label && typeof run === 'function' ? { label: label, run: run } : null;
    updateControls();
  }

  function clearNextAction() {
    setNextAction('', null);
  }

  function mediaLabel(media) {
    if (media === 'image') return '仅图片';
    if (media === 'video') return '仅视频';
    return '自动选择全部媒体';
  }

  function dispositionLabel(value) {
    return ({
      created: '创建新任务',
      'reused-active': '复用活动任务',
      'confirm-redownload': '发现已完成任务，确认后重新下载',
      'recommend-retry': '建议重试失败任务',
      'recommend-resume': '建议恢复未完成任务'
    })[value] || (value ? String(value) : '尚未创建任务');
  }

  function expectedCollector(snapshot) {
    return snapshot.type === 'photo' ? 'xchina_gallery' : 'xchina_video';
  }

  function validNonnegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function validatePreview(data, snapshot, media) {
    if (!isPlainObject(data) || ['auto', 'image', 'video', null].indexOf(media) < 0) throw protocolError();
    var resolved = data.resolved;
    if (resolved != null && (!isPlainObject(resolved) || typeof resolved.collector !== 'string')) throw protocolError();
    var collector = typeof data.collector === 'string' ? data.collector : resolved && resolved.collector;
    if (collector !== expectedCollector(snapshot)) throw protocolError();
    var title = fieldValue(data, ['title', 'group', 'name', 'album_title'], null);
    if (typeof title !== 'string' || !title.trim()) throw protocolError();
    function count(keys) {
      var found = false, value = null;
      keys.some(function (key) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
        found = true; value = data[key]; return true;
      });
      if (!found || (value != null && !validNonnegativeInteger(value))) throw protocolError();
      return value;
    }
    count(['photos', 'image_count', 'images']);
    count(['videos', 'video_count']);
    if (typeof data.sampled !== 'boolean') throw protocolError();
    ['video_bytes', 'estimated_video_bytes', 'estimated_size'].forEach(function (key) {
      if (data[key] != null && !validNonnegativeInteger(data[key])) throw protocolError();
    });
    ['output_dir', 'download_dir', 'warning'].forEach(function (key) {
      if (data[key] != null && typeof data[key] !== 'string') throw protocolError();
    });
    if (data.warnings != null && (!Array.isArray(data.warnings) || data.warnings.some(function (item) { return typeof item !== 'string'; }))) throw protocolError();
    if (!Array.isArray(data.media) || !data.media.length || data.media.some(function (item) { return item !== 'image' && item !== 'video'; })) throw protocolError();
    if ((media === 'image' && (data.media.length !== 1 || data.media[0] !== 'image')) ||
      ((media === 'video' || snapshot.type === 'video') && (data.media.length !== 1 || data.media[0] !== 'video'))) throw protocolError();
    if (data.disposition != null && !DISPOSITIONS[data.disposition]) throw protocolError();
    return data;
  }

  function validateCreate(data, snapshot) {
    if (!isPlainObject(data) || !Number.isSafeInteger(data.task_id) || data.task_id <= 0 ||
      !DISPOSITIONS[data.disposition] || data.content_key !== snapshot.contentKey) throw protocolError();
    if (data.status != null && typeof data.status !== 'string') throw protocolError();
    if (data.disposition === 'confirm-redownload' && data.status !== 'success') throw protocolError();
    return data;
  }

  function snapshotPage() {
    if (!state.page) return null;
    return Object.freeze({
      url: state.page.url,
      contentKey: state.page.contentKey,
      type: state.page.kind,
      generation: state.generation
    });
  }

  function isCurrent(snapshot, token) {
    if (!snapshot || state.destroyed || snapshot.generation !== state.generation ||
      (token != null && token !== state.operationToken) || !state.page) return false;
    var live = parseUrl(root.location && root.location.href || '');
    return !!live && live.url === snapshot.url && live.contentKey === snapshot.contentKey && live.kind === snapshot.type &&
      state.page.url === snapshot.url && state.page.contentKey === snapshot.contentKey && state.page.kind === snapshot.type;
  }

  function beginOperation(snapshot, status) {
    if (!isCurrent(snapshot)) return null;
    var token = ++state.operationToken;
    clearNextAction();
    setState(true, status);
    return token;
  }

  function finishOperation(snapshot, token, status) {
    if (!isCurrent(snapshot, token)) return false;
    setState(false, status);
    return true;
  }

  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function bytesLabel(value) {
    var bytes = number(value, 0);
    if (!bytes) return '未知';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1).replace(/\.0$/, '') + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1).replace(/\.0$/, '') + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  function fieldValue(data, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      if (data[keys[i]] !== undefined && data[keys[i]] !== null && data[keys[i]] !== '') return data[keys[i]];
    }
    return fallback;
  }

  function taskStatusLabel(status) {
    return ({
      pending: '等待中', running: '处理中', extracting: '正在解析', downloading: '正在下载',
      paused: '已暂停', success: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消'
    })[status] || '状态未知';
  }

  function validateTask(task) {
    if (!isPlainObject(task) || !Number.isSafeInteger(task.id) || task.id <= 0 || !TASK_STATES[task.status]) throw protocolError();
    if (task.resource_counts != null) {
      if (!isPlainObject(task.resource_counts) || Object.keys(task.resource_counts).some(function (key) {
        return !validNonnegativeInteger(task.resource_counts[key]);
      })) throw protocolError();
    }
    return task;
  }

  function taskSummary(task) {
    validateTask(task);
    var text = '任务 #' + task.id + '：' + taskStatusLabel(task.status);
    var counts = task.resource_counts;
    if (counts) {
      var done = number(counts.done, 0);
      var total = validNonnegativeInteger(counts.total) ? counts.total : Object.keys(counts).reduce(function (sum, key) {
        return key === 'total' ? sum : sum + number(counts[key], 0);
      }, 0);
      if (total) text += ' · ' + done + '/' + total;
    }
    var progress = number(task.progress, -1);
    if (progress >= 0 && progress <= 100) text += ' · ' + Math.round(progress) + '%';
    return text;
  }

  function openExistingTask(taskId, label) {
    var snapshot = snapshotPage();
    setNextAction(label, function () {
      if (state.busy || !isCurrent(snapshot)) return;
      var token = beginOperation(snapshot, '正在打开 Collector 任务…');
      send({ type: 'sf_collector_open_task', task_id: taskId }).then(function () {
        finishOperation(snapshot, token, '已在 Collector 中打开任务 #' + taskId + '。');
      }).catch(function (error) { showFailure(error, snapshot, token, null); });
    });
  }

  function retryDetection(snapshot) {
    if (state.busy || !isCurrent(snapshot)) return;
    var token = beginOperation(snapshot, '正在重新检测 Collector…');
    send({ type: 'sf_collector_ping' }).then(function () {
      finishOperation(snapshot, token, 'Collector 连接正常，请重试下载。');
    }).catch(function (error) { showFailure(error, snapshot, token, function () { retryDetection(snapshot); }); });
  }

  function startLogin(snapshot) {
    if (state.busy || !isCurrent(snapshot)) return;
    var token = beginOperation(snapshot, '正在启动 Collector 登录窗口…');
    send({ type: 'sf_collector_start_login', url: snapshot.url }).then(function () {
      finishOperation(snapshot, token, '登录窗口已启动；完成登录后请重试下载。');
    }).catch(function (error) { showFailure(error, snapshot, token, function () { startLogin(snapshot); }); });
  }

  function showFailure(error, snapshot, token, retry) {
    if (!isCurrent(snapshot, token)) return false;
    var code = error && error.code || 'collector-error';
    var message = 'Collector 请求失败，请重试。';
    var label = '重试';
    var action = retry || function () { retryDetection(snapshot); };
    if (code === 'native-host-missing') {
      message = '未安装 SiteFilter 本机桥接。请在 Collector 项目中运行 integrations\\sitefilter-native-host\\install-native-host.ps1，然后重新检测。';
      label = '重新检测'; action = function () { retryDetection(snapshot); };
    } else if (code === 'incompatible-protocol' || code === 'unsupported-version' || code === 'installation-invalid') {
      message = '本机桥接版本或配置无效，请重新运行 install-native-host.ps1。';
      label = '重新检测'; action = function () { retryDetection(snapshot); };
    } else if (code === 'wsl-unavailable') {
      message = '无法启动 WSL，请确认 WSL 可用后重新检测。';
      label = '重新检测'; action = function () { retryDetection(snapshot); };
    } else if (code === 'collector-startup-failed' || code === 'collector-unavailable' || code === 'native-host-disconnected' || code === 'native-timeout') {
      message = 'Collector 暂时不可用，请重试。';
    } else if (code === 'login-required') {
      message = 'Collector 需要你完成 XChina 登录。';
      label = '启动登录'; action = function () { startLogin(snapshot); };
    } else if (code === 'collector-request-failed') {
      message = 'Collector 未能完成请求，请重试。';
    } else if (code === 'invalid-collector-response') {
      message = 'Collector 协议响应无效，请重试。';
    }
    finishOperation(snapshot, token, message);
    setNextAction(label, action);
    return true;
  }

  function pollDelay() {
    var configured = Number(root.__SF_XCHINA_POLL_MS);
    return Number.isSafeInteger(configured) && configured >= 1 && configured <= 60000 ? configured : 1500;
  }

  function clearTaskPolling() {
    state.taskPollToken++;
    state.taskPollInFlight = false;
    if (state.taskPollTimer != null) root.clearTimeout(state.taskPollTimer);
    state.taskPollTimer = null;
  }

  function applyPolledTask(snapshot, token, task) {
    if (token !== state.taskPollToken || !isCurrent(snapshot)) return false;
    validateTask(task);
    setState(false, taskSummary(task));
    if (!TERMINAL_TASK_STATES[task.status]) {
      if (task.status === 'paused') openExistingTask(task.id, '查看并恢复');
      return true;
    }
    clearTaskPolling();
    if (task.status === 'partial' || task.status === 'failed' || task.status === 'cancelled') {
      openExistingTask(task.id, '查看并重试');
    }
    return false;
  }

  function startTaskPolling(snapshot, taskId, immediate) {
    if (!Number.isSafeInteger(taskId) || taskId <= 0 || !isCurrent(snapshot)) return;
    clearTaskPolling();
    clearNextAction();
    var token = state.taskPollToken;
    function schedule(delay) {
      if (token !== state.taskPollToken || !isCurrent(snapshot) || state.taskPollTimer != null) return;
      state.taskPollTimer = root.setTimeout(run, delay);
    }
    function run() {
      state.taskPollTimer = null;
      if (token !== state.taskPollToken || !isCurrent(snapshot)) return;
      if (state.busy) { schedule(pollDelay()); return; }
      if (state.taskPollInFlight) return;
      state.taskPollInFlight = true;
      var requestOperationToken = state.operationToken;
      send({ type: 'sf_collector_get_task', task_id: taskId }).then(function (task) {
        if (token !== state.taskPollToken || !isCurrent(snapshot)) return;
        state.taskPollInFlight = false;
        if (requestOperationToken !== state.operationToken || state.busy) {
          schedule(pollDelay());
          return;
        }
        if (applyPolledTask(snapshot, token, task)) schedule(pollDelay());
      }).catch(function (error) {
        if (token !== state.taskPollToken || !isCurrent(snapshot)) return;
        state.taskPollInFlight = false;
        if (requestOperationToken !== state.operationToken || state.busy) {
          schedule(pollDelay());
          return;
        }
        clearTaskPolling();
        showFailure(error, snapshot, state.operationToken, function () { startTaskPolling(snapshot, taskId, true); });
      });
    }
    schedule(immediate ? 0 : pollDelay());
  }

  function restorePage(snapshot) {
    var restoreToken = state.operationToken;
    send({ type: 'sf_collector_restore', content_key: snapshot.contentKey }).then(function (result) {
      if (!isCurrent(snapshot) || state.busy || state.operationToken !== restoreToken) return;
      if (!isPlainObject(result) || typeof result.found !== 'boolean') throw protocolError();
      if (!result.found) return;
      var task = validateTask(result.task);
      setState(false, taskSummary(task));
      if (!TERMINAL_TASK_STATES[task.status]) {
        startTaskPolling(snapshot, task.id, false);
        if (task.status === 'paused') openExistingTask(task.id, '查看并恢复');
      } else if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'partial') {
        openExistingTask(task.id, '查看并重试');
      }
    }).catch(function (error) {
      if (!isCurrent(snapshot) || state.busy || state.operationToken !== restoreToken) return;
      var token = ++state.operationToken;
      showFailure(error, snapshot, token, function () { restorePage(snapshot); });
    });
  }

  function closeModal(restoreFocus) {
    if (!state.modal) return;
    var opener = state.modal._opener;
    if (state.modalKeydown) document.removeEventListener('keydown', state.modalKeydown, true);
    state.modalKeydown = null;
    state.modal.remove();
    state.modal = null;
    if (restoreFocus && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }

  function addRow(list, label, value, className) {
    var row = document.createElement('div');
    row.className = 'sf-xchina-preview-row' + (className ? ' ' + className : '');
    var term = document.createElement('dt'); term.textContent = label;
    var detail = document.createElement('dd'); detail.textContent = String(value);
    row.appendChild(term); row.appendChild(detail); list.appendChild(row);
  }

  function showPreview(data, media, opener, snapshot) {
    if (!isCurrent(snapshot)) return;
    closeModal(false);
    var overlay = document.createElement('div');
    overlay.className = 'sf-xchina-modal';
    overlay.dataset.sfXchina = 'modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sf-xchina-modal-title');
    overlay._opener = opener;
    overlay._snapshot = snapshot;
    overlay._media = media;
    overlay._forceNew = false;
    var card = document.createElement('section'); card.className = 'sf-xchina-modal-card';
    var title = document.createElement('h2'); title.id = 'sf-xchina-modal-title'; title.textContent = '确认交给 Collector';
    var list = document.createElement('dl'); list.className = 'sf-xchina-preview-list';
    var resolved = data.resolved && typeof data.resolved === 'object' ? data.resolved : {};
    addRow(list, '标题', fieldValue(data, ['title', 'group', 'name', 'album_title'], document.title || '未提供'));
    addRow(list, '采集器', fieldValue(data, ['collector'], resolved.collector || '自动识别'));
    addRow(list, '类型', state.page.kind === 'photo' ? 'XChina 相册' : 'XChina 视频');
    addRow(list, '图片', number(fieldValue(data, ['photos', 'image_count', 'images'], 0), 0));
    addRow(list, '视频', number(fieldValue(data, ['videos', 'video_count'], state.page.kind === 'video' ? 1 : 0), 0));
    addRow(list, '预计视频体积', bytesLabel(fieldValue(data, ['video_bytes', 'estimated_video_bytes', 'estimated_size'], 0)));
    addRow(list, '输出目录', '使用 Collector 当前设置');
    addRow(list, '媒体策略', mediaLabel(media));
    addRow(list, '计数状态', data.sampled ? '抽样/估算' : '完整预览');
    addRow(list, '复用状态', dispositionLabel(data.disposition));
    var warning = fieldValue(data, ['warning'], Array.isArray(data.warnings) ? data.warnings.join('；') : '无');
    addRow(list, 'Collector 警告', warning || '无', warning && warning !== '无' ? 'sf-xchina-warning' : '');
    var actions = document.createElement('div'); actions.className = 'sf-xchina-modal-actions';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.dataset.action = 'cancel'; cancel.textContent = '取消';
    var confirm = document.createElement('button'); confirm.type = 'button'; confirm.dataset.action = 'confirm'; confirm.className = 'sf-xchina-confirm'; confirm.textContent = '确认创建任务';
    actions.appendChild(cancel); actions.appendChild(confirm);
    card.appendChild(title); card.appendChild(list); card.appendChild(actions); overlay.appendChild(card);
    document.documentElement.appendChild(overlay); state.modal = overlay;

    cancel.addEventListener('click', function () { closeModal(true); });
    overlay.addEventListener('mousedown', function (event) { if (event.target === overlay) closeModal(true); });
    confirm.addEventListener('click', function () {
      var bound = overlay._snapshot;
      if (state.busy || !isCurrent(bound)) return;
      var token = beginOperation(bound, '正在创建 Collector 任务…');
      if (token == null) return;
      confirm.disabled = true; cancel.disabled = true;
      var message = { type: 'sf_collector_create', url: bound.url, force_new: overlay._forceNew === true };
      if (overlay._media != null) message.media = overlay._media;
      send(message).then(function (result) {
        if (!isCurrent(bound, token)) return;
        try { validateCreate(result, bound); } catch (error) {
          finishOperation(bound, token, error.message);
          confirm.disabled = false; cancel.disabled = false;
          return;
        }
        var disposition = dispositionLabel(result.disposition);
        if (result.disposition === 'confirm-redownload' && overlay._forceNew !== true) {
          if (!finishOperation(bound, token, '任务 #' + result.task_id + ' 已完成。如需增量重新下载，请再确认一次。')) return;
          overlay._forceNew = true;
          confirm.textContent = '确认重新下载';
          confirm.disabled = false; cancel.disabled = false;
          return;
        }
        if (!finishOperation(bound, token, '任务 #' + result.task_id + '：' + disposition)) return;
        if (result.disposition === 'recommend-retry') {
          closeModal(true);
          openExistingTask(result.task_id, '查看并重试');
          setState(false, '任务 #' + result.task_id + ' 未完成，建议重试原任务。');
          return;
        }
        if (result.disposition === 'recommend-resume') {
          closeModal(true);
          startTaskPolling(bound, result.task_id, false);
          openExistingTask(result.task_id, '查看并恢复');
          setState(false, '任务 #' + result.task_id + ' 已暂停，建议恢复原任务。');
          return;
        }
        closeModal(true);
        if (TASK_STATES[result.status] && !TERMINAL_TASK_STATES[result.status]) startTaskPolling(bound, result.task_id, true);
      }).catch(function (error) {
        if (!isCurrent(bound, token)) return;
        showFailure(error, bound, token, function () { preview(overlay._media, overlay._opener); });
        closeModal(true);
      });
    });

    state.modalKeydown = function (event) {
      if (!state.modal) return;
      if (event.key === 'Escape') { event.preventDefault(); closeModal(true); return; }
      if (event.key !== 'Tab') return;
      var focusable = Array.prototype.filter.call(state.modal.querySelectorAll('button:not([disabled])'), function (node) { return !node.hidden; });
      if (!focusable.length) { event.preventDefault(); return; }
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (!state.modal.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', state.modalKeydown, true);
    confirm.focus();
  }

  function preview(media, opener) {
    if (state.busy || !state.page) return;
    var snapshot = snapshotPage();
    var token = beginOperation(snapshot, '正在启动 Collector 并预览…');
    if (token == null) return;
    var message = { type: 'sf_collector_preview', url: snapshot.url };
    if (media != null) message.media = media;
    send(message).then(function (result) {
      if (!isCurrent(snapshot, token)) return;
      try { validatePreview(result, snapshot, media); } catch (error) {
        finishOperation(snapshot, token, error.message);
        return;
      }
      if (!finishOperation(snapshot, token, '预览已就绪')) return;
      if (!isCurrent(snapshot)) return;
      showPreview(result, media, opener, snapshot);
    }).catch(function (error) {
      showFailure(error, snapshot, token, function () { preview(media, opener); });
    });
  }

  function buildControl(locationName) {
    var wrap = document.createElement('div');
    wrap.className = 'sf-xchina-controls';
    wrap.dataset.sfXchina = locationName;
    wrap.dataset.sfXchinaControl = 'true';
    var row = document.createElement('div'); row.className = 'sf-xchina-control-row';
    var primary = document.createElement('button');
    primary.type = 'button'; primary.className = 'sf-xchina-primary'; primary.textContent = '交给 Collector 下载';
    primary.addEventListener('click', function () { preview(state.page.kind === 'photo' ? 'auto' : null, primary); });
    var menuButton = document.createElement('button');
    menuButton.type = 'button'; menuButton.className = 'sf-xchina-menu-toggle'; menuButton.textContent = '▾';
    menuButton.setAttribute('aria-label', 'Collector 下载选项'); menuButton.setAttribute('aria-expanded', 'false');
    var menu = document.createElement('div'); menu.className = 'sf-xchina-menu'; menu.hidden = true;
    function choice(label, media) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      if (media) button.dataset.media = media;
      button.addEventListener('click', function () { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); preview(media, button); });
      menu.appendChild(button);
    }
    choice('预览默认策略', state.page.kind === 'photo' ? 'auto' : null);
    if (state.page.kind === 'photo') { choice('仅下载图片', 'image'); choice('仅下载视频', 'video'); }
    else choice('仅下载视频', 'video');
    menuButton.addEventListener('click', function () {
      menu.hidden = !menu.hidden;
      menuButton.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    });
    row.appendChild(primary); row.appendChild(menuButton); wrap.appendChild(row); wrap.appendChild(menu);
    var status = document.createElement('div'); status.className = 'sf-xchina-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
    wrap.appendChild(status);
    var nextAction = document.createElement('button');
    nextAction.type = 'button'; nextAction.className = 'sf-xchina-next-action'; nextAction.dataset.sfCollectorNextAction = 'true'; nextAction.hidden = true;
    nextAction.addEventListener('click', function () {
      var action = state.nextAction;
      if (!action || state.busy) return;
      action.run();
    });
    wrap.appendChild(nextAction);
    return wrap;
  }

  function ensureControls() {
    if (!state.page) return;
    var heading = document.querySelector('h1');
    var titleControl = document.querySelector('[data-sf-xchina="title"]');
    if (heading && !titleControl) heading.insertAdjacentElement('afterend', buildControl('title'));
    var host = document.querySelector('.cf-host');
    var slot = host && host.shadowRoot && host.shadowRoot.getElementById('collectorSlot');
    if (!slot && host && host.shadowRoot) {
      var panel = host.shadowRoot.getElementById('panel');
      if (panel) {
        slot = document.createElement('div');
        slot.id = 'collectorSlot'; slot.className = 'cf-xchina-panel-slot'; slot.dataset.sfXchina = 'slot';
        var stats = host.shadowRoot.getElementById('stats');
        if (stats && stats.parentNode === panel) stats.insertAdjacentElement('afterend', slot);
        else panel.insertBefore(slot, panel.firstChild);
      }
    }
    if (slot && !slot.querySelector('[data-sf-xchina="panel"]')) slot.appendChild(buildControl('panel'));
    updateControls();
  }

  function removeControls() {
    state.operationToken++;
    clearTaskPolling();
    closeModal(false);
    all('[data-sf-xchina]').forEach(function (node) { node.remove(); });
    state.controls = [];
    state.busy = false;
    state.status = '';
    state.nextAction = null;
  }

  function reconcile() {
    var next = parseUrl(root.location && root.location.href || '');
    var changed = !state.page || !next || state.page.contentKey !== next.contentKey || state.page.url !== next.url;
    if (!next) {
      if (state.page || all('[data-sf-xchina]').length) removeControls();
      state.page = null; state.lastUrl = root.location && root.location.href || '';
      return null;
    }
    if (changed) {
      if (state.page) removeControls();
      state.generation++;
    }
    state.page = next; state.lastUrl = root.location.href;
    ensureControls();
    if (changed) restorePage(snapshotPage());
    return next;
  }

  function init() {
    if (state.observer || state.interval) return reconcile();
    state.destroyed = false;
    reconcile();
    state.observer = new MutationObserver(function () { if (!state.destroyed) ensureControls(); });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    state.interval = setInterval(function () { if (root.location.href !== state.lastUrl) reconcile(); }, 500);
    listen(root, 'popstate', reconcile);
    listen(root, 'hashchange', reconcile);
    return state.page;
  }

  function destroy() {
    state.destroyed = true;
    if (state.observer) state.observer.disconnect();
    if (state.interval) clearInterval(state.interval);
    state.observer = null; state.interval = null;
    while (state.listeners.length) state.listeners.pop()();
    removeControls(); state.page = null; state.generation++;
  }

  root.SiteFilterXChinaDownload = Object.freeze({
    parseUrl: parseUrl,
    init: init,
    destroy: destroy,
    reconcile: reconcile,
    current: function () { return state.page; }
  });

  if (!root.__SF_XCHINA_DISABLE_AUTO) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
