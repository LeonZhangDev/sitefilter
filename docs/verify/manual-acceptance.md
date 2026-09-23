# 人工验收清单（v1.3.0）

`python ci.py` 现在是 **23 套 / 1158 项断言**，覆盖的是逻辑与协议。下面这四条链路
**自动化测不到**，只有在真浏览器里跑一次才算数：

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
| 扩展目录 | `dist/sitefilter-1.3.0.zip` 解压后的目录 | |
| 测试页 | 任意 `http(s)` 页面 | 磁力用例全部靠控制台注造，不依赖任何真实站点 |

**两个前提，先确认**（详见 F 段）：

1. **`native-host/` 不在发布包里。** `dist/sitefilter-1.3.0.zip` 只有 20 个条目，
   没有 `native-host/install.py`。跑 A 段必须手边有源码仓库。
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

- **预期**：末行 `本机桥（host.py）专项测试全部通过 ✅`，退出码 0（25 项）。
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

---

## F. 准备这份清单时已经发现的问题

这两条**不需要跑就知道**，一并记在这里，免得混进走查结果：

### F1 · 发布包缺 `native-host/`（会影响真实用户）

`make_package.py` 的 `INCLUDE_DIRS = ['icons']`，`dist/sitefilter-1.3.0.zip` 只有 20 个条目
（`collector-native.js`、`magnet-native.js` 在，但 `native-host/` 整个目录不在）。

后果：**从 zip 装扩展的用户拿不到 `install.py`**，而设置页却写着「请先运行
`native-host/install.py`」—— 他们找不到这个文件。Tier B 对这类用户实际不可用。

### F2 · 正文文本分支里的零宽字符会被截断（U+FEFF / U+00A0）

`MAGNET_RE` 用 `URL_STOP = [^\s"'<>）)】\]]+` 作边界，而 JS 的 `\s` **包含 U+FEFF 与 U+00A0**。
实测（`node` 直接跑正则）：

| 插入的字符 | 正文分支拿到的串 | 结果 |
|---|---|---|
| U+200B（ZERO WIDTH SPACE） | 完整（结尾 `77889901`） | 能解 ✔ |
| U+2060（WORD JOINER） | 完整 | 能解 ✔ |
| **U+FEFF**（ZWNBSP / BOM 型） | **截断**（结尾 `c12fe1aa`） | hash 残缺 → 被 L2「残缺串丢弃」→ **静默丢失** ✘ |
| **U+00A0**（NBSP） | **截断** | 同上 ✘ |

`decodeObfuscated` 第 ① 步确实会去 `\ufeff` 与 `\u00a0`，但**在正文路径上救不回来** ——
正则已经先截断，那两个字符根本不在候选串里。`<a href>` / `data-*` 分支读 `getAttribute`，
拿到的是完整串，所以**只有正文文本路径有这个缺口**。

这是「宣称支持零宽混淆」与实际能力之间的差：零宽里只有一部分（不在 `\s` 里的那些）能在正文路径上解出。
C 段可以顺手验证（把 ① 的 `\u200b` 换成 `\ufeff` 再跑一次，预期在下载页看不到那一条）。
