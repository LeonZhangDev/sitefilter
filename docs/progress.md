# Project Progress

## Current Status

- XChina Collector integration is implemented on `main` in **both** repositories and pushed to the public
  remotes (`LeonZhangDev/sitefilter`, `LeonZhangDev/universal-web-collector`), verified 2026-09-23 with
  `git ls-remote`. The earlier "not merged / not published" status no longer applies.
- The integration's user-facing notes are released under `1.3.0` (2026-09-23), with a `1.3.1` patch
  on 2026-09-24 (the Tier B native host is now shipped in the zip; body-text magnets split by
  invisible whitespace are no longer truncated). `manifest.json` carries `1.4.0` (2026-09-24) —
  four feature additions (rollback diff preview / magnets attributed to their card / hit-recency
  rule health / iframe sub-frame probing) plus the CI fix below. `1.4.0` raises the data structure
  to `schemaVersion: 7` (per-rule `hitDays`), migrated automatically, **history not backfilled**.
- **GitHub Actions had never been green** until 2026-09-24 — 15 runs, all failures, from the day the
  workflow landed (2026-09-22). Root cause: 12 test files hard-coded the developer machine's absolute
  path in a `const EXT = '...'` prologue; 3 of them actually used it and crashed
  on Linux (`readFileSync` ENOENT), 9 declared it without using it (same latent trap). All 12 now use
  `__dirname`. Verified two ways: (a) copying the repo to a fresh `%TEMP%` path, and (b) — the
  decisive one — copying it into WSL (`node v22.23 / python 3.12`, i.e. ≈ `ubuntu-latest`) and
  running `python3 ci.py` there: every suite green, exit 0. (The assertion count of that run is
  deliberately not quoted here — it changes with every commit, see Verification below.)
  Consequence: any earlier statement that this repository passed in CI was untrue, and
  "local `python ci.py` is green" does **not** imply the CI job is green.
- Task 10 browser behavior and output integrity passed, but the data-retention gate remains open: Tasks 1–3 were previously verified and later found missing from the same live database and numbered download root. The deletion source is unknown and awaits user clarification. Task 4 remains the current retained live acceptance task.

## Verification

- SiteFilter: 24 suites, 1404 assertions, zero failures, plus package validation.
  (2026-09-24 updated: **三线调研 → 只吸收真正缺的 4 条**。产品线分头调研（过滤器线对标
  EasyList / AdGuard、档案线对标 local-first + Yamtrack / Trakt、管道线对标 *arr）共提出 13 条
  候选，**逐条去代码里核过之后 9 条其实早已实现**（云同步 / 明文 JSON 导出 / 站点个人页导入 /
  已看时间戳 / 撤销回退 / 规则分层 / 补足限额 / 质量偏好权重 / 死规则判定）—— 记下来是为了
  下次别再照清单开工。真正补的 4 条：① 规则动作 **`allow`（放行 / 例外）**，语义同 `@@`，
  命中即压过所有屏蔽规则、**刻意不参与「首条命中生效」排序**（逃生门排第几位都该生效）、
  只解屏蔽不阻断收藏高亮、命中**也计入命中数**（否则被规则体检误报成死规则）；② **影片级
  评分 / 备注** `codeMarks`，打分经 `cooc` 的 女优 ↔ 作品 关系**折算成对参演者的推荐反馈**
  （4~5★ 正 / 1~2★ 负 / **3★ 中立不记**），纯本地映射；③ **「弃」`dropped`**，番号级否定，
  **唯一优先级高于 `allow` 的判定**（具体的决定压过宽泛的例外）、**不吃「仍然查看」**、
  隐藏来源记 `drop`；④ **规则包来源可追溯**（`rule.pack` = 包 id + 版本 + 导入时间，
  规则列表以 📦 脚注显示；改包内容要抬 `version`）。数据结构 **7 → 8**（两个新字段，纯加法、
  历史不回填）。四项均纯本地、零网络。)
  (2026-09-24 updated: **新增的 windows 腿第一次跑就抓到一个真 bug，已修** ——
  GitHub 的 `windows-latest` 是 en-US locale ⇒ Python 的 stdout 编码是 **cp1252** ⇒
  `print('门禁')` 直接 `UnicodeEncodeError` 崩在**第一行**，整套测试一条都没跑
  （开发机是中文 Windows / cp936，永远复现不了）。修法：三个 Python 入口钉 UTF-8 输出，
  `run()` 给子进程带 `PYTHONIOENCODING=utf-8`；`_test_ci_gate.py` 新增 3 项**在真 cp1252
  环境里跑**的断言。复现手法：`PYTHONIOENCODING=cp1252 python ci.py`。
  另：本地用 `git clone` 到临时目录模拟了 runner 的检出形状（`core.autocrlf=true` ⇒
  `.js/.py/.md` 检出为 CRLF，而 `.githooks/*` 与 `*.yml` 靠 `.gitattributes` 保持 LF），
  在该形状下门禁同样全绿 —— LF 工作区里跑绿**不能**证明 CRLF 下也绿。)
  (2026-09-24 updated: **防假绿 + 不变量加固**，产品行为零变化，版本号与 `schemaVersion` 均未动。
  ① 「`exit 0` 但零断言」现在判红 —— 判据从 `run_tests()` 的闭包抽成模块级纯函数
  `classify_suite()`，四种结局（`ok`/`fail`/`crash`/`empty`）分开，`empty` 按失败处理；
  此前「一条断言都没跑」与「全都过了」在门禁里长得一模一样。② 新增 `[0/5] git 卫生`：
  门禁读过的文件、会进包的文件、**每条 workflow** 都必须已在 git 里且不被 `.gitignore` 命中 ——
  这是「本地绿、CI 红」的通类（CI 是全新 checkout）。③ `options.html` / `popup.html` 的本地引用
  也进包校验。④ `ci.yml` 收紧：`npm ci` 取代 `npm install`、`permissions` 只读、`concurrency`
  取消旧 run、矩阵收成 ubuntu + windows 各一条腿（Node 22 / Python 3.12）；`release.yml` 同步
  —— 它是第二条会红的路径。⑤ 新增 `_test_ci_gate.py`（40+ 项）与 `.githooks/pre-push`；
  `_test_assembly.js` 的绝对路径扫描面扩到全部源码 + 每条 workflow，workflow 守卫改为遍历
  `.github/workflows/*.yml` 而不是只盯 `ci.yml`。)
  (2026-09-24 updated: `1.4.0` —— 四条功能深化落地：① 分项回滚前先给差异（`sectionDiff()` 纯干跑，
  列出每个区块 `+新增 / ~覆盖 / −丢失`，并把后果写进确认框）；② 磁力归属到卡片
  （纯 CSS 伪元素角标，不插 DOM 以免自激 `MutationObserver`；归属在归并时一并算出，
  去重后仍认得出是哪张卡）；③ 规则命中时效画像（数据结构 **6 → 7**，每条规则补 `hitDays`
  按天分桶，规则表「近 30 天 N」+ 规则体检第 ④ 类「近期失效」+ 月度回顾精确本月增量；
  **严格区分「无数据」与「0 命中」**，否则老规则升级后会集体误报失效；**历史不回填**）；
  ④ iframe 子框架内也探测（`all_frames: true`，子框架只探测、不建 UI 不应用规则；
  经后台按 `sender.frameId` 转发回顶层，走同一条 `pushLink` 归并；不用页面可伪造的
  `window.top.postMessage`；子框架清空会上报空以清残影）。
  另修 GitHub Actions（见下方 Current Status 第 2 条）与 `_test_sites.js` 里写死的版本号判据
  （「三处一致」只许 `_test_docs.js` 一处判据，重复的那处按口径删除而非更新数字）。)
  (2026-09-24 updated: `docs/requirements/003` 的建议清单里删掉了附记的磁力纵深提案 ——
  磁力侧止于 ⑧ 已落地的 Tier A/B，不再单列提案；守卫黑名单加一条防它被写回。
  另：`_test_docs.js` 的守卫范围补到 `docs/verify/manual-acceptance.md` ——
  此前这份「照着它跑真机」的清单里，标题版本、断言总数、A0 的「25 项」都停在 v1.3.0 时代。
  现在清单的**标题版本**与**每处「N 套」**由守卫盯着（且套数算法收成唯一一份），
  断言总数则不再写死、改指向 `ci.py` 的实际输出 —— 它判不了，必过期。
  守卫 19 → 25 项断言（v1.4.0 又补 2 条过期声明黑名单：此文件里曾出现的那句「CI 全绿」的说法，
  以及 README 里「逐月增量没有单独记录」—— 后者在 v7 按天分桶后已不成立）。
  > 注意本行**不能把被拉黑的原话照写出来**（哪怕只是为了说明"这两个词不许再出现"）——
  > 守卫判的就是这个字符串在不在文件里，写出来就会自己把自己判红。这是它第二次绊在自己的
  > 解释性文字上（上一次是 `_test_assembly.js` 的注释里出现了 `window.top.postMessage`）。
  (2026-09-24 updated: 修掉两条「本地门禁全绿、用户侧不可用」的缺陷 —— ① 发布包缺
  `native-host/`（Tier B 的本机桥没随包分发，用户照设置页提示找不到 install.py）；
  ② 正文里的隐形空白（U+FEFF / `&nbsp;` / 全角空格）会把磁力链接截断，而半截 hash 会被当
  合法磁力收下（一条点开下不动的链接）。打包范围收成单一判据 `is_packable()`；
  正文探测改走 `probeBodyMagnets()`。)
  (2026-09-23 updated: 拆 content.js —— 磁力解析层抽成 `magnet-core.js`，站点表与全部派生抽成
   `site-templates.js`（content / background / options 三端共用，不再有手抄副本）；
   `_load.js` 增加 backgroundBundle()，`_test_assembly.js` 装配守卫补上 service worker 侧。
   门禁 22 套 / 1141 项断言全绿（当时），打包 182 KB。)
  (2026-09-22 updated: 需求 002 三档屏蔽 L1、番号站数量补足 L2、建议 ②④⑤ 已落地；
   磁力深度 L2 全字段解析 + L4 同 infohash 归并/排序已落地，新增 `_test_magnet.js`。)
- SiteFilter feature work is on `main` and pushed to the public remote. The four features above are
  **implemented and released as `1.4.0`** (2026-09-24) — version number only, no tag, matching this
  repository's history (`1.0.1` / `1.1.0` / `1.2.0` carry no tags either).
  > **Correction (2026-09-24)**: this line used to claim the work was passing in CI. It was not —
  > the GitHub Actions workflow had **never** produced a green run (15 attempts, all failures).
  > The workflow was fixed on 2026-09-24; "local `python ci.py` is green" never implied CI was green.
  (2026-09-23 updated: 拆 `content.js` 完成 —— 磁力解析层抽成 `magnet-core.js`，站点表与全部派生抽成
  `site-templates.js`，三端共用同一份，不再有手抄副本。文档里的「未合并 / 未推送」说法已随之更正。)
- Universal Web Collector: 692 passed, 1 skipped, with one upstream deprecation warning. The final focused shutdown and HLS review suite passed 51 tests with no blocker.
- Real gallery acceptance: Task 1 previously completed 82/82 resources with nonzero hashed files; its task record and output directory are no longer present.
- Real video acceptance: Task 2 previously captured the truncated-output defect, and Task 3 previously completed with a full 5,442-second playable output. Both records and output directories are no longer present.
- Fresh Edge Task 4 completed 1/1 at 789,583,673 bytes. SHA-256 was `6dad4dcb5b1430f63d4e5c488bf5da063e8d960107644b029dd52715138b8148`; `ffprobe` reported 5,442.130431 seconds, H.264 1280x720 video, and AAC audio.
- Task 4 also passed UI restoration, task deep-link, repeat confirmation/cancel, an actually observed single terminal notification, and no duplicate after reload/restart.
- The normal installer/self-check succeeded and left both Chrome and Edge registrations plus an owned/ready runtime on port 8000.

## Durable Decisions

- [Native Host proxy and Collector identity ownership](decisions/2026-09-22-native-host-proxy-and-collector-identity-ownership.md)
- Collector remains the only owner of canonical content identity, tasks, downloads, and output integrity.

## Next Step

- Run the manual acceptance checklist (`docs/verify/manual-acceptance.md`) and report failures per
  its section E. **Start with the A segment** — it is the only part that can make an entire feature
  unusable, and its failure mode is silent (a click that does nothing).
- Clarify the missing Task 1–3 data-retention event with the user, without recovery or re-download
  unless separately authorized. Per `decisions/`, task records and the download root belong to the
  Collector side, so this is a Collector-side read-only investigation rather than a SiteFilter task.

The review-and-merge step is done (both branches are on `main` and pushed); `1.3.0` was cut on
2026-09-23 and the `1.3.1` patch on 2026-09-24 (version number only, no tag).

The magnet-depth proposal formerly listed as the last open item was **removed from
`docs/requirements/003-feature-suggestions.md` on 2026-09-24 at Leon's request**. Magnet support
ends at Tier A/B (system-default handler / specified downloader exe, with A as the fallback); no
further magnet-side proposal is pending. Do not re-open it as backlog.
