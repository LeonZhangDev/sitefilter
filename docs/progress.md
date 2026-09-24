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
  running `python3 ci.py` there: 23 suites, 1284 assertions, zero failures, exit 0.
  Consequence: any earlier statement that this repository passed in CI was untrue, and
  "local `python ci.py` is green" does **not** imply the CI job is green.
- Task 10 browser behavior and output integrity passed, but the data-retention gate remains open: Tasks 1–3 were previously verified and later found missing from the same live database and numbered download root. The deletion source is unknown and awaits user clarification. Task 4 remains the current retained live acceptance task.

## Verification

- SiteFilter: 23 suites, 1284 assertions, zero failures, plus package validation.
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
