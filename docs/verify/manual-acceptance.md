# 人工验收清单（v1.4.0）

`python ci.py` 现在是 **24 套**，覆盖的是逻辑与协议。下面这四条链路
**自动化测不到**，只有在真浏览器里跑一次才算数：

> 断言总数**不在这里写死**（改一次代码它就过期一次，且没有任何机械手段能核）——
> 以 `python ci.py` 实际输出为准。套数会随新增测试套件变化，由 `_test_docs.js` 盯着本文件。

| 段 | 链路 | 为什么测不到 |
|---|---|---|
| A | Tier B：用**指定**下载器打开磁力 | 要经 `chrome.runtime.connectNative` → 注册表 → 本机进程。测试里 `connectNative` 是假的，`host.py` 是直接调起函数的 |
| B | Tier A：唤起**系统默认** magnet 处理程序 | 依赖操作系统里的 magnet 关联，沙箱里没有 |
| C | L3 反混淆五种形态 | 实现按形态写、断言按形态钉，但从没在真实页面的 DOM 上跑过 |
| D | 隐藏可回溯 | 只有 jsdom 断言，没在真面板上看过揭开后的样子 |

**这四条共有一个失效模式：静默。** 注册表少一层、`allowed_origins` 里的 ID 差一个字符、
反混淆某个形态漏了 —— 都不报错，只表现为「点了没反应」。所以下面每条都给了
**失败判据**（具体看到什么算失败）和**失败说明什么**（该查哪一层）。

---

## 0. 前置

| 项 | 值 | 备注 |
|---|---|---|
| 扩展 ID | `jaihdgjnnpmiabeoefmihmjhoodcjlhf` | 由 `manifest.json` 的 `key` 决定。**必须逐字符一致**，否则本机桥的 `allowed_origins` 会拒绝连接 |
| 本机桥 host 名 | `dev.zackzhang.sitefilter_magnet` | |
| 注册表位置 | `HKCU\Software\{Google\Chrome｜Microsoft\Edge｜Chromium}\NativeMessagingHosts\dev.zackzhang.sitefilter_magnet` | 默认值 = host 清单 json 的绝对路径 |
| 扩展目录 | 最新一版 `dist/sitefilter-*.zip` 解压后的目录 | |
| 测试页 | 任意 `http(s)` 页面 | 磁力用例全部靠控制台注造，不依赖任何真实站点 |

**两个前提，先确认**（详见 F 段）：

1. **`native-host/` 随包分发**（F1 已修）：解压出来的扩展目录下就有
   `native-host/install.py`，跑 A 段不需要另外准备源码仓库。
2. **本机需要 Python**（`install.py` 与 `host.py` 都是 Python）。
   先跑 `python --version`；若命令不存在，下文一律用 `py -3` 代替 `python`。

**一句话跑法**：A 段是重点（占一半篇幅），B/C/D 各 5 分钟。

---

## A. Tier B —— 本机桥

五步**分层**，每步独立可判。**哪一步红就停在哪一步**，不要在没确认前一层的情况下往下走
—— 否则最后「点了没反应」时分不清是注册表的问题还是下载器路径的问题。

### A0 · 先证明 `host.py` 自己是好的（不需要装任何东西）

```bat
cd <仓库根>
python _test_native_host.py
```

- **预期**：末行 `本机桥（host.py）专项测试全部通过 ✅`，退出码 0
  （末尾会打印通过项数，与本次运行一致即可 —— 这里不写死数字，免得代码加了断言它就成了假的）。
- **失败说明**：桥自身的问题，**与浏览器无关**。先修这个。这一层能省掉大量「是不是没注册好」的瞎猜。

### A1 · 注册（在**当前用户**范围，不需要管理员）

```bat
python native-host\install.py --print     :: 先看将写入什么，不落盘
python native-host\install.py             :: 真装
```

- **预期**：输出 `已生成 host.bat`、`已生成 dev.zackzhang.sitefilter_magnet.json`、
  `已注册到：Chrome、Edge`。
- **失败判据**：
  - `写 X 注册表失败` → 权限或安全软件拦截（全是 `HKCU`，正常不需要管理员）
  - `找不到 ...host.py` → 不是在仓库根目录跑的

核对注册表：

```bat
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\dev.zackzhang.sitefilter_magnet"
```

- **预期**：`(Default)` 的值是 `...\native-host\dev.zackzhang.sitefilter_magnet.json` 的**绝对路径**。

核对清单内容 —— **这是最容易错的一处**：

```bat
type native-host\dev.zackzhang.sitefilter_magnet.json
```

必须全部满足：

- [ ] `"path"` 是 `host.bat` 的**绝对路径**，且该文件确实存在
- [ ] `"allowed_origins"` 是 `chrome-extension://jaihdgjnnpmiabeoefmihmjhoodcjlhf/`
      —— 与 `chrome://extensions` 上显示的扩展 ID **逐字符一致**，且**结尾有 `/`**
- [ ] `host.bat` 里的解释器路径存在（用文本编辑器打开看第一行引号里的路径；若有 `pythonw.exe` 更好，不会闪黑框）

### A2 · 浏览器能看到桥（不需要下载器）

1. `chrome://extensions` → 开「开发者模式」→「加载已解压的扩展程序」→ 选扩展目录
   - **核对 ID** == `jaihdgjnnpmiabeoefmihmjhoodcjlhf`
2. **完全关闭浏览器再重开**（首次注册后必须重启；光 reload 扩展不够）
3. 扩展 → 设置页 → 通用设置 → 「自定义下载器路径」，填 `C:\Windows\System32\notepad.exe`
4. 点「**测试本机桥**」

- **预期**：`本机桥可用 ✔（协议 v1，Python 3.x.x）`
- **失败判据与定位**：

  | 看到的提示 | 说明什么 |
  |---|---|
  | `本机桥不可用 ✘ …未安装` / `native-host-missing` | 注册表或清单路径不对 → 回 A1 |
  | `协议版本不兼容` | 扩展与 `host.py` 版本不匹配 → 重跑 install.py |
  | `请先运行 native-host/install.py 并重启浏览器` | 就是没装，或者**没重启浏览器** |
  | 一直转圈不返回 | `host.bat` 卡住或解释器路径不对 → 回 A0 查 |
  | 提示 host 被禁止连接 | `allowed_origins` 里的 ID 与实际扩展 ID 不符 |

> **诊断提示**：`host.py` 的日志写 **stderr**，而 Windows 上 Chrome 会**丢弃** native host 的 stderr
> —— 这条日志你是看不到的。所以别指望日志，靠上表分层定位。

### A3 · 端到端真的唤起一个程序（**不需要装 BT 客户端**）

把「链路通没通」和「装没装 BT 客户端」解耦：**用记事本当假下载器**。

1. 「自定义下载器路径」填 `C:\Windows\System32\notepad.exe`（A2 里已填）
2. 在测试页按 [C 段](#c-l3-反混淆五种形态控制台注造零网络) 注入一个磁力
3. 面板 → 「下载链接」页 → 点该行的「打开」

- **预期**：**记事本被拉起**（哪怕它弹「找不到文件」—— 进程起来就说明链路通了）。
  任务管理器里能看到 `notepad.exe`，且它**不会被连带杀掉**（host 用 `DETACHED_PROCESS` 启动）。
- **失败判据**：
  - 面板出现黄字 `自定义下载器没打开（…），已回退到系统默认 magnet 处理程序。`
    → Tier B 失败但**回退生效**；按括号里的原因定位（`client-not-found` = 路径/文件问题）
  - 什么都不发生、连回退提示也没有 → 回 A2

### A4 · 负面路径 —— 确认「拒绝」与「回退」都是好的

| 操作 | 预期 | 结果 |
|---|---|---|
| 填**不存在**的路径（`C:\nope\x.exe`）→ 点「打开」 | host 返回 `client-not-found`；出现回退提示；**系统默认程序被唤起**（同时验证了 B 段） | |
| 填**存在的非下载器**如 `C:\Windows\System32\drivers\etc\hosts` | 被白名单拒绝（`.hosts` ∉ `{.exe .com .bat .cmd .lnk}`）→ 回退 + 提示 | |
| 路径**清空** → 点「打开」 | 直接走 Tier A，**完全不碰本机桥** | |

---

## B. Tier A —— 系统默认 magnet 处理程序

Tier B 的回退全靠它，所以必须单独确认。

1. 清空「自定义下载器路径」
2. 注入一个磁力 → 点「打开」

- **预期**：系统的默认 magnet 处理程序被唤起。
- **失败判据**：
  - **没反应** → 本机没有注册 magnet 处理程序（没装任何 BT 客户端时就是这样）。
    这是**预期内的环境限制，不是缺陷**；装一个下载器后可复测。
  - 首次点「打开」应出现一次黄色提示条（`已尝试用本机下载工具打开；若没反应，请确认已安装迅雷/μTorrent/qBittorrent 并设为系统默认…`），
    且**只出现一次** —— 第二次点不应重复出现（`magnetHintShown` 是一次性的）。

---

## C. L3 反混淆五种形态（控制台注造，零网络）

在测试页的 **Console** 里整段粘贴：

```js
(() => {
  const base = 'aaaaaaaabbbbccccddddeeeeffff';            // 28 位
  const id = i => base + String(i).padStart(12, '0');    // → 40 位 hex
  const mk = i => 'magnet:?xt=urn:btih:' + id(i);

  // 六个形态，各用不同的 infohash（否则会被归并成一条，看不出哪个漏了）
  const zw    = 'magnet:?xt=urn:btih:' + id(1).slice(0, 16) + '\u200b' + id(1).slice(16);
  const ent   = 'magnet:?xt=urn:btih:' + id(2).slice(0, 38) + '&#48;' + id(2).slice(39);
  const pct   = encodeURIComponent(mk(3));
  const b64   = btoa(mk(4));
  const bare  = id(5);
  const plain = mk(6);

  const old = document.getElementById('sf-walkthrough'); if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'sf-walkthrough';
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;background:#111;color:#eee;' +
                      'font:12px/1.7 monospace;padding:10px;max-width:62vw;word-break:break-all';
  document.body.appendChild(box);

  const line = (label, val, asAttr) => {
    const p = document.createElement('div');
    p.textContent = label + '：';
    const s = document.createElement('span');
    if (asAttr) { s.setAttribute('data-clipboard-text', val); s.textContent = '(data-clipboard-text)'; }
    else { s.textContent = val; }     // 文本节点：保证实体等字面量不被 HTML 解析器提前解码
    p.appendChild(s); box.appendChild(p);
  };

  line('①零宽',   zw,    true); line('①零宽',   zw);
  line('②实体',   ent,   true); line('②实体',   ent);
  line('③百分号', pct,   true); line('③百分号', pct);
  line('④base64', b64,   true); line('④base64', b64);
  line('⑤裸hash', bare,  true);                                  // ⑤ 只能靠 data-*
  line('⑥正常',   plain, true); line('⑥正常',   plain);

  console.log('应解出 6 条磁力，hash 依次是：');
  for (let i = 1; i <= 6; i++) console.log('  ' + i + ') ' + id(i));
  console.log('清理：document.getElementById("sf-walkthrough").remove()');
})();
```

然后打开面板 → 「**下载链接**」页。

### 预期

| # | 形态 | 预期 | 结果 |
|---|---|---|---|
| ① | 零宽（U+200B） | 解出 1 条，hash = `…000000000001` | |
| ② | HTML 实体（正文文本） | 解出 1 条，hash = `…000000000002` | |
| ③ | 百分号编码 | 解出 1 条，hash = `…000000000003` | |
| ④ | base64 | 解出 1 条，hash = `…000000000004` | |
| ⑤ | 裸 hash | 解出 1 条，hash = `…000000000005` | |
| ⑥ | 正常磁力 | 解出 1 条，hash = `…000000000006` | |

**共 6 条，且 6 个 hash 各不相同。**

### 探测路径矩阵（为什么用例要这么摆）

三处探测源的能力**不一样**，这是有意的设计，不是 bug —— 但如果「某个形态在某个来源下解不出」
就是你实际会遇到的缺口：

| 形态 | `<a href>` | `data-*` 属性 | 正文文本 |
|---|---|---|---|
| ① 零宽 | ✔ | ✔ | ✔ |
| ② 实体 | ✘（浏览器先解码，测的是浏览器不是我们） | ✔ | ✔ |
| ③ 百分号 | ✘ | ✔ | ✔（有专门的 `MAGNET_PCT_RE`） |
| ④ base64 | ✘ | ✔ | ✔（有专门的 `B64_TOKEN_RE`） |
| ⑤ 裸 hash | ✘ | ✔ | ✘ |
| ⑥ 正常 | ✔ | ✔ | ✔ |

`<a href>` 分支**不做兜底试解**（不像 `data-*` 有 `else dispatchLink(...)`）：`href` 必须
先看起来像链接才值得试。所以「href 里塞 base64 / 裸 hash」探测不到 —— 若你希望支持，那是新需求。

### 第二个用例：归并（L4）

清掉上一组，再粘这段 —— 三种形态指向**同一个** infohash：

```js
(() => {
  const h = 'aaaaaaaabbbbccccddddeeeeffff000000000007';
  const old = document.getElementById('sf-walkthrough'); if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'sf-walkthrough';
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;background:#111;color:#eee;' +
                      'font:12px/1.7 monospace;padding:10px;max-width:62vw;word-break:break-all';
  document.body.appendChild(box);
  const add = (val, asAttr) => {
    const s = document.createElement('span');
    if (asAttr) { s.setAttribute('data-clipboard-text', val); } else { s.textContent = val; }
    box.appendChild(s); box.appendChild(document.createElement('br'));
  };
  add('magnet:?xt=urn:btih:' + h + '&dn=Clean.Name.1080p.WEB-DL.H264', false);
  add(btoa('magnet:?xt=urn:btih:' + h + '&dn=Clean.Name.1080p.WEB-DL.H264&tr=udp%3A%2F%2Ftracker.one%3A80'), true);
  add('magnet:?xt=urn:btih:' + h.slice(0, 16) + '\u200b' + h.slice(16), true);
})();
```

- **预期**：下载页出现 **1 条**（不是 3 条），且列表里的文件名 / tracker 是三者**并集**中最全的那个。
- **失败判据**：出现 2–3 条 → 归并（按 infohash）没生效或 hash 被解坏。

---

## D. 隐藏可回溯

| # | 操作 | 预期 | 结果 |
|---|---|---|---|
| D1 | 打开面板，**不做任何屏蔽** | 底部**没有**「显示被隐藏」按钮（避免占位与误导） | |
| D2 | 在任意卡片上**右键** → 「临时屏蔽 1 天」 | 底部出现按钮，文案 `👁 显示被隐藏（1）` | |
| D3 | 点它 | 被屏蔽的卡片**以半透明（opacity 0.38）+ 红色虚线框**重新出现，位置形状照旧；文案变 `🙈 恢复隐藏（1）` | |
| D4 | 再点一次 | 卡片重新隐藏，文案变回 `👁 显示被隐藏（1）` | |
| D5 | 刷新页面 | 回到隐藏态（**纯视图态，不落存储**） | |

**观察项（不是断言，请给体感）**：D3 里被揭示的卡片是可点的（`display:revert` + 0.38 透明度）。
「看得见但能误点」和「看得见也点得进去」哪个更符合你的预期？现在是前者放开、后者可行。

---

## E. 怎么回报

1. 逐条在表里填 **✔ / ✘**，✘ 的贴在回报里
2. ✘ 时请一并给出：**在哪一步**（A0–A4 / B / C 第几条 / D 第几条）+ **屏幕上的原文案**（或截图）
   —— 文案里通常就带着错误码，能直接定位
3. C 段若某形态没出来，请说清是**没出这一条**还是**出了但 hash 不对**

我按「A → B → C → D」的顺序修，A 段优先（它涉及注册与进程，是唯一会「整条功能不可用」的一段）。
G 段是 `1.4.0` 新能力的顺手走查，可以晚一步 —— 但 **G1 与 G3 建议别跳过**：
前者是唯一不可逆的操作，后者的失败形态（升级后老规则集体误报失效）**不会报错**，只会误导判断。

---

## F. 准备这份清单时已经发现的问题

这两条**不需要跑走查就能确认**。都已经修掉了（见 CHANGELOG 的 `[1.3.1]`），留档
有两个用处：一是免得它们混进走查结果，二是下面写了「走查时怎么确认它真的好了」。

### F1 · 发布包缺 `native-host/` —— 已修

原来 `make_package.py` 的 `INCLUDE_DIRS = ['icons']`，而排除规则 `EXCLUDE_RE` 又滤掉所有
`.py` / `.md`。两件事叠起来：打出来的 zip 里没有 `native-host/`，而设置页写着「请先运行
`native-host/install.py`」—— 从 zip 装的用户找不到那个文件，Tier B 对他们实际不可用，
而本地门禁全绿（这个目录不被 manifest 引用，没有任何检查会碰到它）。

现在 `native-host/` 进了目录白名单，`host.py` / `install.py` / `README.md` 三个文件显式放行
（`INCLUDE_DIR_EXTRA`），「会不会进包」也收成**唯一**判据 `is_packable()` —— 打包、打包前校验、
打包后扫 zip 三处共用，不再各写一套过滤。zip 条目 20 → 23。

**走查时怎么确认**：A1 里解压出来的目录下就该有 `native-host\install.py`（不必再去仓库取）。

### F2 · 正文里的「隐形空白」会把磁力链接截断 —— 已修

原来 `MAGNET_RE` 用 `URL_STOP = [^\s"'<>）)】\]]+` 作边界，而 JS 的 `\s` **包含** U+FEFF
（复制粘贴带出的 BOM 型字符）、U+00A0（`&nbsp;`）、U+3000（全角空格）、U+2009 —— 站点恰恰常把
这些字符塞进 infohash 中间做反抓取，正则就在那里截断。

**这里纠正一处原先写错的判断**：截断串并不是「被 L2 当残缺串丢弃」，而是**被当合法磁力收下** ——
`parseMagnet` 只要求「hash 非空」，所以 `magnet:?xt=urn:btih:c12fe1aa`（8 位）会成为列表里的
一条。症状因此比「少一条」更坏：用户看到一条**点开下不动**的链接，页面上没有任何提示，
而它看起来是成功的。

| 插入的字符 | 严格正则拿到的串 | 修复前 | 修复后 |
|---|---|---|---|
| U+200B（ZERO WIDTH SPACE） | 完整 | 能解 ✔（它不在 `\s` 里） | 不变 ✔ |
| U+2060（WORD JOINER） | 完整 | 能解 ✔ | 不变 ✔ |
| **U+FEFF**（ZWNBSP / BOM 型） | 截断（结尾 `c12fe1aa`） | 半截 hash 的坏链接 ✘ | 完整 40 位 ✔ |
| **U+00A0**（`&nbsp;`） | 截断 | 同上 ✘ | 完整 ✔ |
| **U+3000**（全角空格） / **U+2009** | 截断 | 同上 ✘ | 完整 ✔ |

修法（`magnet-core.js::probeBodyMagnets`）：**只在严格候选解析出的 hash 长度不像有效 infohash
时**（v1 需 40 hex 或 32 base32，v2 需 ≥64 位偶数 hex）才试着跨过隐形空白把尾巴接回来，且接出
的候选必须自身也解析出像样的 hash 才采用，否则保持原样。于是：

- `链接 + &nbsp; + 另一条链接` 不会被粘成一条（两条各自都能解析，根本不触发修复）；
- `链接 + &nbsp; + 正文` 不会把正文吃进 hash（接不出来就放弃）；
- 被**真空格**拆开的残串不猜（猜错比不猜更坏）；
- 本来就能解析的链接行为一字不变（零回归）。

顺带堵住同一处缺陷的另一个面：被接走的尾巴若留在正文里，会被后面的 base64 / 裸 hash 扫描再当成
一个独立的「32 位裸 hash」收下 —— 一条链接变成两条（其中一条 hash 不完整）。所以
`probeBodyMagnets()` 会同时返回一份把「已认领尾巴」挖空的文本，供后续扫描使用。

**有意不覆盖**（不是遗漏）：被真空格拆开的串；`dn` / `tr` 参数里夹的隐形空白（只影响参数完整性，
客户端会忽略，且没有「长度」这种廉价判据可判）。

**走查时怎么确认**：C 段把 ① 的 `\u200b` 换成 `\ufeff`（或换成 `&nbsp;` 实体）再跑一次，
**预期在下载页看到完整的那一条**，而不是半截 hash 或两条。

---

## G. v1.4.0 新增能力（可选走查）

A–D 是发布前必须过的；下面四条是 `1.4.0` 的新能力，**建议顺手过一遍**（都不涉及注册 / 进程，
失败面小），尤其 G1 —— 它是设置页里唯一「点错就没救」的操作。

### G1 · 分项回滚：先给差异，再让你决定

1. 设置页 → **备份 / 恢复** → 先点一次「导出 JSON 备份」，存好。
2. 往下找到 **分项回滚** 卡片 → 「选择一个备份文件…」→ 选刚导出的那个文件。
3. **预期**：列出可恢复区块（规则 / 分组 / 收藏 / 已看 / 发现库 / 场景档位…），
   每个区块右侧多一列 **「恢复后（相对当前）」**：
   - 刚导出的备份应当显示 **「与当前一致」**（绿色）；
   - 若你先手工删掉一条规则再导入备份，该区块应显示 **`+1 新增`**；
   - 某区块若显示 **`−N 丢失`**（红色），**先不要点恢复** —— 记下它属于哪个区块并报回来
     （这是本轮新增的可见项，出现即说明该区块是 replace 型且当前有备份里没有的条目）。
4. 勾一个区块 → 点「恢复勾选的区块」→ **预期确认框里带着上面那些数字**
   （如「规则（+1 新增）」或「⚠ 有 N 项当前数据在备份里不存在 —— 恢复后会被丢掉」），
   而**不是只列区块名**。

> ✘ 的判据：确认框里只有区块名、或不显示「丢失」这项 —— 那说明干跑结果没接上确认框。

### G2 · 磁力归属到卡片

1. 打开一个列表页且有磁力的监管站点（或用 C 段「控制台注造」的办法，但这次注在**某一张卡内部**）。
2. **预期**：该卡片**右上角出现绿色 `磁 ×N` 角标**（N = 这张卡的磁力条数），
   其它卡片不带角标。
3. 在该卡片上**右键** → 菜单里有两项带数字：**「复制这张卡的磁力（N）」**、
   **「用下载工具打开这张卡的磁力（N）」**。
4. 点「复制这张卡的磁力」→ 粘贴出来应当是**这张卡**的磁力（多条时按信息完整度排序、合并成一段、
   含全部 tracker），而不是页面上所有卡的磁力。

> ✘ 的两个典型症状：① 角标出现在**所有**卡片上（归属没生效，退化成"页面有磁力就全标"）；
> ② 角标出现后页面**反复闪烁 / 卡顿**（说明标记插进了 DOM，触发了自己的 MutationObserver
> —— 正常实现是纯 CSS 伪元素，不会）。

### G3 · 规则命中时效画像

1. 设置页 → 规则管理，看规则表「命中」列。
2. **预期**：**有分桶数据的规则**在总次数下面多一行灰色小字「**近 30 天 N**」；
   **刚从旧版升级上来的规则不显示这一行**（不是显示 0）—— 这一条很关键，见下。
3. 规则体检卡片顶部汇总行会写明各类条数（如「发现 N 处可优化：X 条疑似无效 · Y 条近期失效 ·
   Z 条可能过宽 · W 条样本集从未命中」）。
4. 数据看板 → 月度回顾，「本月还在命中的规则 Top 5」标题：
   **有分桶数据时不带后缀**（算的是精确本月增量）；
   **纯老数据时带「（近似）」**，旁边说明写明为什么是近似。

> ✘ 的判据（**最需要盯的一条**）：升级后所有老规则都被报成「近期失效」——
> 那说明「无分桶数据」被当成了「近 30 天 0 命中」。
> v7 之前的规则没有 `hitDays`，**判据必须是「有数据且为 0」而不是「计数为 0」**。
> 预期表现：老规则**不显示**「近 30 天」这一行，且**不进**近期失效列表。

### G4 · iframe 子框架里也探测

1. 找一个**把内容放在 `<iframe>` 里**的页面。手边没有现成的，可以用本地文件造：
   建一个 `outer.html`，里面写一个 `<iframe src="inner.html">`；`inner.html` 里放一条
   `magnet:?xt=urn:btih:<40位hex>&dn=示例&tr=udp%3A%2F%2Ftracker.example%3A80` 的纯文本链接。
2. 用扩展打开 `outer.html` → 面板「下载」页。
3. **预期**：
   - 那条磁力**出现在列表里**（主文档里没有它，只可能在子框架里被探测到）；
   - 列表上方**注明「含 N 条来自子框架」**（`N ≥ 1`）；
   - 名称 / hash / tracker 都正确（说明是**结构化上报**，不是把子框架的 HTML 当文本抓回来）。
4. 把 `inner.html` 里的磁力删掉（或把 `probeAnySite` 探测开关关掉）后**刷新**：
   **预期列表里它消失、不留残影**（子框架会补报一次空，顶层从零重放）。

> ✘ 的三个典型症状：① 子框架里的磁力**完全收不到**（`all_frames` 没生效）；
> ② 同一个种子在 iframe 内外各出现一次变成**两条**（没走同一条 `infohash` 归并）；
> ③ 删掉后**列表里还留着那条**（残影，说明没处理"子框架清空"）。
> 另外：子框架**不应该**在 iframe 内部画任何标记 / 应用屏蔽规则 —— 若看见 iframe 内容被屏蔽，
> 那是越界（子框架只探测）。
