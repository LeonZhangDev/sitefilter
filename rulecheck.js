/* 规则体检 / 影响面预演 共用的「单实体匹配」原语。
 *
 * 为什么单独成文件：options.js 的 simHits() 与 ruleImpact() 都要拿「一条规则」去匹配
 * 「发现库里的一个实体名」，但历史上两者的匹配口径不一致 —— simHits 尊重 match(精确/正则)
 * 与别名，ruleImpact 却用裸 indexOf 子串，于是「影响面预演」算得准、「规则体检」的过宽判定
 * 却会漏判正则/精确/别名规则。这里把口径收口成一份，两边共用，杜绝漂移。
 *
 * 语义必须和 content.js::matchRule 的关键词判定保持一致（仅针对「单一实体名」这一子集，
 * 不含 expr / 评分·日期 / 站点限定 —— 那些维度发现库没有，调用方应跳过）。
 *
 * 这是纯函数模块：无副作用、不碰 DOM、不读存储。content.js 与 options.js 均通过
 * globalThis.SF_RULECHECK 使用；Node 测试 require 亦可。
 */
(function () {
  'use strict';

  // 规则作用域 → 发现库实体类型。发现库只存 女优/标签/片商/系列/导演 五类，
  // 故 title(关键词/番号)、all 没有对应维度，返回 undefined（调用方据此跳过）。
  var SCOPE_TO_DISC = {
    actress: 'actress', tag: 'tag', maker: 'maker',
    series: 'series', director: 'director'
  };

  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* 一条规则能否命中某个实体名（仅关键词口径）。
   * 返回：true 命中 / false 不命中 / null 该规则无法离线判定（填了 expr，或没有主体词）。
   * scope 仅用于对齐字段语义；对单实体名而言 hay 就是它自己。 */
  function matchEntity(rule, name, scope) {
    if (!rule) return false;
    if (rule.expr && String(rule.expr).trim()) return null; // 表达式规则：发现库无维度，跳过
    var vals = [rule.value].concat(rule.aliases || []).filter(function (x) {
      return x != null && String(x).trim();
    });
    if (!vals.length) return null; // 纯条件规则（只有评分/日期）：无法对实体名判定
    var hay = String(name == null ? '' : name).toLowerCase();
    var mode = rule.match || 'contains';
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i]).trim().toLowerCase();
      if (!v) continue;
      if (mode === 'regex') {
        try { if (new RegExp(v, 'i').test(hay)) return true; } catch (e) { /* 坏正则：当不命中 */ }
      } else if (mode === 'exact') {
        if (hay === v) return true;
        if (new RegExp('(^|[|\\s,，、])' + escRe(v) + '([|\\s,，、]|$)', 'i').test(hay)) return true;
      } else {
        if (hay.indexOf(v) !== -1) return true;
      }
    }
    return false;
  }

  var API = { matchEntity: matchEntity, SCOPE_TO_DISC: SCOPE_TO_DISC };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { if (typeof globalThis !== 'undefined') globalThis.SF_RULECHECK = API; } catch (e) { }
})();
