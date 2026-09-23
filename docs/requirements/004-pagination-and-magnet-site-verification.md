# 番号站翻页 + 磁力站可行性验证报告

验证时间：2026-09-22 14:00–14:15（番号站/磁力站）+ 17:05–17:30（三个新站） GMT+8
验证方式：真实 `curl` 抓取 + `jsdom` 解析（**只读，未改任何代码**）
验证人：SiteFilter 开发过程
原始产物：`.worktrees/probe/`（第一部分）、`.worktrees/probe2/`（三个新站，均可删）

> **落地状态（2026-09-23 补）**：本报告是**只读验证**（验证本身未改代码），但报告里的建议
> **已全部采纳并落地**：
> - `ad80ef1` 把 YouPorn 的 `tpl` 从 `li.videoBox` 改成 `article.video-box`；把西斯寂舍的
>   `tpl` 换成 `#threadlist div[id^="normalthread_"], #threadlist div[id^="stickthread_"]`。
> - 同一提交给 `detectRows()` 的 `ul li` 兜底加了「命中必须落在内容容器内」的约束
>   （`hasListRoot`）—— 修的就是第三·补节指出的那个**静默错误**（把导航菜单认成卡片）。
> - 第一节的番号站结论也已生效：**放行名单只有 `JavDB580`**（站点模板里 `bf: true` 全库仅一处），
>   另两个域名不可行，并有测试钉死它们零请求。
> - 3.1 / 3.2 里 PornHub / YouPorn 的 `tag` 维度落空属**站点信息架构**问题（卡片与详情页都不
>   暴露分类链接），按本报告结论**保留、不做特殊处理** —— 它不是模板 bug。

> **最新补测（第三节补）结论**：v1.2.0 新增的三个站（PornHub / YouPorn / 西斯寂舍）
> 在真实页面上**都有问题** —— YouPorn 与西斯寂舍的 `tpl` 主选择器写错，
> 西斯寂舍的兜底还会把**导航菜单认成卡片**（静默错误）。详见第三·补节。

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

## 三补、三个新站（PornHub / YouPorn / 西斯寂舍）的真实页面验证

验证时间：2026-09-22 17:05–17:30 GMT+8
验证方式：真实 `curl` 抓取 + `jsdom` 解析（**只读，未改任何代码**）
原始产物：`.worktrees/probe2/`（可删）

> 这三个站是 v1.2.0 新增的预置监听站点，此前只做了「模板写好了」，
> **从未在真实页面上验证过选择器**。本次补齐。

### 结论速览

| 站 | 主选择器 `tpl` | 真实页面命中 | 判定 |
| --- | --- | --- | --- |
| **PornHub** | `li.pcVideoListItem` | **37** | ✅ 正确 |
| **YouPorn** | `li.videoBox` | **0**（真实是 `article.video-box`） | ❌ **需要修** |
| **西斯寂舍** | `#threadlist tbody tr` | **0**（真实是 `#threadlist div[id^="normalthread_"]`） | ❌ **需要修** |

### 3.1 PornHub —— 选择器正确，但 `tag` 维度落空

抓取 `https://www.pornhub.com/video/search?search=japanese` → HTTP 200 / 1.38 MB。

| 选择器 | 命中 |
| --- | --- |
| `li.pcVideoListItem`（`tpl`） | **37** ✅ |
| `.videoBox` | 37 ✅ |
| `#videoSearchResult li` | 32 ✅ |
| `.phimage` | 37 ✅ |
| `.item` | 0 |

- `idFrom = /[?&]viewkey=([0-9a-z]+)/i` → **34/37 命中**（`6a7345f18087e`、`ph61e2ad4914540`…）✅
- **actress 维度** href 18/37（`/model/chidori-and-nobu`、`/model/hajimesuper`）✅
- **maker 维度** href 19/37 + cls 20/37（`/channels/japan-in-love`）✅
- ⚠️ **tag 维度 href 0/37、cls 0/37 —— 完全落空**

**tag 为什么落空**（已进一步核实，不是选择器写错）：

1. 列表页卡片里**根本没有分类链接**：`/video?c=`（模板 tag 正则含此项）在卡片内出现 **0/37**；
   `/categories/` 全页仅 20 处，全部位于**导航/页脚**，卡片内 0 处。
2. 详情页（`view_video.php?viewkey=…`，1.57 MB）同样如此：
   `/categories/` 只有 8 处，且是**导航栏 + help.pornhub.com 帮助中心**的链接，
   **没有一处是该视频自己的标签**。
3. 结论：**PornHub 的卡片/详情页不暴露可右键屏蔽的分类链接** —— 这是站点信息架构问题，
   不是模板 bug。`tag` 维度在 PH 上**本质上用不到**，保留即可（无害），
   但**不要指望它能屏蔽分类**。

### 3.2 YouPorn —— `tpl` 写错了（tag 名 + class 名都错）

抓取 `https://www.youporn.com/search/?query=japanese` → HTTP 200 / 522 KB。

| 选择器 | 命中 |
| --- | --- |
| `li.videoBox`（`tpl`） | **0** ❌ |
| `.video-box` | **33** ✅ |
| `li.video` / `.item` / `.card` | 0 |

真实 DOM：

```html
<article class="video-box pc js_video-box js-pop">
  <div class="searchResults ...">
```

**两处错误**：
1. 标签名不是 `<li>`，是 **`<article>`**
2. class 不是 `videoBox`（驼峰），是 **`video-box`（连字符）**

含 `videoBox` 字样的 class 实测只有：`video-box` / `js_video-box` / `video-box-image` / `js_video-box-url`
—— **没有任何一个叫 `videoBox`**。`li` 的 class 抽样里也没有 video 相关项。

其余维度（以 `.video-box` 为卡片）：
- `idFrom = /\/watch\/(\d+)/i` → **32/33** ✅
- maker href 19/33 + cls 3/33 ✅
- actress href 3/33（搜索页只偶尔带演员链接，正常）
- ⚠️ tag 0/33 —— 与 PH 同理，YP 卡片不暴露分类链接

**建议修法**：`tpl` 与 `sel` 把 `li.videoBox` 换成 `article.video-box` / `.video-box`。
（注意：`sel` 里已有 `.video-box`，所以**兜底能救回来**；但 `tpl` 是首选路径，
写错意味着每次都要多走一轮兜底，且 `tplTest` 可能误判。）

### 3.3 西斯寂舍 —— `tpl` 写错了，且**兜底会认错元素**（最严重）

抓取：

| URL | HTTP | 字节 | 说明 |
| --- | --- | --- | --- |
| `https://xsijishe.net/` | 200 | 379515 | 首页（**裸域名**） |
| `https://xsijishe.net/forum-40-1.html` | 200 | 404188 | 「求出处」版块（`#threadlist` 在此） |

⚠️ **`www.xsijishe.net` 不可用**：TLS 握手失败（`SSLEOFError`），
但**裸域 `xsijishe.net` 正常**（TLSv1.3）。DNS 解析到 `198.18.0.x`（本地代理 fake-IP）。
→ 模板 `pattern: '*://*.xsijishe.net/*'` 单独**配不到裸域**，
靠 `matchSite()` 的**裸域名兜底**（`*://*.` → `*://`）才匹配上 —— 已验证可用 ✅

**`tpl` 为什么是 0**：

| 选择器 | 命中 |
| --- | --- |
| `#threadlist tbody tr`（`tpl`） | **1**（且是工具栏行，不是帖子）❌ |
| `#threadlist div[id^="normalthread_"]` | 26 ✅ |
| `#threadlist div[id^="stickthread_"]` | 10 ✅ |

真实结构（Discuz! X3.4 + `nex_*` 主题）：

```
DIV#threadlist.bm
 └ DIV.bm_c
    └ FORM#moderate
       └ DIV#threadlisttableid
          └ DIV.nex_forum_lists   ← 一行（id=normalthread_xxx / stickthread_xxx）
             ├ DIV.nex_forum_lists_tops   (作者/时间元信息)
             └ DIV.nex_forum_lists_mids   (标题/分页)
```

**该主题的帖子行是纯 `<div>`，整页 `tbody` 只有 1 个**（工具栏），
所以 `#threadlist tbody tr` 必然只命中 1 个 —— `tpl` 完全不适用。

**用正确的行容器后，两个维度都正常**：

| 维度 | 正确行容器下命中 |
| --- | --- |
| tag（版块） | href 27/36 + cls 36/36 ✅ |
| actress（作者） | href 36/36 + cls 36/36 ✅ |

作者链接真实形式是 `home.php?mod=space&uid=838751`；
模板 `href: /(space-uid-|mod=space|uid=)/i` 靠 **`mod=space`/`uid=` 兜住** ✅
（页面里 `space-uid-` 链接数为 **0**）。作者 class 实为 `nex_authorinfo` /
`nex_threads_author`，模板 `cls: /(authi|author)/i` 命中 ✅

#### ⚠️⚠️ 最严重的问题：`detectRows()` 兜底会**把导航栏认成卡片**

`findCards()` 在 `rowMode` 下若 `tpl` 不足 3 个，会走 `detectRows()`：

```js
var sels = ['#threadlist tbody tr', '#threadlist tr', 'tbody tr',
            '.nex_forum_lists li', 'ul li'];
```

实测这 5 个候选在真实版块页上的表现：

| 选择器 | 原始命中 | 含链接且有文本 |
| --- | --- | --- |
| `#threadlist tbody tr` | 1 | 1 |
| `#threadlist tr` | 1 | 1 |
| `tbody tr` | 1 | 1 |
| `.nex_forum_lists li` | 81 | **0**（都是空壳） |
| **`ul li`** | **197** | **103 ← 会命中这里** |

那 103 个 `ul li` 的真实内容：

```
[0] 本版     [1] 用户      [2] 登陆账号   [3] 立即注册
[4] 首页Portal [5] 论坛BBS   [6] 综合      [7] 图片区
[8] 视频区    [9] ACG区     [10] 悬赏区    [11] 求出处
```

所在 `ul` 的 class：`p_pop` / `p_pop h_pop` / `ttp bm cl` —— **全是下拉菜单/导航**。
**103 个候选里只有 4 个落在 `#threadlist` 内。**

→ 后果：在西斯寂舍上，扩展会把**导航菜单项当成"卡片"**，
用户可以"屏蔽"掉「立即注册」「图片区」这种菜单项，而**真正的帖子一行都屏蔽不到**。
**这是静默错误**：UI 看起来在工作，实际全错。

### 3.4 修复建议（等 Leon 决定后再动代码）

按「先讨论后实施」的约定，**本次只验证、未改任何代码**。建议改法：

| 站 | 字段 | 现在 | 建议 |
| --- | --- | --- | --- |
| YouPorn | `tpl` | `li.videoBox` | `article.video-box` |
| YouPorn | `sel` | `['li.videoBox','.video-box','li.video','.item','.card']` | 把 `li.videoBox` 换成 `article.video-box`（保留 `.video-box`） |
| 西斯寂舍 | `tpl` | `#threadlist tbody tr` | `#threadlist div[id^="normalthread_"], #threadlist div[id^="stickthread_"]` |
| 西斯寂舍 | `sel` | `['#threadlist tbody tr','.nex_forum_lists li','tbody tr']` | 用 `#threadlist div[id^="normalthread_"]`、`#threadlist div[id^="stickthread_"]`、`#threadlist .nex_forum_lists` |
| 西斯寂舍 | `detectRows()` 兜底 | 含 `ul li` | **去掉 `ul li`** 或加「必须落在 `#threadlist` 内」的约束，否则认错导航 |

> 另：`content.js:984` 的 `detectRows()` 里 `'#threadlist tbody tr'` 同样失效，
> 且最后一项 `'ul li'` 是这次误识别的主因 —— 两处需一起看。

### 3.5 与 v1.2.0 CHANGELOG 说法的偏差（需 Leon 知悉）

v1.2.0 CHANGELOG 写：「三者都带各自的**维度识别规则**，卡片右键的『屏蔽演员/片商/标签』可直接用」。
实测后：

| 站 | 实测 |
| --- | --- |
| PornHub | 演员 ✅ / 片商 ✅ / **标签 ❌（站点不暴露）** |
| YouPorn | 演员 △（搜索页少）/ 片商 ✅ / **标签 ❌**；且 **`tpl` 写错，主路径失效** |
| 西斯寂舍 | 标签 ✅ / 作者 ✅；但 **`tpl` 写错 + 兜底认错导航** |

→ 「可直接用」对这 3 个站**都不成立**，其中西斯寂舍属于**会静默做错事**。

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

### 三个新站（2026-09-22 17:05 补测）

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"

# PornHub：列表页 / 分类页 / 详情页
curl -s -A "$UA" "https://www.pornhub.com/video/search?search=japanese" -o ph.html
curl -s -A "$UA" "https://www.pornhub.com/categories" -o ph-cat.html
curl -s -A "$UA" "https://www.pornhub.com/view_video.php?viewkey=6a7345f18087e" -o ph-detail.html

# YouPorn：搜索页 / 分类页
curl -s -A "$UA" "https://www.youporn.com/search/?query=japanese" -o yp.html
curl -s -A "$UA" "https://www.youporn.com/categories/" -o yp-cat.html

# 西斯寂舍：注意 www 不可用（TLS 失败），必须用裸域
curl -s -A "$UA" "https://xsijishe.net/"               -o xs-home.html
curl -s -A "$UA" "https://xsijishe.net/forum-40-1.html" -o xs-forum40.html
# 反例：这个会 TLS 握手失败
curl -s -A "$UA" "https://www.xsijishe.net/"            # → SSLEOFError
```

解析后核对（jsdom）：

```
PH : li.pcVideoListItem = 37 ✓ | tag 维度 = 0 ✗
YP : li.videoBox = 0 ✗ | .video-box = 33 ✓
XS : #threadlist tbody tr = 1 ✗
   | #threadlist div[id^="normalthread_"] = 26 ✓
   | #threadlist div[id^="stickthread_"]  = 10 ✓
   | detectRows 兜底会落到 'ul li' = 103 个导航项 ✗✗
```
