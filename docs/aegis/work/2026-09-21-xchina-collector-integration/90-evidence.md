# XChina Collector Integration — Evidence

## Task 0 — Repository Boundary

- SiteFilter root baseline: `52e1ce2dd95ce50de50f544f03c4b8a8fcd2a38d`.
- SiteFilter baseline: `PYTHONUTF8=1 python ci.py --out build-baseline` — 12 suites, 609 assertions, package validation passed.
- Collector baseline: `uv run pytest -q` — 512 passed, one existing Starlette deprecation warning, using a temporary Windows environment with test-only `httpx2`.
- Boundary review: specification compliant; code-quality re-review passed with no open findings.

## Worktree Setup

- SiteFilter branch/worktree: `codex/xchina-collector-integration`; `PYTHONUTF8=1 python ci.py --out build-worktree-baseline` — 609 assertions and package validation passed.
- Collector branch/worktree: `codex/xchina-collector-integration`; after environment-only `httpx2` installation, `uv run pytest -q` — 512 passed, one existing warning.
- The missing declared `httpx2` development dependency remains an observed baseline risk; no dependency or lockfile change was made.

## Task 1 — Canonical XChina Content Identity

- Collector commit: `5b4ef98429b40decffbf595e542c5a712e369a7a` (`[xchina] feat: canonicalize content identity`).
- Initial RED: `uv run pytest -q tests/test_content_identity.py` failed because `core.content_identity` did not exist.
- Review-driven RED: seven malformed-authority cases failed before hardening.
- Final GREEN: `uv run pytest -q tests/test_content_identity.py tests/test_collector_autoresolve.py` — 54 passed, one existing warning.
- Scope: exactly `backend/core/content_identity.py` and `tests/test_content_identity.py`.
- Review: amended implementation passed independent specification and code-quality re-review with no open findings.

## Task 2 — Atomic Duplicate Dispositions

- Collector commit: `c95cfbdc7084f47849ca4331657e636fe5ab9c8f` (`[tasks] feat: deduplicate canonical content tasks`).
- RED evidence covered missing schema/helper behavior, state/force-new counterexamples, mixed active/terminal history, spoofed identity, deterministic contention, and submission failure.
- Final GREEN: `uv run pytest -q tests/test_task_dedup.py tests/test_database.py tests/test_incremental.py tests/test_collector_autoresolve.py` — 77 passed, one existing warning.
- Compatibility: non-deduplicated callers remain always-create; canonical keys stay inside task options with no migration; caller-supplied keys are stripped and stored keys are recomputed.
- Review: independent specification and quality re-reviews passed with no Critical or Important findings.
- Residual risk: existing `TaskManager.submit()` can retain an in-memory `_active` entry if its executor rejects submission. Database state is changed to `failed`, so the disposition contract remains correct; cleanup inside `TaskManager` is outside Task 2's approved file boundary.

## Task 3 — Task Summary and Deep Links

- Collector commit: `39dc5752ac48208b3f9850b05a59597e7354f827` (`[tasks] feat: expose task summaries and deep links`).
- Backend: focused task-summary tests passed; full suite passed 562 tests with one existing warning.
- Frontend: task-query tests and production build passed; committed coverage includes missing, nonnumeric, unknown, unsafe-integer, decimal, and negative query IDs.
- Browser evidence: isolated task creation and `/?task=1` selected the matching row and rendered detail; `/` retained the unselected root behavior. Only owned processes and artifacts were cleaned afterward.
- Review: independent specification and quality reviews passed with no open findings.
- Existing environment notes: Vite CJS deprecation warning and npm audit findings (one moderate, one high) predate this dependency-free task.

## Task 4 — Native Startup and Idle Supervision

- Collector commit: `da5ac1150aa3c9598ba8735852781de35bffe7af` (`[runtime] feat: add native startup supervision`). The implementer initially reported a different full SHA suffix; repository `git rev-parse HEAD` is the authority recorded here.
- Tests: final WSL suite passed 30 with one platform skip; Windows native-runtime suite passed 12 with one platform skip.
- Live Windows evidence: two-process lock contention reached discovery without `PermissionError`.
- Live WSL evidence: stale readiness changed to `ready=false`, health plus Collector-specific config discovery succeeded, SIGTERM removed the owned child/descriptor and released the lock, and forced preflight failure left no descriptor/listener.
- Safety behavior: manual discovery remains `owned=false`; activity-query failures fail safe as busy; pre-child cleanup is exact-marker guarded; signal tests synchronize after handler installation.
- Review: independent specification and final quality re-review passed with no open findings.

## Task 5 — Allowlisted Native Messaging Host

- Collector commit: `f3356ccc3b5fe1d21b409c013b1c8fd046de8e38` (`[native-host] feat: bridge SiteFilter to Collector`).
- Cross-platform tests: 74 Host tests passed on Windows and 74 passed in WSL; Task 4 runtime regressions passed 13 with one platform skip.
- Subprocess evidence: normal ping, high/low surrogate IDs, and 5,000-level nested JSON all produced bounded framed behavior with no trailing stdout or traceback.
- Security evidence: exact six-action and origin allowlists, strict config/payload types, bounded response/discovery/descriptor reads, no redirects, query/fragment stripping before forwarding, secret-free categorical logging, strict JSON numbers/depth, and early launcher-exit detection.
- Compatibility: preview timeout is 150 seconds, covering the existing two-attempt 110-second path with margin; Host capability discovery matches the live Collector config shape.
- Review: independent specification and final security-quality reviews passed with no open findings.

## Task 6 — Guided Native Host Installation

- Collector commits: `cb1c0f38fa86b08cce295bde7aa9c14907bd152b`, `f4ce72168f479a903a5cb53c492aa9c8eaaea27b`, `3b788145af0cbe0098ea7119b54fa6e4f2533ce8`, `487fca8775a4a437a22f1077354e2c0002de95c9`, and final hardening `f00624723a2090c362fd11236d6b9d164378824b`.
- Runtime compatibility follow-up: `6786e9d1c066f8af0c1dd851489f3485fef61bf9` resolves an absolute WSL user `uv` path for native startup without changing normal `make start` behavior.
- Disposable verification: the complete installer harness passed under PowerShell 7 and Windows PowerShell 5.1, including zero-side-effect `-WhatIf` and rejected confirmation, exact owned-file/registry scope, idempotent removal, reparse rejection, transactional rollback, concurrent registry preservation, strict response rejection, and bounded no-output/partial-frame self-checks.
- Process safety: install/remove uses Linux pidfds to bind identity before exact cwd/executable/NUL-argv verification and TERM; unsupported pidfd APIs fail closed with no raw-PID fallback.
- Supply chain: Windows `uv` is pinned to 0.12.15 with a fixed SHA-256; WSL provisioning requires a preinstalled, version-verifiable `uv` and executes no mutable remote installer script.
- Real lifecycle: install, stopped-state startup, self-check failure after a new Collector start, cleanup, old-root/registry/runtime restoration, `-WhatIf`, uninstall, second idempotent uninstall, and full-provision reinstall all passed without elevation or Collector-data deletion.
- Browser bridge: strict Native Messaging ping passed in Chromium 153 and Edge 154 with the deterministic extension ID `jaihdgjnnpmiabeoefmihmjhoodcjlhf`; branded Chrome unpacked-extension acceptance remains explicitly assigned to Task 10.
- Regression: `tests/test_sitefilter_native_host.py` passed 74 tests after final installation; both final independent specification and security-quality reviews passed with no blocking findings.

## Task 7 — SiteFilter Native Transport

- SiteFilter commits: `b38ee1f6e52d919d03d92354fd05629c9e2742cd`, `e4e302006c6ba9d8ec12205909aa0762b982ce7e`, and final lifecycle fix `a9115bcbd301986b188b3d4756a822045733575c`.
- RED: the focused Node test failed before `collector-native.js` and its exported bridge existed.
- GREEN: `node _test_collector_native.js` passed 26 tests; writeback passed 24; migration passed 80; UTF-8 full CI passed 13 suites and 635 assertions with package validation.
- Identity/permissions: the fixed public manifest key derives extension ID `jaihdgjnnpmiabeoefmihmjhoodcjlhf`; `nativeMessaging` is present and no localhost host permission was introduced.
- Lifecycle: a single Native Messaging connection uses generation-scoped pending requests, rejects an entire failed generation immediately, disconnects when idle, reconnects safely, and ignores stale messages/disconnects.
- Persistence/notifications: storage is normalized to the minimal task schema, mutation failures recover, fixed notification IDs are retry-safe, and successful terminal delivery is persisted before cleanup.
- Background integration: tests execute the actual service worker routing, alarms, async `sendResponse`, notification click handling, and verify that task deep links remain behind the allowlisted Host action rather than direct tab URLs.
- Review: final independent specification and code-quality reviews passed with no blocking findings; live browser disconnect/notification timing remains assigned to Task 10.

## Task 8 — XChina Detail Controls and Preview

- SiteFilter commits: `3f0a683543861044f18954397f737967e017a779` and final page-identity fix `649a13b57c5efb179c577ea0aab1b80fa249fd17`.
- RED: the focused test failed because `xchina-download.js` did not exist.
- GREEN: the focused suite passed 45 tests, smoke passed 110, soft-block passed 23, and UTF-8 full CI passed 14 suites and 680 assertions with package validation.
- Scope: controls activate only on strict HTTPS XChina photo/video detail identities; non-target pages receive no slot or control DOM.
- UI: title and panel controls share state; photo supports automatic, image-only, and video-only policies; video uses its supported automatic/video policy; preview/confirmation is accessible with focus containment, Escape, and focus restoration.
- Race safety: preview/create operations bind an immutable page snapshot plus generation/token; SPA navigation removes the modal and ignores stale results without creating or updating the replacement page.
- Protocol safety: preview/create envelopes, exact identities, task IDs, dispositions, resource counts, and collector selection are validated before declaring success.
- Review: final independent specification and code-quality reviews passed with no blocking findings.

## Task 9 — Restoration, Recovery, and Guidance

- SiteFilter commits: `15db51a23470cc8c6a4ce34e7ce936ca2ce8a825`, `670bc7ba7af812370b2e5bdd57751ade33269f00`, and final polling isolation `9b5c79e8d350cda023a97e7cb48c1d8125a22231`.
- RED: new restore/login/notification assertions initially failed before the runtime/UI handlers existed.
- GREEN: Native transport passed 37 tests, XChina UI passed 79, and UTF-8 full CI passed 14 suites and 725 assertions with package validation.
- Collector regression: WSL full pytest passed 658 with one platform skip and one existing warning after restoring the known test-only `httpx2` environment dependency; no Collector source or protocol changed.
- Recovery: the page restores the latest matching task, continuously polls active tasks with single-flight page/operation isolation, and stops on terminal state, navigation, or teardown.
- User authority: completed redownload requires a second explicit confirmation before `force_new`; login starts only from an explicit button; missing Host guidance offers install steps and re-detection without opening a management page automatically.
- Privacy: browser cookies are never exported, and Collector absolute Windows/WSL output paths are validated but replaced with a fixed summary before any page DOM rendering.
- Notification semantics: a persisted delivery claim precedes notification creation, providing restart-safe at-most-once behavior; a crash in the claim/create gap may omit one notification rather than duplicate it, and explicit creation failure rolls back for retry.
- Review: final independent specification and code-quality reviews passed with no blocking findings.

## Task 10 — Real Chrome and Edge Acceptance

- Environment: branded Chrome 153.0.8010.52, branded Edge 154.0.4258.24, unpacked extension ID `jaihdgjnnpmiabeoefmihmjhoodcjlhf`, Ubuntu on WSL 2, Native Host ownership v3/protocol v1, Collector port 8000.
- Initial RED: after the safe Host uninstall, the approved photo detail showed visible installation guidance in Chrome and the approved video detail showed the Host-missing state in Edge. No Collector data was removed.
- Browser workflow: Chrome photo preview/create/repeated-click/reload/deep-link all passed on Task 1; Edge video preview/create/repeated-click/reload/deep-link passed on Task 2. Repeated actions reused the same task. A temporary `UWC_BROWSER_STATE_DIR` started and stopped one WSLg login UI without replacing saved state.
- Gallery GREEN: Task 1 restored as `success` with 82/82 resources and 42,182,156 bytes. The first and last file SHA-256 values were `54f9c66209ec9b0588e954900495deaee5da8e96434814d69945fb42b47b4c5a` and `f71b12ebc87283a1533183897b41ded1b6abffc43a1b30385066ce0c21b4f60f`.
- Video defect evidence: the original Task 2 exposed a real false-success path: ffmpeg exited 0 but produced only 270.024853 seconds from a 545-segment, approximately 5,442-second playlist. It was not treated as acceptance success.
- Video GREEN: normal force-new recovery Task 3 completed 1/1 resources at 789,583,673 bytes with SHA-256 `6dad4dcb5b1430f63d4e5c488bf5da063e8d960107644b029dd52715138b8148`. `ffprobe` reported 5,442.130431 seconds, H.264 1280x720 video, and AAC audio, exceeding the 99% playlist-duration integrity gate.
- Collector fixes discovered by live acceptance include browser TLS impersonation (`5791184`), fail-closed HLS completeness (`c11181d`, `81ca318`), bounded active-task shutdown (`6dec51d`, `065d4a4`), native-startup test isolation (`744e689`), and the declared TestClient dependency (`6960dde`).
- Automated GREEN: Universal Web Collector passed 692 tests with one skip and one upstream deprecation warning; the final shutdown/HLS quality review passed 51 focused tests with no blocker. SiteFilter passed 14 suites and 725 assertions plus package validation.
- Shutdown/installer GREEN: the normal installer completed self-check and left the Host registered for both Chrome and Edge with an owned/ready runtime on port 8000.
- Fresh Edge GREEN: explicit force-new confirmation created Task 4 through the Edge service worker. It completed 1/1 resources at 789,583,673 bytes under the task-relative output directory `downloads/4/`, with SHA-256 `6dad4dcb5b1430f63d4e5c488bf5da063e8d960107644b029dd52715138b8148`; `ffprobe` reported 5,442.130431 seconds, H.264 1280x720 video, and AAC audio.
- Task 4 UI/notification evidence: reload restored the completed state; the Host task deep-link returned opened; the repeat workflow reached the second force-new confirmation and was cancelled without creating Task 5. `chrome.notifications.getAll` observed exactly one `sf_collector_task_4` notification immediately after completion, while persisted `terminalNotified: true` prevented a duplicate after reload/restart.
- Retention discrepancy: Tasks 1–3 were successfully verified at the times described above, and an earlier installer restart restored them. They are now absent from the same live Collector database, `/tasks/1` through `/tasks/3` return not found, and numbered output directories 1–3 are absent while Task 4 remains. The deletion source is unknown. No recovery, cleanup, or re-download was performed during diagnosis.
- Idle evidence: three approved short-time injection cases ran from `2026-09-21T16:46:37.8503419Z` to `2026-09-21T16:46:45.4964040Z` and passed while the production Makefile retained `--idle-minutes 30`; this verifies the same boundary mechanism without blocking the acceptance turn for 30 minutes.
- Privacy: ignored evidence contains no committed media, cookies, saved browser state, absolute private output paths, or binaries. Output evidence uses task-relative locations only. A later site access-control response was not bypassed.
- Known non-blocking observation: Edge preview estimated the video as 16 bytes; final task creation and integrity were unaffected, but preview-size accuracy remains follow-up work.
- Acceptance decision: code quality, browser behavior, Task 4 output integrity, notification behavior, restart restoration, and normal installation passed. Overall Task 10 remains open pending user clarification of the Task 1–3 data-retention discrepancy.
