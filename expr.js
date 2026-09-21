/* =============================================================
 * SiteFilter —— 条件表达式引擎（content script 与设置页共用一份）
 *
 * 为什么单独一个文件：设置页的「表达式测试器」必须和页面上真正跑的
 * 引擎是同一份实现，否则测试器通过 ≠ 规则生效，等于没有测试器。
 *
 * 语法：
 *   expr  := term (('||' | 'OR' | '或') term)*
 *   term  := factor (('&&' | 'AND' | '且') factor)*
 *   factor:= ('!' | 'NOT' | '非') factor | '(' expr ')' | atom
 *   atom  := FIELD OP VALUE          （省略 FIELD 时等价于 all ~ VALUE）
 *   FIELD := title | actress | tag | maker | series | director | code | all | rating | date
 *   OP    := ~ 包含 | =~ 正则 | !~ 正则不匹配 | = / == 等于 | != 不等于 | > >= < <=
 *
 * 例：
 *   rating >= 4 && date >= 2023-01-01
 *   title =~ /^(SSIS|STARS)-\d+/ && !(tag ~ 巨乳)
 *   (code =~ /^ABC-/ || maker ~ S1) && rating >= 4.5
 *   丝袜 || 高跟
 *
 * 两个易踩的点：
 *   1. 值里含空格 / 括号 / 竖线时用引号包住，例如 title ~ "高清 中文字幕"；
 *      正则既可以写 /.../flags 字面量，也可以用引号包住 —— 含 | 时推荐用字面量。
 *   2. 缺数据的卡片（没评分 / 没日期）参与数值比较一律不命中 —— 与简单模式一致。
 * ============================================================= */
'use strict';

var SF_EXPR = (function () {
  var CACHE = new Map();
  var CACHE_MAX = 300;
  var FIELDS = {
    title: 1, actress: 1, tag: 1, maker: 1, series: 1, director: 1,
    code: 1, all: 1, rating: 1, date: 1
  };

  var _log = null;
  function setLogger(fn) { _log = (typeof fn === 'function') ? fn : null; }
  function report(msg) { try { if (_log) _log(new Error(msg)); } catch (e) { } }

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ---------------- 词法 ---------------- */
  function tokens(src) {
    var s = String(src || '');
    var out = [], i = 0;
    function stop(ch) { return /[\s()!&|=<>~]/.test(ch); }
    function bare(from) {
      var j = from, b = '';
      while (j < s.length && !stop(s[j])) { b += s[j]; j++; }
      return { v: b, end: j };
    }
    while (i < s.length) {
      var ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(') { out.push({ k: 'lp' }); i++; continue; }
      if (ch === ')') { out.push({ k: 'rp' }); i++; continue; }

      // 引号串：值里含空格 / 括号 / 竖线时用
      if (ch === '"' || ch === "'") {
        var q = ch, j1 = i + 1, b1 = '';
        while (j1 < s.length && s[j1] !== q) {
          if (s[j1] === '\\' && j1 + 1 < s.length) { b1 += s[j1 + 1]; j1 += 2; continue; }
          b1 += s[j1]; j1++;
        }
        out.push({ k: 'val', v: b1 }); i = j1 + 1; continue;
      }

      // 正则字面量 /.../flags；未闭合就当普通文本（例如日期 2024/06/01）
      if (ch === '/') {
        var j2 = i + 1, b2 = '', closed = false;
        while (j2 < s.length) {
          if (s[j2] === '\\') {
            b2 += s[j2];
            if (j2 + 1 < s.length) { b2 += s[j2 + 1]; j2 += 2; } else { j2++; }
            continue;
          }
          if (s[j2] === '/') { closed = true; break; }
          b2 += s[j2]; j2++;
        }
        if (closed) {
          var fl = ''; j2++;
          while (j2 < s.length && /[gimsuy]/.test(s[j2])) { fl += s[j2]; j2++; }
          out.push({ k: 'val', v: b2, rx: true, f: fl }); i = j2; continue;
        }
        var br = bare(i + 1);
        out.push({ k: 'val', v: '/' + br.v }); i = br.end; continue;
      }

      if (ch === '!') {
        if (s[i + 1] === '~') { out.push({ k: 'op', v: '!~' }); i += 2; }
        else if (s[i + 1] === '=') { out.push({ k: 'op', v: '!=' }); i += 2; }
        else { out.push({ k: 'not' }); i++; }
        continue;
      }
      if (ch === '&' || ch === '|') {
        out.push({ k: 'op2', v: ch + ch });
        i += (s[i + 1] === ch) ? 2 : 1;
        continue;
      }
      if (ch === '~') { out.push({ k: 'op', v: '~' }); i++; continue; }
      if (ch === '=' || ch === '>' || ch === '<') {
        var op = ch; i++;
        if (s[i] === '=') { op += '='; i++; }
        else if (ch === '=' && s[i] === '~') { op = '=~'; i++; }
        out.push({ k: 'op', v: op });
        continue;
      }
      var b3 = bare(i);
      if (!b3.v) { i++; continue; }   // 兜底：任何没被识别的字符都跳过，绝不死循环
      out.push({ k: 'val', v: b3.v }); i = b3.end;
    }
    return out;
  }

  /* ---------------- 语法 ---------------- */
  function parse(toks) {
    var p = 0;
    function peek() { return toks[p]; }
    function next() { return toks[p++]; }
    function isOr(t) { return !!(t && ((t.k === 'op2' && t.v === '||') || (t.k === 'val' && /^(or|或)$/i.test(t.v)))); }
    function isAnd(t) { return !!(t && ((t.k === 'op2' && t.v === '&&') || (t.k === 'val' && /^(and|且)$/i.test(t.v)))); }
    function isNot(t) { return !!(t && (t.k === 'not' || (t.k === 'val' && /^(not|非)$/i.test(t.v)))); }

    function mkNode(field, op, valTok) {
      var f = String(field).toLowerCase();
      if (!FIELDS[f]) throw new Error('未知字段：' + field + '（可用：title/actress/tag/maker/series/director/code/all/rating/date）');
      if ((f === 'rating' || f === 'date') && ['~', '=~', '!~', '=', '!='].indexOf(op) !== -1) {
        throw new Error(f + ' 只支持 > >= < <= 比较');
      }
      if (['>', '>=', '<', '<='].indexOf(op) !== -1 && f !== 'rating' && f !== 'date') {
        throw new Error('数值比较只能用在 rating / date 上');
      }
      var n = { t: 'cmp', f: f, op: op, v: valTok && valTok.v };
      if (op === '=~' || op === '!~') {
        var flags = String((valTok && valTok.f) || '').replace(/[gy]/g, '');
        if (flags.indexOf('i') === -1) flags += 'i';
        n.re = new RegExp(String(n.v), flags);   // 正则写错在这里就抛，交给 compile 兜底
      }
      return n;
    }
    function atom() {
      var a = next();
      if (!a || a.k !== 'val') throw new Error('这里需要字段名或值');
      var nx = peek();
      if (nx && nx.k === 'op') {
        next();
        var v = next();
        if (!v || v.k !== 'val') throw new Error('运算符 ' + nx.v + ' 后面缺值');
        return mkNode(a.v, nx.v, v);
      }
      return mkNode('all', a.rx ? '=~' : '~', a);   // 裸词 → all ~ 值
    }
    function factor() {
      var t = peek();
      if (!t) throw new Error('表达式意外结束');
      if (isNot(t)) { next(); return { t: 'not', x: factor() }; }
      if (t.k === 'lp') {
        next();
        var e = expr();
        var c = peek();
        if (!c || c.k !== 'rp') throw new Error('缺少右括号');
        next();
        return e;
      }
      return atom();
    }
    function term() {
      var left = factor();
      while (isAnd(peek())) { next(); left = { t: 'and', l: left, r: factor() }; }
      return left;
    }
    function expr() {
      var left = term();
      while (isOr(peek())) { next(); left = { t: 'or', l: left, r: term() }; }
      return left;
    }

    if (!toks.length) throw new Error('表达式为空');
    var ast = expr();
    if (p < toks.length) throw new Error('末尾有多余内容：' + String(toks[p].v || ''));
    return ast;
  }

  /* ---------------- 编译（带缓存） ---------------- */
  function compile(src) {
    var key = String(src == null ? '' : src).trim();
    if (!key) return null;
    if (CACHE.has(key)) return CACHE.get(key);
    var entry;
    try { entry = { ast: parse(tokens(key)) }; }
    catch (e) {
      var msg = String((e && e.message) || e);
      entry = { ast: null, err: msg };
      report('条件表达式「' + key.slice(0, 60) + '」' + msg);
    }
    if (CACHE.size > CACHE_MAX) CACHE.clear();
    CACHE.set(key, entry);
    return entry;
  }

  /* ---------------- 求值 ---------------- */
  // 日期补全：只写「2024」或「2024-06」也能比。缺的位按方向补：
  //   作「下限」时补 0（2024 → 2024-00-00），作「上限」时补满（2024 → 2024-12-31）。
  // 哪个运算符取哪个方向，取决于怎样才符合直觉：
  //   >  下限（不含）→ 补满，于是 `date > 2023` 不会把 2023 年内算进来
  //   >= 下限（含）  → 补 0，于是 `date >= 2023` 包含整年
  //   <  上限（不含）→ 补 0，于是 `date < 2024-06` 不含 6 月
  //   <= 上限（含）  → 补满，于是 `date <= 2024` 包含整年
  function padDir(op) { return (op === '>' || op === '<=') ? 'hi' : 'low'; }

  function padDate(v, dir) {
    var hi = (dir === 'hi' || dir === true);
    var s = String(v == null ? '' : v).trim().replace(/[./]/g, '-');
    var m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    if (!m) return '';
    var mo = m[2] ? ('0' + m[2]).slice(-2) : (hi ? '12' : '00');
    var dy = m[3] ? ('0' + m[3]).slice(-2) : (hi ? '31' : '00');
    return m[1] + '-' + mo + '-' + dy;
  }

  function fieldText(ctx, f) {
    if (f === 'rating') return ctx ? ctx.rating : null;
    if (f === 'date') return ctx ? ctx.date : null;
    var v = ctx ? ctx[f] : '';
    return v == null ? '' : String(v);
  }

  function eql(hay, needle) {
    if (hay === needle) return true;
    return new RegExp('(^|[|\\s,，、])' + escRe(needle) + '([|\\s,，、]|$)', 'i').test(hay);
  }

  function evalNode(n, ctx) {
    if (!n) return false;
    if (n.t === 'or') return evalNode(n.l, ctx) || evalNode(n.r, ctx);
    if (n.t === 'and') return evalNode(n.l, ctx) && evalNode(n.r, ctx);
    if (n.t === 'not') return !evalNode(n.x, ctx);

    var f = n.f, op = n.op;
    var raw = fieldText(ctx, f);

    if (op === '=~' || op === '!~') {
      var hit = false;
      try { n.re.lastIndex = 0; hit = n.re.test(String(raw == null ? '' : raw)); } catch (e) { hit = false; }
      return (op === '=~') ? hit : !hit;
    }

    if (f === 'rating' || f === 'date') {
      if (raw === '' || raw == null) return false;   // 卡片没这项数据 → 不命中
      var a, b;
      if (f === 'rating') {
        a = Number(raw); b = Number(n.v);
        if (isNaN(a) || isNaN(b)) return false;
      } else {
        a = padDate(raw, padDir(op)); b = padDate(n.v, padDir(op));
        if (!a || !b) return false;
      }
      if (op === '>') return a > b;
      if (op === '>=') return a >= b;
      if (op === '<') return a < b;
      if (op === '<=') return a <= b;
      return false;
    }

    var hay = String(raw == null ? '' : raw).toLowerCase();
    var needle = String(n.v == null ? '' : n.v).toLowerCase();
    if (op === '=' || op === '!=') {
      var eq = eql(hay, needle);
      return (op === '=') ? eq : !eq;
    }
    return hay.indexOf(needle) !== -1;   // '~'
  }

  /* ---------------- 对外接口 ---------------- */
  function test(src, ctx) {
    var e = compile(src);
    if (!e || !e.ast) return false;
    try { return !!evalNode(e.ast, ctx); } catch (er) { return false; }
  }

  function check(src) {
    var e = compile(src);
    if (!e) return { ok: false, err: '表达式为空' };
    if (!e.ast) return { ok: false, err: e.err || '解析失败' };
    return { ok: true, err: '' };
  }

  // 调试用：把一个对象当成卡片上下文来试表达式
  function probe(src, ctx) {
    var c = check(src);
    if (!c.ok) return { ok: false, err: c.err, hit: false };
    return { ok: true, err: '', hit: test(src, ctx) };
  }

  return {
    FIELDS: FIELDS,
    compile: compile,
    test: test,
    check: check,
    probe: probe,
    padDate: padDate,
    setLogger: setLogger
  };
})();

// 兼容 CommonJS（Node 测试里可以 require 进来单测引擎本身）
if (typeof module !== 'undefined' && module.exports) { module.exports = SF_EXPR; }

/* 显式挂到全局。
   必要性：本文件顶部有 'use strict'，而严格模式下的 eval 代码有自己的作用域 ——
   `var SF_EXPR` 不会泄漏到全局，content.js 就看不到它了（jsdom 测试与某些
   打包/注入方式都会踩到）。所以这里手动挂一次，两边都稳。 */
try { if (typeof globalThis !== 'undefined') globalThis.SF_EXPR = SF_EXPR; } catch (e) { }
