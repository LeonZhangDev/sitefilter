'use strict';
var DATA_KEY = 'sf_data_v1';

function globToRegex(pattern) {
  var re = String(pattern).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + re + '$', 'i');
}

function get() {
  return new Promise(function (res) {
    chrome.storage.local.get(DATA_KEY, function (o) { res(o[DATA_KEY] || {}); });
  });
}
function set(d) {
  var p = {}; p[DATA_KEY] = d;
  return new Promise(function (res) { chrome.storage.local.set(p, res); });
}

document.addEventListener('DOMContentLoaded', function () {
  var urlEl = document.getElementById('url');
  var stateEl = document.getElementById('state');

  get().then(function (d) {
    d.settings = d.settings || {};
    d.sites = d.sites || [];
    d.rules = d.rules || [];

    // 开关
    document.querySelectorAll('.tg').forEach(function (el) {
      var k = el.dataset.k;
      var cb = el.querySelector('input');
      cb.checked = d.settings[k] !== false && !!d.settings[k];
      el.classList.toggle('on', cb.checked);
      el.addEventListener('click', function () {
        cb.checked = !cb.checked;
        el.classList.toggle('on', cb.checked);
        d.settings[k] = cb.checked;
        set(d);
      });
    });

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var url = (tabs && tabs[0] && tabs[0].url) || '';
      urlEl.textContent = url || '（无法读取）';
      if (!url) { stateEl.textContent = ''; return; }

      var hit = null;
      for (var i = 0; i < d.sites.length; i++) {
        try { if (d.sites[i].enabled && globToRegex(d.sites[i].pattern).test(url)) { hit = d.sites[i]; break; } } catch (e) { }
      }
      if (hit) {
        stateEl.textContent = '✓ 已监管 · ' + (hit.note || hit.pattern);
        stateEl.className = 's ok';
        document.getElementById('addSite').textContent = '已在监管列表中（点击移除）';
      } else {
        stateEl.textContent = '✕ 未纳入监管，扩展不生效';
        stateEl.className = 's no';
      }
      document.getElementById('addSite').dataset.has = hit ? '1' : '0';
    });
  });

  document.getElementById('addSite').addEventListener('click', function () {
    var btn = this;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var url = (tabs && tabs[0] && tabs[0].url) || '';
      if (!url || !/^https?:/i.test(url)) return;
      var u = new URL(url);
      var pattern = '*://*.' + u.hostname + '/*';
      get().then(function (d) {
        d.sites = d.sites || [];
        if (btn.dataset.has === '1') {
          d.sites = d.sites.filter(function (s) {
            try { return !globToRegex(s.pattern).test(url); } catch (e) { return true; }
          });
        } else {
          d.sites.push({
            id: 's_' + Date.now().toString(36),
            pattern: pattern,
            enabled: true,
            selector: '',
            note: u.hostname
          });
        }
        return set(d);
      }).then(function () { window.close(); });
    });
  });

  document.getElementById('opt').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });
});
