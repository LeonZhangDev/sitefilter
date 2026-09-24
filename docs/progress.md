# Project Progress

## Current Status

- XChina Collector integration is implemented on `main` in **both** repositories and pushed to the public
  remotes (`LeonZhangDev/sitefilter`, `LeonZhangDev/universal-web-collector`), verified 2026-09-23 with
  `git ls-remote`. The earlier "not merged / not published" status no longer applies.
- The integration's user-facing notes are released under `1.3.0` (2026-09-23), with a `1.3.1` patch
  on 2026-09-24 (the Tier B native host is now shipped in the zip; body-text magnets split by
  invisible whitespace are no longer truncated). `manifest.json` carries `1.3.1`.
- Task 10 browser behavior and output integrity passed, but the data-retention gate remains open: Tasks 1–3 were previously verified and later found missing from the same live database and numbered download root. The deletion source is unknown and awaits user clarification. Task 4 remains the current retained live acceptance task.

## Verification

- SiteFilter: 23 suites, 1201 assertions, zero failures, plus package validation.
  (2026-09-24 updated: `_test_docs.js` 的守卫范围补到 `docs/verify/manual-acceptance.md` ——
  此前这份「照着它跑真机」的清单里，标题版本、断言总数、A0 的「25 项」都停在 v1.3.0 时代。
  现在清单的**标题版本**与**每处「N 套」**由守卫盯着（且套数算法收成唯一一份），
  断言总数则不再写死、改指向 `ci.py` 的实际输出 —— 它判不了，必过期。
  清单 19 → 22 项断言。)
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
- SiteFilter feature work is on `main` and pushed to the public remote. It is **implemented, CI-green,
  and released as `1.3.1`** — version number only, no tag, matching this repository's history
  (`1.0.1` / `1.1.0` / `1.2.0` carry no tags either).
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

Decided against, recorded in `docs/requirements/003-feature-suggestions.md`: magnet depth **L5**
(local magnet library + hand-off to Collector for P2P download). Tier A/B already cover the original
request; L5 would need a P2P stack inside Collector, whose download stack is HTTP-gallery oriented,
and it is blocked by environment (no BT client or downloader here) plus a concurrent Collector
session. Reopen only when a BT tool is installed and the Collector side agrees to extend the bridge.
