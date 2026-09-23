# 自定义下载器本机桥（Tier B）

让 SiteFilter 用**你指定的**下载器（迅雷 / μTorrent / qBittorrent …）打开磁力，而不是只能唤起「系统默认」那一个。

## 为什么需要它

浏览器扩展（MV3）**无法启动任意 exe**。它能做的只有一件事：把 `magnet:` 交给操作系统里**已注册的默认 magnet 处理程序**（这就是扩展里的 Tier A，「打开」按钮）。

想"指定用迅雷而不是 μTorrent"，必须让浏览器经 **Native Messaging** 把磁力交给本机一个小程序，由它去 `Popen([你的exe, magnet])`。这个目录就是那个小程序。

```
扩展（设置里填了下载器路径）
   │  chrome.runtime.sendMessage({type:'sf_magnet_open', ...})
   ▼
background.js → magnet-native.js → chrome.runtime.connectNative('dev.zackzhang.sitefilter_magnet')
   ▼
native-host/host.py  ← 本机桥，只做 open-magnet
   │  校验：magnet 是 magnet:? 开头；client 是绝对路径、真实存在、扩展名在白名单
   ▼
subprocess.Popen([你的下载器.exe, magnet])   ← 不走 shell，detached
```

## 安装

```bat
python native-host\install.py
```

脚本做的事（全部在**当前用户**范围内，**不需要管理员**）：

1. 生成 `host.bat`（用当前 Python 拉起 `host.py`）。
2. 生成 `dev.zackzhang.sitefilter_magnet.json`（host 清单，`allowed_origins` 只放行 SiteFilter 扩展）。
3. 写注册表 `HKCU\Software\{Google\Chrome | Microsoft\Edge | Chromium}\NativeMessagingHosts\dev.zackzhang.sitefilter_magnet`。

先看一遍将写入什么、不落盘：

```bat
python native-host\install.py --print
```

卸载（删注册表项，保留文件）：

```bat
python native-host\install.py --uninstall
```

> **装完要重启浏览器**，扩展才能看到新注册的本机桥。

## 使用

1. 打开扩展**设置页 → 通用设置 → 自定义下载器路径**，填下载器 exe 的**绝对路径**，例如：
   - 迅雷：`C:\Program Files (x86)\Thunder Network\Thunder\Program\Thunder.exe`
   - μTorrent：`C:\Users\<你>\AppData\Roaming\uTorrent\uTorrent.exe`
   - qBittorrent：`C:\Program Files\qBittorrent\qbittorrent.exe`
2. 点旁边的**「测试本机桥」**，返回 `ok` 即通。
3. 磁力行的「打开」按钮就会走你指定的下载器。

**留空 = 用默认**：路径为空时，扩展退回 Tier A（唤起系统默认 magnet 处理程序），**本机桥完全不需要装**。

## 安全边界

这个 host 能被扩展唤起，所以刻意收紧了：

- 只有注册在 `allowed_origins` 里的扩展能连上。
- 只接受 `open-magnet` / `ping` 两个 action。
- `magnet` 必须是 `magnet:?` 开头、长度 ≤ 8192、无控制字符。
- `client` 必须是**绝对路径**、真实存在的**文件**、扩展名 ∈ `{.exe .com .bat .cmd .lnk}`。
- 用 `Popen(list)` 启动，**不走 shell**，参数不会被当命令解析。
- 启动的进程 `DETACHED`，宿主退出后下载器继续跑。

## 与 collector 桥的区别

扩展里**有两条独立的本机通道**，互不影响：

| | host 名 | 用途 |
|---|---|---|
| collector 桥（`collector-native.js`） | `dev.zackzhang.sitefilter_collector` | 把媒体交给 Universal Web Collector 真下载 |
| **本桥**（`magnet-native.js`） | `dev.zackzhang.sitefilter_magnet` | 用你指定的下载器打开磁力 |

分开是为了让磁力唤起不被 collector 的 URL 白名单（目前只放行 `xchina.co`）绑住。
