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
