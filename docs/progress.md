# Project Progress

## Current Status

- XChina Collector integration implementation and code-quality review are complete in the SiteFilter and Universal Web Collector `codex/xchina-collector-integration` feature worktrees.
- The feature has not been merged into either saved-project checkout and has not been published.
- Task 10 browser behavior and output integrity passed, but the data-retention gate remains open: Tasks 1–3 were previously verified and later found missing from the same live database and numbered download root. The deletion source is unknown and awaits user clarification. Task 4 remains the current retained live acceptance task.

## Verification

- SiteFilter: 21 suites, 1108 assertions, zero failures, plus package validation.
  (2026-09-22 updated: 需求 002 三档屏蔽 L1、番号站数量补足 L2、建议 ②④⑤ 已落地；
   磁力深度 L2 全字段解析 + L4 同 infohash 归并/排序已落地，新增 `_test_magnet.js`。)
- SiteFilter feature work landed on `codex/xchina-collector-integration`; it is **implemented and CI-green
  but not committed to main, not pushed, and not released** (per user's completion criterion).
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

Clarify the missing Task 1–3 data-retention event with the user, without recovery or re-download unless separately authorized. Then review and merge the two feature branches together. Do not describe the saved-project checkout or any release channel as updated until that merge and a separate publication step actually occur.
