/* XChina detail-page controls. Collector remains the sole media/task owner. */
'use strict';

(function (root) {
  var state = {
    page: null,
    busy: false,
    status: '',
    controls: [],
    modal: null,
    modalKeydown: null,
    observer: null,
    interval: null,
    listeners: [],
    lastUrl: '',
    destroyed: false
  };

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
          if (!response || response.ok !== true) {
            var err = response && response.error;
            var failure = new Error((err && err.message) || 'Collector 请求失败。');
            failure.code = err && err.code;
            failure.retriable = !!(err && err.retriable);
            reject(failure);
            return;
          }
          resolve(response.result || {});
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
      var ariaBusy = state.busy ? 'true' : 'false';
      if (control.getAttribute('aria-busy') !== ariaBusy) control.setAttribute('aria-busy', ariaBusy);
    });
  }

  function setState(busy, status) {
    state.busy = !!busy;
    state.status = status || '';
    updateControls();
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

  function showPreview(data, media, opener) {
    closeModal(false);
    var overlay = document.createElement('div');
    overlay.className = 'sf-xchina-modal';
    overlay.dataset.sfXchina = 'modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sf-xchina-modal-title');
    overlay._opener = opener;
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
    addRow(list, '输出目录', fieldValue(data, ['output_dir', 'download_dir'], '使用 Collector 当前设置'));
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
      if (state.busy) return;
      setState(true, '正在创建 Collector 任务…');
      confirm.disabled = true; cancel.disabled = true;
      var message = { type: 'sf_collector_create', url: state.page.url, force_new: false };
      if (media != null) message.media = media;
      send(message).then(function (result) {
        var disposition = dispositionLabel(result.disposition);
        setState(false, '任务 #' + (result.task_id || '—') + '：' + disposition);
        closeModal(true);
      }).catch(function (error) {
        setState(false, error.message || 'Collector 任务创建失败。');
        confirm.disabled = false; cancel.disabled = false;
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
    setState(true, '正在启动 Collector 并预览…');
    var message = { type: 'sf_collector_preview', url: state.page.url };
    if (media != null) message.media = media;
    send(message).then(function (result) {
      setState(false, '预览已就绪');
      showPreview(result, media, opener);
    }).catch(function (error) { setState(false, error.message || 'Collector 预览失败。'); });
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
    if (state.page.kind === 'photo') choice('仅下载图片', 'image');
    else choice('仅下载视频', 'video');
    menuButton.addEventListener('click', function () {
      menu.hidden = !menu.hidden;
      menuButton.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    });
    row.appendChild(primary); row.appendChild(menuButton); wrap.appendChild(row); wrap.appendChild(menu);
    var status = document.createElement('div'); status.className = 'sf-xchina-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
    wrap.appendChild(status);
    return wrap;
  }

  function ensureControls() {
    if (!state.page) return;
    var heading = document.querySelector('h1');
    var titleControl = document.querySelector('[data-sf-xchina="title"]');
    if (heading && !titleControl) heading.insertAdjacentElement('afterend', buildControl('title'));
    var host = document.querySelector('.cf-host');
    var slot = host && host.shadowRoot && host.shadowRoot.getElementById('collectorSlot');
    if (slot && !slot.querySelector('[data-sf-xchina="panel"]')) slot.appendChild(buildControl('panel'));
    updateControls();
  }

  function removeControls() {
    closeModal(false);
    all('[data-sf-xchina]').forEach(function (node) { node.remove(); });
    state.controls = [];
    state.busy = false;
    state.status = '';
  }

  function reconcile() {
    var next = parseUrl(root.location && root.location.href || '');
    var changed = !state.page || !next || state.page.contentKey !== next.contentKey || state.page.url !== next.url;
    if (!next) {
      if (state.page || all('[data-sf-xchina]').length) removeControls();
      state.page = null; state.lastUrl = root.location && root.location.href || '';
      return null;
    }
    if (changed && state.page) removeControls();
    state.page = next; state.lastUrl = root.location.href;
    ensureControls();
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
    removeControls(); state.page = null;
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
