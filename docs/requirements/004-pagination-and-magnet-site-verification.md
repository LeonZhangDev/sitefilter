# 番号站翻页 + 磁力站可行性验证报告

验证时间：2026-09-22 14:00–14:15 GMT+8
验证方式：真实 `curl` 抓取 + `jsdom` 解析（**只读，未改任何代码**）
验证人：SiteFilter 开发过程
原始产物：`.worktrees/probe/`（可删）

---

## 一、番号站补足（需求 002 L2）的可行性 —— 结论：**只剩 1 个站可行**

| 站 | 模板 `code` | 抓取结果 | 补足可行性 |
| --- | --- | --- | --- |
| **JavDB** (`javdb.com`) | `true` | HTTP 200 但**仅 1278 B**，内容为：<br>「Due to copyright restrictions, access to this site is prohibited in the country where your internet is located / 由於版權限制，本站禁止了你的網路所在國家的訪問」+ Cloudflare 挑战脚本 | ❌ **不可行** |
| **JavBus** (`javbus.com`) | `true` | 首页被 302 到 `/doc/driver-verify`；带 `-L` 跟随后落在<br>`Age Verification JavBus` 页（21771 B） | ❌ **不可行**（无 cookie 过不了验证） |
| **JavDB571** (`javdb571.com`) | `true` | **HTTP 000**（连接失败/超时） | ❌ **不可行**（域名本身不通） |
| **JavDB580** (`javdb580.com`) | `true` | HTTP 200 / **70314 B** 正常 HTML，服务端渲染 | ✅ **可行** |
| xchina (`xchina.co`) | `false` | HTTP 200 / 119689 B 正常 | ✅ 但**它不是番号站**（`code: false`），不参与补足 |

### JavDB580 的详细验证（唯一可行站）

**分页参数**：`https://javdb580.com/?page=N`

| 页码 | HTTP | 字节数 | `.item` 卡数 | md5 |
| --- | --- | --- | --- | --- |
| 1 | 200 | 70314 | **40** | `7d721659d5877508…` |
| 2 | 200 | 72722 | **40** | `fa26b883c9ffc9d2…` |

- **两页 md5 不同、字节数不同 → `?page=N` 确实返回不同内容**（服务端渲染，非 SPA）
- 首页样本：`082126_01 初めての３Ｐ … 2026-08-21 含磁鏈 今日新種`
- 第 2 页样本：`092126_01 令和のあざと娘と中出しPtoMセックス … 2026-09-21 含磁鏈 昨日首種`
- **`.item` 选择器在两页都命中 40 个**，与 `SITE_TEMPLATES` 里 `s_javdb580.sel` 的
  `['.item','a.box','.movie-box','.grid-item']` 完全兼容
- 每条结果自带「含磁鏈」标记 → 与 `probeLinks()` 的能力天然互补

### 对需求 002 L2 的影响（必须让 Leon 知道）

原方案写的是「只对 4 个番号站生效」。**实测后只有 JavDB580 一个站能真正落地**：

1. **补足的覆盖面从 4 个站缩到 1 个站** —— 收益比预期小很多
2. **JavDB / JavBus 的封锁是网络层的**（地区封锁 / 人机验证），不是我们代码能绕过的
   —— 若强行绕过等于做反反爬，有合规风险
3. **「零网络请求」的承诺仍要改写**，但改写的收益只覆盖 1 个站

> **我的建议**：L2 降级为「仅 JavDB580」，并且**默认关闭**。
> 如果 Leon 觉得只为一个站改承诺+加 9 处交互处理不划算，可以**直接砍掉 L2**，
> 只做 L1（三档显示）—— 那才是真正解决「格数减少」痛点的部分。

---

## 二、新增磁力站的可行性

Leon 提供四个网址：
`sofa.jiugeciliox.top` / `haishi.fangfangcili.top` / `blush.jiugeciligh.top` / `thepiratebay.org`

### 2.1 镜像站群（前三个）—— 结论：**同构，接口可用，但没有磁力链**

- 三个域名是**同一套程序的不同镜像**（同一份 `index.js` / `result.js` / `popup.js`，
  路径都是 `/sh/`，同版本参数 `v=2026092214`）
- **是 SPA**：结果页 `/sh/result?keyword=X&page=N` 返回的 HTML 里
  `.result-list` 只有 **16 字节空壳**，真实数据由 `result.js` 里 AJAX 拉取
- **接口已实测可用**：

```
POST https://sofa.jiugeciliox.top/api/v1/search
Content-Type: application/json
Referer: https://sofa.jiugeciliox.top/sh/result
Origin:  https://sofa.jiugeciliox.top

{"page":1,"keyword":"三上悠亚","order_by":"_score","in_app":false}
```

**返回结构**（实测）：

```json
{
  "code": "SUCCESS",
  "keywords": "…联想词…",
  "data": {
    "count": 10000, "limit": 1000, "page": 1, "size": 10,
    "list": [{
      "sname": "三上悠亚.avi", "name": "三上悠亚.avi",
      "hash": "", "idx": null,
      "size": 1708977171, "size_format": "1.59 GB",
      "files": 4, "hot": 7157,
      "created_at": "2026-09-22", "_score": 76.508606
    }]
  }
}
```

**三个必须知道的问题**：

1. **`hash` 字段恒为空字符串** —— 实测多条数据都是 `""`。
   前端 `result.js` 的逻辑是 `if (element.hash) { resultItem.onclick = … openResult(element.hash) }`，
   而 `openResult()` 只是 `_index.copy(clipboard)` + `postMessage({btih})`。
   **`hash` 为空 ⇒ 前端根本拿不到磁力链**，只能复制当前页 URL。
   这个站的定位看起来是**导流**（`getRandomGuideButtons()` + 付费引导），
   不是真的提供磁力。
2. **关键词有格式校验**：`abc` ✓ / `三上悠亚` ✓ / `东京` ✓ / 但 **`SSIS-001` ✗**
   返回 `{"code":"E_INVALID_KEYWORD","msg":"无效关键词"}`。
   **带短横线的番号会被拒** —— 而这恰恰是番号站最需要查的形式。
3. **需带 `Referer` / `Origin` 头**：不带时 curl 无法落盘（被拒），带上即 200。

### 2.2 The Pirate Bay —— 结论：**主站可达，但与本项目定位不符**

- `https://thepiratebay.org/index.html` HTTP 200 / 5276 B 正常
- 但 TPB 是**通用 BT 索引站**，不是成人内容站，与 SiteFilter 的
  `SITE_TEMPLATES`（女优/番号/标签维度）**没有可对接的字段**
- 接入它需要全新的解析维度（做种数/文件列表/分类），收益不明

---

## 三、给 Leon 的结论

| 事项 | 结论 |
| --- | --- |
| 番号站补足 | **4 个站里只有 JavDB580 可行**。建议降级为「仅 JavDB580、默认关闭」，或直接砍掉 |
| 新增磁力站（前三个） | **是导流站，`hash` 恒空，拿不到磁力链**；且拒绝 `SSIS-001` 这种带短横线的番号 |
| The Pirate Bay | 可达，但与现有维度体系不匹配 |
| **共同风险** | 这些站都是**灰产导流站**，接入它们会让扩展的性质和商店分类变差，且接口随时可能变 |

> **我的建议**：
> - 磁力站**不要接入为「监管站点」**（它们不是内容站，没有卡片可过滤）
> - 如果真要用，只能作为**「番号 → 磁力」的查询后端**，但那属于建议清单 ⑦，
>   我已经分析过 CORS 与合规问题。**而这三个站的 `hash` 恒空，连这个用途都不成立。**
> - **建议放弃接入**，把这几个域名留在验证记录里备查即可。

---

## 四、复现命令（供以后复查）

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"

# JavDB580 分页（唯一可行）
curl -s -A "$UA" "https://javdb580.com/?page=1" -o p1.html
curl -s -A "$UA" "https://javdb580.com/?page=2" -o p2.html

# JavDB 地区封锁
curl -s -A "$UA" "https://javdb.com/?page=2"        # → 1278B 版权提示

# JavBus 人机验证
curl -s -L -A "$UA" "https://www.javbus.com/page/2" # → /doc/driver-verify

# 磁力站接口（注意 hash 为空）
curl -s -A "$UA" -X POST "https://sofa.jiugeciliox.top/api/v1/search" \
  -H "Content-Type: application/json" \
  -H "Referer: https://sofa.jiugeciliox.top/sh/result" \
  -H "Origin: https://sofa.jiugeciliox.top" \
  -d '{"page":1,"keyword":"三上悠亚","order_by":"_score","in_app":false}'
```
