# 需求 002：屏蔽后的展示方式（三档）+ 番号站数量补足

状态：**待 Leon 确认后实施**（讨论稿）
提出人：Leon
记录时间：2026-09-22
相关文件：`content.js` / `content.css` / `options.js` / `options.html` / `popup.html` / `README.md`

---

## 一、Leon 的原始诉求

> 现在屏蔽影片或者女优等网页中这一页影片的数量或内容是不是就减少了，
> 我还是想在这一页展示原来数量（默认）或自定义数量的影片或内容，你的建议是？

拆成两个层次：

| 层次 | 想要的效果 | 朴素实现手段 |
| --- | --- | --- |
| **L1 保位** | 被屏蔽的卡片**保留网格位置**，分页器计数、网格排布不变 | `visibility:hidden` 取代 `display:none` |
| **L2 补足** | 页面卡片总数**补齐到原始数量**（或自定义数量） | 从下一页预取卡片克隆过来 |

Leon 已确认的选择：

- 屏蔽方式 → **改成三档下拉，默认「保留占位」**
- 补足数量 → **做，但只在番号站尝试**

---

## 二、现状（已核实，代码为证）

### 2.1 当前是二元开关，默认「完全隐藏」

| 位置 | 内容 |
| --- | --- |
| `content.js:1366` | `} else if (st.softBlock) { ... } else { cf-blocked }` |
| `content.js:72` | `softBlock: false,   // 默认关闭 ＝ 完全隐藏` |
| `options.js:40` | `['softBlock', '软屏蔽（灰化模糊 + 「仍然查看」临时放行）']` |
| `popup.html:61` | `<label class="tg" data-k="softBlock">软屏蔽</label>` |
| `content.js:1729` | 面板内 `<label data-tg="softBlock">软屏蔽</label>` |

### 2.2 三种视觉状态的 CSS 语义

| 类名 | 定义位置 | 效果 | 布局是否塌陷 |
| --- | --- | --- | --- |
| `.cf-blocked` | `content.css:4` | `display:none !important` | **是（格数减少）** |
| `.cf-filt-out` | `content.css:281` | `display:none !important` | 是 |
| `.cf-soft` | `content.css:230` | 原位灰化 + blur 遮罩 + 「仍然查看」 | 否 |

> **结论**：Leon 观察到的「这一页影片数量减少了」是准确的 —— `.cf-blocked` 用 `display:none`，
> 网格会重排、分页器上显示的「共 N 部」也不变（那是站点的数），但**可视格数确实变少**。

### 2.3 没有任何补足 / 翻页代码

全库检索 `backfill|补足|补位|loadMore|翻页|fetch(` 无结果。扩展**只操作当前 DOM 里已存在的卡片**，
不发任何网络请求（README:120 / 178 / 238 / 287 四处承诺）。

### 2.4 代码里已有的「清标记」清单（改动时必须同步）

`content.js:1174`（`clearMarks`）：

```js
'.cf-blocked,.cf-fav,.cf-hl,.cf-seen,.cf-sfw,.cf-favcode,.cf-watch,.cf-card,.cf-dl,.cf-soft,.cf-peek,.cf-preview'
```

`content.js:1201`（`resetPassMarks`）：

```js
'.cf-blocked,.cf-soft,.cf-peek,.cf-fav,.cf-hl,.cf-seen,.cf-sfw,.cf-favcode,.cf-watch,.cf-filt-out,.cf-preview'
```

> 漏加 `.cf-placeholder` 的后果：规则撤销后卡片永久 `visibility:hidden` 无法恢复。
> 这正是当年 `.cf-blocked` 踩过的坑（`content.js:1198` 的注释就是那次事故的记录）。

### 2.5 三处 `DEFAULT_SETTINGS` 必须同步

| 文件 | 行号 |
| --- | --- |
| `content.js` | 52 |
| `background.js` | 27 |
| `options.js` | 20 |

迁移步必须三处都补，且 `SCHEMA_VERSION` 三处一致（`_test_migrate.js:203` / `_test_sites.js:169` 守着）。

---

## 三、L1 保位：详细设计

### 3.1 设置项改造

`softBlock: boolean` → `blockDisplay: string`

| 值 | 语义 | CSS |
| --- | --- | --- |
| `'hide'` | 完全隐藏，格数减少（旧行为） | `.cf-blocked { display:none }` |
| `'placeholder'` | **默认**。保留占位，格里空着 | `.cf-blocked.cf-placeholder { visibility:hidden !important }` |
| `'soft'` | 灰化 + 模糊遮罩 + 「仍然查看」 | `.cf-soft` |

- 保留 `.cf-blocked` 作为「命中屏蔽」的**基础类**（下游 `content.js:2055` 的快速筛选、
  `content.js:117`/`205` 的多处判断都依赖它），**只额外挂 `.cf-placeholder`** 实现视觉差异。
- 这样 `.cf-soft` 分支也能继续用 `cf-blocked` 之外的状态，无需大改。

### 3.2 迁移（v5 → v6）

```js
6: function (x) {
  x.settings = x.settings || {};
  if (!x.settings.blockDisplay) {
    // 老用户：勾了软屏蔽的 → 'soft'；没勾的 → 保持原本的完全隐藏
    x.settings.blockDisplay = x.settings.softBlock ? 'soft' : 'hide';
  }
  delete x.settings.softBlock;   // 旧字段清掉，避免两份真相
}
```

> **注意**：这里**不**把老用户默认改成 `placeholder` —— 迁移必须尊重既有行为，
> 否则升级瞬间所有老用户的页面观感突变。`'placeholder'` 只作为**全新安装**的默认值。

### 3.3 UI 改动（三处）

| 位置 | 改动 |
| --- | --- |
| `options.js:34` `SWITCHES` | 删 `['softBlock', ...]`；`blockDisplay` 单独做一个 `<select>` 卡片 |
| `options.html` | 「软屏蔽」卡片改名为「屏蔽后的显示方式」，加三档下拉 |
| `popup.html:61` | `softBlock` 复选框 → 三档下拉（或简化为「保留占位」单开关） |
| `content.js:1729` | 面板开关：改为在 `hide` / `placeholder` 之间切换的按钮（`soft` 需配放行时长，建议只留设置页） |
| `options.js:2389` `profileSnapshot` | `softBlock: !!...` → `blockDisplay: ...` |

### 3.4 连带改动（易漏）

- `content.js:1174` / `content.js:1201` 两处类名清单加 `cf-placeholder`
- `content.js:2055` `if (c.classList.contains('cf-blocked')) continue;` —— 保留占位的卡片
  也应该参与「评分/日期筛选」，但它已不可见；建议**保持现状**（跳过），并在注释里写明原因
- `content.js:1433` `hideByFav` 分支（只看收藏 / 只看★番号）**不挂** `.cf-placeholder` ——
  那两种是主动筛选，格数塌陷是预期行为

### 3.5 连带测试改动

| 文件 | 改动 |
| --- | --- |
| `_test_softblock.js` | `build(softBlock)` → `build(mode)`；阶段一改 `'soft'`，阶段二 `build('hide')`，断言 `cf-blocked` 且**不带** `cf-placeholder`；新增阶段五验证 `'placeholder'` |
| `_test_options.js:139` | `softBlock` 复选框断言 → `#blockDisplay` 下拉断言 |
| `_smoke.js:449` | 面板 `data-cb="softBlock"` → 新的 `data-bd` 机制断言 |
| `_test_sites.js:170` | 三处 `SCHEMA_VERSION` 都是 5 → 6；`step 5` → `step 6` |
| `_test_migrate.js` | 新增 v5 → v6 迁移断言 |
| `_test_writeback.js:42` / `_test_rulecond.js:55` / `_test_expr.js:184` / `_test_newfeat.js:56` | 测试夹具里的 `softBlock: false` 改成 `blockDisplay`（否则迁移删字段后夹具与真实 shape 不一致） |

---

## 四、L2 补足：详细设计与风险

### 4.1 这是本需求里唯一有实质风险的部分

README 四处承诺「零网络请求」。补足**必须**发 `fetch` 拿下一页 HTML。
三条路：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| **A 全站生效** | 所有站点补足 | 违背承诺范围最大，且 PornHub 类是 SPA / 无限滚动，几乎不可行 |
| **B 仅番号站**（Leon 选的） | 只对 `code: true` 的 4 个站生效 | 承诺需在 README 里显式写「仅番号站、仅在你开启补足时」 |
| **C 不做** | —— | 我原本的建议，已被 Leon 否决 |

### 4.2 四个番号站的翻页形态（**未做真实页面验证**）

| 站 | `code` | 分页形态 | 备注 |
| --- | --- | --- | --- |
| JavBus | ✔ | `?page=N` | 需实测确认参数名与 off-by-one |
| JavDB | ✔ | `?page=N` | SPA 倾向，需实测 |
| JavDB571 | ✔ | `?page=N` | 同上 |
| JavDB580 | ✔ | `?page=N` | 同上 |

> **风险**：我**没有**真实抓过这四个站的下一页 HTML。所有 `?page=N` 的假设都来自常见形态，
> 不排除 JavDB 系用 AJAX、JavBus 用 POST、或需要 cookie/Referer。
> **建议**：实施前先手工抓一页验证，不要盲写。

### 4.3 补足的技术要点

1. **数量口径**：`原始数量 = 屏蔽前的卡片总数`；`自定义数量` = 设置项
2. **只克隆，不改站点分页器** —— 分页器上的「共 N 页」是站点的数，我们不碰
3. **克隆卡片的标记**：加上 `cf-cloned`（便于识别、便于撤销时清理），并**不**参与「发现库」写入
   （`noteDiscovered` 只记真实浏览过的内容，克隆的是同页之外的东西，记进去会污染推荐）
4. **克隆卡片的屏蔽判定**：必须也走一遍 `runPass` 逻辑（否则把被屏蔽的片补进来，等于白补）
5. **循环保护**：最多补 N 页（建议 3），避免「一页全是屏蔽」时无限抓
6. **失败降级**：fetch 失败 / 解析不出卡片 → 静默放弃，退回 `placeholder` 行为，写 `errLog`
7. **限速**：同一站点补足请求间隔 ≥ 1s，避免被判定为爬虫
8. **开关默认关闭**：`backfill: 'off'`（`off` / `same` / 数字），避免升级即联网

### 4.4 补足与现有机制的交互（必须逐条确认）

| 现有机制 | 交互 |
| --- | --- |
| `MutationObserver`（`content.js:3676`） | 克隆插入 DOM 会触发 observer → 需靠 `applying` 标志抑制，或让克隆走同一个 `runPass` |
| `extractCache` / `extractSig` | 克隆卡片需正常入缓存（`cardSig` 会变） |
| `origPos`（高亮置顶用的原位置记录） | 克隆卡片没有原位置，需单独标记，撤销时不参与 `insertBefore` 还原 |
| `clearMarks` / `resetPassMarks` | 克隆卡片在重跑时应被移除或重置，别越积越多 |
| `stats` 计数 | 补进来的卡片算不算 `stats.cards`？建议算，但要新增 `stats.cloned` |
| 面板「点选卡片模式」 | 用户点到克隆卡片时，选择器要指向站点原卡片，不能把克隆的克隆下来 |
| 键盘导航 `navIdx` | 克隆卡片应参与导航（它就是可见卡片） |
| SFW `cf-sfw` | 克隆卡片的图片也应被模糊（否则 SFW 在克隆卡上失效） |

### 4.5 真实页面验证清单（实施前）

- [ ] JavBus：`?page=2` 是否返回不同的卡片？参数名对吗？
- [ ] JavDB：是服务端渲染还是 AJAX？`?page=2` 有效吗？
- [ ] JavDB571 / JavDB580：镜像是否同构？
- [ ] 是否有反爬（403 / 验证码 / 需要 Referer）？
- [ ] 卡片容器选择器在下一页 HTML 里是否一致（`findCards` 能否复用）？

---

## 五、建议的实施顺序（若 Leon 同意）

| 阶段 | 内容 | 风险 | 可否独立验收 |
| --- | --- | --- | --- |
| **S1** | L1 三档 + 迁移 + 三处 UI + 测试同步 | 低 | ✅ 可单独发布 |
| **S2** | README / CHANGELOG 更新 | 低 | ✅ |
| **S3** | 番号站真实页面抓取验证（只读，不改码） | 无 | ✅ 出报告 |
| **S4** | L2 补足（仅番号站，默认关） | 中 | 依赖 S3 结论 |

> **我的建议**：先做 S1 + S2 发一版（低风险、直接解决 Leon 的「格数减少」痛点），
> S3 出验证报告后再决定 S4 怎么做。**S2 的 README 改动需要 Leon 明确点头**，
> 因为那是动「零网络请求」这个已达成的承诺。

---

## 六、待 Leon 拍板的 3 个问题

1. **补足的数量口径**：固定「补齐到原始数量」就够，还是需要「自定义数量」输入框？
   （自定义会让页面卡片数比原页多，视觉上可能反常）
2. **旧版面板开关怎么处理**：`softBlock` 复选框是升级成三档下拉，还是面板里只留
   「保留占位 / 完全隐藏」两档、`soft` 只放在设置页？
3. **README 的承诺怎么改写**：可以接受类似
   「默认零网络请求；仅当你开启『番号站补足』时，扩展才会向你正在浏览的番号站请求下一页」
   这样的表述吗？
