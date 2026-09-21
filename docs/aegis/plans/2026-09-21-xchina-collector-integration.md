# XChina Collector Integration Implementation Plan

## Goal

Add safe one-click XChina photo/video downloads to SiteFilter, automatically starting Universal Web Collector in WSL through a per-user Windows Native Messaging Host while preserving Collector as the sole owner of parsing, task state, login state, downloading, and output settings.

## Architecture

SiteFilter content UI sends versioned requests to its Manifest V3 service worker. The worker keeps a `chrome.runtime.connectNative()` channel to a small installed Windows executable. The executable validates the request, starts the selected WSL Collector through `make start-native` when needed, and proxies only allowlisted Collector operations. Collector performs atomic content-identity duplicate handling and returns task state. SiteFilter renders summary progress and notifications.

## Tech Stack

- SiteFilter: Chrome/Edge Manifest V3, vanilla JavaScript, HTML/CSS, Node + jsdom tests, Python packaging gate.
- Collector: Python 3, FastAPI, SQLite, Vue 3, Playwright, pytest, uv, Make.
- Bridge: Python source packaged as a Windows executable with PyInstaller, Native Messaging binary framing, PowerShell installer/uninstaller, `wsl.exe` startup.
- Target: Windows 11, WSLg, unpacked Chrome and Edge extensions.

## Baseline/Authority Refs

- `docs/requirements/001-xchina-collector-integration.md`
- `docs/aegis/specs/2026-09-21-xchina-collector-integration-design.md`
- `docs/aegis/baseline/2026-09-21-initial-baseline.md`
- SiteFilter `README.md`, `manifest.json`, `content.js`, `background.js`, `make_package.py`, `ci.py`
- Collector `README.md`, `Makefile`, `scripts/start.py`, `backend/api/tasks.py`, `backend/models/schemas.py`, `backend/core/database.py`, `backend/core/task_manager.py`, `frontend/src/App.vue`

## Compatibility Boundary

- Existing `/tasks/create` callers keep always-create behavior unless `deduplicate=true` is supplied.
- Existing SiteFilter filtering, storage, popup, options, rule matching, and packaging continue unchanged.
- The extension does not gain localhost host permissions or CORS exceptions.
- Existing manually started Collector processes are discovered but never terminated by native idle management.
- SiteFilter never parses XChina media URLs or reads browser cookies.

## Verification

- SiteFilter: `python ci.py --out build-plan-check`
- Collector: `uv run pytest -q`
- Collector frontend: `cd frontend; node scripts/test-task-query.mjs; npm run build`
- Native host: unit protocol tests plus a packaged-executable round trip in Chrome and Edge.
- End to end: full download and output verification for the approved photo and video URLs.

## Aegis Visibility

Planning is necessary because this change introduces a security-sensitive native adapter, a cross-project API contract, WSL process ownership, installation state, and a real-download verification boundary.

## Plan Basis

- Fact: Collector already resolves and downloads XChina gallery and video URLs and exposes preview/task/session APIs.
- Fact: current `make start` opens a browser, waits in the foreground, and reports a dynamically selected port only as human-readable output.
- Fact: SiteFilter currently has no `nativeMessaging` permission or native client.
- Assumption to verify in Task 0: both existing test gates are green before source edits.
- Unknown resolved by installer testing: whether each target machine's WSL localhost forwarding is usable; installation must fail actionably if it is not.

## BaselineUsageDraft

- Required baseline refs: approved requirements, approved design, initial baseline.
- Delivered context refs: all user decisions captured in FR-1 through FR-11.
- Acknowledged before plan refs: SiteFilter/bridge/Collector ownership split and real-download acceptance.
- Cited in plan refs: requirements, design, baseline, current runtime owners.
- Missing refs: none blocking.
- Decision: continue.

## Requirement Ready Check

- Requirement source refs: `docs/requirements/001-xchina-collector-integration.md`.
- Goals and scope refs: Overview and User Stories.
- User/scenario refs: User Stories 1-7.
- Requirement item refs: FR-1 through FR-11.
- Acceptance refs: Testing section and approved real URLs.
- Open blocker questions: none.
- Decision: ready.

## Files

### SiteFilter repository

- Create `.gitignore` only if an independent repository is initialized.
- Modify `manifest.json`, `background.js`, `content.js`, `content.css`, `make_package.py`, `README.md`, `CHANGELOG.md`.
- Create `collector-native.js` for native transport/state ownership.
- Create `xchina-download.js` for detail-page UI ownership.
- Create `_test_collector_native.js` and `_test_xchina_download.js`.
- Modify documentation indexes and approved requirement/design status.

### Universal Web Collector repository

- Modify `backend/models/schemas.py`, `backend/api/tasks.py`, `backend/main.py`, `backend/core/database.py`, `frontend/src/App.vue`, `frontend/package.json`, `Makefile`, `scripts/start.py`, `README.md`.
- Create `backend/core/content_identity.py` and `backend/core/task_dedup.py`.
- Create `backend/api/runtime.py` only for a read-only machine runtime summary if existing task/watch APIs cannot express idle state cheaply.
- Create `integrations/sitefilter-native-host/host.py`, `host-manifest.template.json`, `install-native-host.ps1`, `uninstall-native-host.ps1`, and `README.md`.
- Create `tests/test_content_identity.py`, `tests/test_task_dedup.py`, `tests/test_task_summary.py`, `tests/test_native_runtime.py`, and `tests/test_sitefilter_native_host.py`.
- Create `frontend/src/task-query.mjs` and `frontend/scripts/test-task-query.mjs`.

## Change Necessity

- User-visible need: a web extension must start WSL software and create reliable tasks without manual preparation.
- No-change option: opening Collector or copying the URL manually does not satisfy automatic startup and task creation.
- Why code is necessary: browser extensions cannot spawn WSL processes; current Collector startup and task API do not expose the required native readiness, duplicate disposition, or idle lifecycle contract.
- Minimum boundary: one browser transport owner, one native host, existing Collector API/startup owners plus isolated identity/dedup helpers.
- Decision: code-change.

## Existence Check

- Proposed new surface: Native Messaging Host.
- Reuse candidate: direct localhost API plus current `make start`.
- Why insufficient: direct localhost adds permissions/CORS/port discovery and cannot start WSL; current start opens UI and has no machine contract.
- Creation proof: Chrome/Edge Native Messaging is the supported extension-to-native boundary.
- Entropy/retirement: one narrow bridge; no fallback transport is retained.
- Decision: add-with-proof.

## Architecture Integrity Lens

- Invariant: Collector is the only canonical owner of media discovery, content identity, duplicate decisions, tasks, and downloads.
- Canonical contract: versioned native actions proxy explicit Collector capabilities.
- Overlap check: provisional URL recognition in SiteFilter is UI-only and cannot make canonical download decisions.
- Higher-level simplification: extend existing create/preview/session contracts rather than creating a second task service.
- Retirement/falsifier: any direct localhost fallback, arbitrary command proxy, or SiteFilter media extraction must be rejected.
- Verdict: aligned.

## Ripple Signal Triage

- Manifest change affects packaging validation and extension reinstall/reload behavior.
- Task-create response changes affect Vue API client typing and existing task tests.
- Startup changes affect Windows, Linux/macOS `make start`, and manual developer workflows; native flags must remain opt-in.
- Idle logic affects subscriptions and paused tasks; both require explicit tests.
- Result: expand verification across SiteFilter packaging, all Collector tests, frontend build, Chrome, Edge, WSL startup, and subscriptions.

## Plan Pressure Test

- Owner/contract/retirement: explicit and bounded; no fallback transport retained.
- Architecture integrity: Collector remains source of truth.
- Verification scope: unit, integration, package, two-browser, two real downloads.
- Task executability: tasks are ordered with RED/GREEN gates and scoped commits.
- Pressure result: proceed.

## Plan-Time Complexity Check

### Complexity Budget

- Artifact class: source, test, distribution, and process artifacts.
- Target pressure: SiteFilter `content.js` (~172 KB) and `background.js` (~34 KB); Collector `tasks.py` and `App.vue` are mixed-purpose owners.
- Projected pressure: over-budget if native protocol or XChina UI is implemented inline.
- Budget result: at-risk.
- Governance: create `collector-native.js`, `xchina-download.js`, `content_identity.py`, and `task_dedup.py`; existing large files receive wiring-only edits.

### Recommendation

- `content.js`: wiring-only panel slot/event integration.
- `background.js`: wiring-only import/message dispatch.
- `tasks.py`: schema-to-helper wiring only.
- `App.vue`: bounded task-query deep-link handling.
- New owner files: protocol, page UI, identity, deduplication, installation.

## Execution Readiness View

- Intent Lock: implement only the approved XChina-to-Collector workflow.
- Scope Fence: Windows 11 + WSLg, Chrome + Edge, unpacked SiteFilter, XChina photo/video details.
- Baseline Lock: approved requirement and design documents.
- Approved Behavior: one-click, preview, silent startup, status, notifications, duplicates, login recovery, 30-minute idle exit.
- Owner Constraints: no downloader or cookie logic in SiteFilter; no task database in bridge.
- Compatibility Boundary: opt-in API changes and unchanged manual startup.
- Retirement Boundary: no direct-localhost or alternate parser fallback is introduced.
- Task Batches: baseline; Collector contracts; startup; native host/install; SiteFilter transport/UI; integration verification.
- Test Obligations: existing gates plus native framing, install, both browsers, subscriptions, and full real downloads.
- Review Gates: after Collector contract, after packaged host, after SiteFilter mocked integration, before real downloads.
- Drift Rules: if canonicalization or login requires browser-cookie copying, stop and return to design; if localhost forwarding fails, fix installer/startup rather than add direct extension HTTP.
- Evidence: command output, task IDs/statuses, notification screenshots, final file inventory, playable video probe, idle-exit process evidence.
- Advisory Boundary: execution guidance only; completion still requires runtime evidence.

## Tasks

### Task 0: Establish safe baselines and repository boundaries

**Files:** SiteFilter `.gitignore`; no Collector source edits.  
**Why:** preserve current user files and obtain reliable RED/GREEN evidence.  
**Change Necessity:** SiteFilter is currently untracked inside `C:/Users/admin`; an independent repository boundary is required before atomic commits.  
**Impact/Compatibility:** do not add the nested repository to the parent home-directory repository.

- [x] **Write the boundary check.** Create `.gitignore` with `node_modules/`, `dist/`, `build*/`, `.playwright-cli/`, `*.zip`, and generated Native Host binaries; run `git -C C:\Users\admin\Desktop\site-filter rev-parse --show-toplevel` and record the current parent root.
- [x] **Verify RED.** Run `git -C C:\Users\admin\Desktop\site-filter status --short -- .`; expected precondition is `?? ./`, proving SiteFilter has no independent history.
- [x] **Create the minimum boundary.** Run `git -C C:\Users\admin\Desktop\site-filter init -b main`, then `git add .` and inspect `git status --short`; ensure `node_modules` and `dist` are absent.
- [x] **Verify GREEN.** Run `python ci.py --out build-baseline` and `uv run pytest -q` from the Collector repository; require both gates to pass before feature edits.
- [x] **Commit.** In SiteFilter run `git commit -m "[repo] chore: establish project baseline"`. Do not commit or stage anything in `C:\Users\admin` outside the nested repository.

### Task 1: Add canonical XChina content identity

**Files:** create Collector `backend/core/content_identity.py`, `tests/test_content_identity.py`.  
**Why:** pagination and query variants must map to one task identity.  
**Change Necessity:** raw URL equality cannot satisfy FR-5.  
**Impact/Compatibility:** helper is pure and does not change existing collectors.

- [x] **Write the failing test.** Add parameterized cases asserting `xchina_gallery:6664761937f5a` for base, `/1.html`, query, and fragment variants; assert `xchina_video:6aaee7c9a12e8` for the video sample; reject non-XChina and malformed IDs.
- [x] **Verify RED.** Run `uv run pytest -q tests/test_content_identity.py`; expect import failure for `core.content_identity`.
- [x] **Implement minimal code.** Add `canonical_content_key(url: str, collector: str | None = None) -> str | None` using anchored `urllib.parse.urlsplit` path regexes and the resolved collector name; do not fetch the network.
- [x] **Verify GREEN.** Run `uv run pytest -q tests/test_content_identity.py tests/test_collector_autoresolve.py` and require all pass.
- [x] **Commit.** Run `git add backend/core/content_identity.py tests/test_content_identity.py && git commit -m "[xchina] feat: canonicalize content identity"`.

### Task 2: Implement atomic duplicate dispositions

**Files:** create Collector `backend/core/task_dedup.py`, `tests/test_task_dedup.py`; modify `backend/models/schemas.py`, `backend/api/tasks.py`, `backend/core/database.py`, `tests/test_database.py`.  
**Why:** two UI entry points and repeated clicks must not create duplicate work.  
**Change Necessity:** bridge-side lookup would race and duplicate canonical logic.  
**Impact/Compatibility:** `deduplicate` defaults false, preserving current clients.

- [ ] **Write the failing test.** Cover `created`, `reused-active`, `confirm-redownload`, `recommend-retry`, and `recommend-resume`; assert two concurrent deduplicated creates produce one task; assert a normal create still produces a new task every time.
- [ ] **Verify RED.** Run `uv run pytest -q tests/test_task_dedup.py tests/test_database.py`; expect missing schema fields/helper failures.
- [ ] **Implement minimal code.** Add `deduplicate: bool = False`, `force_new: bool = False`, and `incremental: Optional[bool]` to `TaskCreateIn`; add optional `disposition` and `content_key` to `TaskCreateOut`; implement one process lock around lookup/create and store the canonical key in task options without a database migration.
- [ ] **Verify GREEN.** Run `uv run pytest -q tests/test_task_dedup.py tests/test_database.py tests/test_incremental.py tests/test_collector_autoresolve.py`.
- [ ] **Commit.** Run `git add backend/core/task_dedup.py backend/models/schemas.py backend/api/tasks.py backend/core/database.py tests/test_task_dedup.py tests/test_database.py && git commit -m "[tasks] feat: deduplicate canonical content tasks"`.

### Task 3: Expose task summary and management deep links

**Files:** modify Collector `backend/models/schemas.py`, `backend/api/tasks.py`, `backend/core/database.py`, `frontend/src/App.vue`, `frontend/package.json`; create `tests/test_task_summary.py`, `frontend/src/task-query.mjs`, `frontend/scripts/test-task-query.mjs`.  
**Why:** SiteFilter needs completed/total counts and a stable task destination.  
**Change Necessity:** current `TaskOut` lacks resource counts and the frontend ignores `?task=`.  
**Impact/Compatibility:** fields are additive; root UI remains unchanged without a query parameter.

- [ ] **Write the failing test.** In `tests/test_task_summary.py`, assert `GET /tasks/{id}` includes `resource_counts` with total/done/failed/filtered. In `frontend/scripts/test-task-query.mjs`, import `selectTaskFromSearch(search, tasks)` and assert `?task=12` selects task 12 while missing, nonnumeric, and unknown IDs return null.
- [ ] **Verify RED.** Run `uv run pytest -q tests/test_task_summary.py` and `cd frontend; node scripts/test-task-query.mjs`; expect the API field and module to be absent.
- [ ] **Implement minimal code.** Add a grouped resource-status count query, expose it on task detail, implement `selectTaskFromSearch` in `task-query.mjs`, and call it from `onMounted` after `refresh()` to set `selectedId`; add `"test:task-query": "node scripts/test-task-query.mjs"` to `frontend/package.json`.
- [ ] **Verify GREEN.** Run `uv run pytest -q tests/test_task_summary.py`; then run `cd frontend; npm run test:task-query; npm run build`. Start Collector, create a task through the API, store its returned ID in PowerShell variable `$taskId`, then open `Start-Process "http://127.0.0.1:8000/?task=$taskId"` and confirm that row is selected.
- [ ] **Commit.** Run `git add backend/models/schemas.py backend/api/tasks.py backend/core/database.py frontend/src/App.vue frontend/src/task-query.mjs frontend/scripts/test-task-query.mjs frontend/package.json tests/test_task_summary.py && git commit -m "[tasks] feat: expose task summaries and deep links"`.

### Task 4: Add native startup and idle supervision

**Files:** modify Collector `scripts/start.py`, `Makefile`; create `tests/test_native_runtime.py`.  
**Why:** Native Host needs silent, single-instance, machine-readable startup and safe idle exit.  
**Change Necessity:** current `make start` opens a browser and has no ownership or idle contract.  
**Impact/Compatibility:** default `make start` behavior must remain identical.

- [ ] **Write the failing test.** Test argument parsing for `--native`, `--runtime-file`, and `--idle-minutes`; test runtime descriptor shape; test that active/paused tasks or enabled watches reset idle, while 30 idle minutes requests shutdown; test that a discovered manual instance is marked `owned=false`.
- [ ] **Verify RED.** Run `uv run pytest -q tests/test_native_runtime.py`; expect missing native runtime helpers.
- [ ] **Implement minimal code.** Add pure helpers for descriptor writing and idle decisions, a single-instance lock, native-mode `--no-open`, and parent-owned child shutdown; add `start-native: uv run python scripts/start.py --native --no-open --idle-minutes 30` to Makefile.
- [ ] **Verify GREEN.** Run `uv run pytest -q tests/test_native_runtime.py tests/test_watchdog.py tests/test_pause_resume.py`, then run `make start-native` once with a temporary runtime path and verify `/healthz` before stopping it.
- [ ] **Commit.** Run `git add scripts/start.py Makefile tests/test_native_runtime.py && git commit -m "[runtime] feat: add native startup supervision"`.

### Task 5: Build the allowlisted Native Messaging Host

**Files:** create Collector `integrations/sitefilter-native-host/host.py`, `host-manifest.template.json`, `README.md`, `tests/test_sitefilter_native_host.py`.  
**Why:** the extension requires a supported bridge to start WSL and reach Collector without localhost permissions.  
**Change Necessity:** no browser-only mechanism can spawn WSL.  
**Impact/Compatibility:** host accepts only protocol v1 and six approved actions.

- [ ] **Write the failing test.** Feed length-prefixed JSON through in-memory binary streams; assert round-trip framing, 1 MiB response guard, exact request IDs, caller-origin rejection, unsupported action rejection, non-XChina URL rejection, redacted errors, and no arbitrary endpoint/shell fields.
- [ ] **Verify RED.** Run `uv run pytest -q tests/test_sitefilter_native_host.py`; expect missing host module.
- [ ] **Implement minimal code.** Implement `read_message`, `write_message`, `validate_request`, `ensure_collector`, and explicit handlers for `ping`, `preview`, `create-or-reuse`, `get-task`, `open-task`, and `start-login`; stdout is protocol-only and logs use stderr/rotating file.
- [ ] **Verify GREEN.** Run the focused pytest suite and a subprocess round trip that sends `ping` to `host.py`; require one valid framed response and exit 0.
- [ ] **Commit.** Run `git add integrations/sitefilter-native-host tests/test_sitefilter_native_host.py && git commit -m "[native-host] feat: bridge SiteFilter to Collector"`.

### Task 6: Add guided installation and removal

**Files:** create Collector `integrations/sitefilter-native-host/install-native-host.ps1`, `uninstall-native-host.ps1`; extend integration README and tests.  
**Why:** each personal Windows machine needs reproducible Chrome/Edge registration and dependency provisioning.  
**Change Necessity:** browser host registration cannot be performed by the extension itself.  
**Impact/Compatibility:** use only `%LOCALAPPDATA%` and HKCU; never delete Collector data.

- [ ] **Write the failing test.** Add `-WhatIf`, `-ProjectPath`, and `-SkipProvision` modes and a test harness using temporary registry names; assert project validation, WSL path conversion, Chrome/Edge manifest entries, exact allowed origin, config permissions, idempotent reinstall, and uninstall scope.
- [ ] **Verify RED.** Run PowerShell in `-WhatIf` mode; expect the installer scripts to be absent.
- [ ] **Implement minimal code.** Prompt with `FolderBrowserDialog` when `-ProjectPath` is absent; detect default WSL; provision with WSL `make install` and `make build`; install Windows `uv`, package `host.py` with pinned PyInstaller, write manifest/config, register both HKCU keys, and run ping/health self-check.
- [ ] **Verify GREEN.** Execute installer `-WhatIf`, temporary-key integration test, real per-user install, Chrome ping, Edge ping, uninstall, and reinstall; verify no administrator prompt and no data-directory deletion.
- [ ] **Commit.** Run `git add integrations/sitefilter-native-host && git commit -m "[native-host] feat: install Chrome and Edge bridge"`.

### Task 7: Add SiteFilter native transport owner

**Files:** create SiteFilter `collector-native.js`, `_test_collector_native.js`; modify `background.js`, `manifest.json`, `make_package.py`.  
**Why:** page code needs one correlated, reconnecting Native Messaging client and notification owner.  
**Change Necessity:** inline additions to the already mixed-purpose service worker would increase ownership pressure.  
**Impact/Compatibility:** add `nativeMessaging` and fixed public `key`; no localhost host permission.

- [ ] **Write the failing test.** Mock `chrome.runtime.connectNative`, disconnects, messages, storage, tabs, and notifications; assert request correlation, timeout, reconnect, incompatible protocol, active-task persistence, one terminal notification, notification click deep link, and host-missing classification.
- [ ] **Verify RED.** Run `node _test_collector_native.js`; expect missing module/exports.
- [ ] **Implement minimal code.** Export one global `SiteFilterCollectorBridge`; import it with `importScripts("collector-native.js")`; route `sf_collector_*` messages through the helper; add fixed `key` and `nativeMessaging`; include the new script in package whitelist and syntax checks.
- [ ] **Verify GREEN.** Run `node _test_collector_native.js`, `_test_writeback.js`, `_test_migrate.js`, then `python ci.py --out build-native-transport`.
- [ ] **Commit.** Run `git add collector-native.js _test_collector_native.js background.js manifest.json make_package.py && git commit -m "[collector] feat: add native task transport"`.

### Task 8: Add XChina detail-page controls and preview

**Files:** create SiteFilter `xchina-download.js`, `_test_xchina_download.js`; modify `manifest.json`, `content.js`, `content.css`, `make_package.py`.  
**Why:** users need title and panel controls, modal preview, and shared state.  
**Change Necessity:** existing download probing lists links but does not create Collector tasks.  
**Impact/Compatibility:** activate only on recognized XChina detail shapes; other pages remain untouched.

- [ ] **Write the failing test.** With jsdom fixtures for the approved photo/video headings, assert recognition, canonical provisional keys, title button label, panel slot, shared disabled state, photo `media:auto`, video auto collector, preview modal fields, image/video-only menu choices, double-click idempotence, and complete teardown.
- [ ] **Verify RED.** Run `node _test_xchina_download.js`; expect missing script behavior.
- [ ] **Implement minimal code.** Load `xchina-download.js` after `content.js`; use `document.querySelector("h1")` with panel fallback; communicate only through runtime messages; add namespaced CSS and accessible modal focus/escape behavior.
- [ ] **Verify GREEN.** Run `_test_xchina_download.js`, `_smoke.js`, `_test_softblock.js`, and `python ci.py --out build-xchina-ui`.
- [ ] **Commit.** Run `git add xchina-download.js _test_xchina_download.js manifest.json content.js content.css make_package.py && git commit -m "[xchina] feat: add Collector download controls"`.

### Task 9: Complete restoration, login recovery, and user guidance

**Files:** modify SiteFilter `collector-native.js`, `xchina-download.js`, tests, `README.md`, `CHANGELOG.md`; modify Collector integration README if the protocol changes.  
**Why:** accepted behavior includes revisit restoration, missing-host guidance, login flow, and actionable errors.  
**Change Necessity:** core transport/UI alone does not close failure and re-entry paths.  
**Impact/Compatibility:** no automatic browser-cookie transfer or automatic management-page opening.

- [ ] **Write the failing test.** Assert restored latest task on page load, completed redownload confirmation, retry/resume recommendations, install guidance and re-detect, login-required action, all terminal notification types, and no duplicate notification after service-worker restart.
- [ ] **Verify RED.** Run `node _test_collector_native.js` and `node _test_xchina_download.js`; require the newly added restoration/login assertions to fail before implementation.
- [ ] **Implement minimal code.** Persist only `{contentKey, taskId, terminalNotified}`; map stable host/Collector error codes to one next action; call `start-login` only after explicit user action; update user documentation and changelog.
- [ ] **Verify GREEN.** Run `node _test_collector_native.js`, `node _test_xchina_download.js`, `python ci.py --out build-integration-complete`, then run full Collector `uv run pytest -q`.
- [ ] **Commit.** In SiteFilter run `git add collector-native.js xchina-download.js _test_collector_native.js _test_xchina_download.js README.md CHANGELOG.md && git commit -m "[collector] feat: restore tasks and recover login"`. In Collector run `git add README.md integrations/sitefilter-native-host/README.md && git commit -m "[sitefilter] docs: document native integration"`.

### Task 10: Run installation and real two-browser acceptance

**Files:** no source edits unless a focused defect is found; store evidence outside release packages under an ignored `artifacts/xchina-collector-acceptance/` directory.  
**Why:** mocks cannot prove registry, WSL, HLS, notification, and final-file behavior.  
**Change Necessity:** runtime verification is required by the approved specification.  
**Impact/Compatibility:** real downloads are authorized and retained; no cleanup is performed without a separate request.

- [ ] **Write the acceptance checklist.** Record browser/version, extension ID, WSL distribution, selected project, Native Host version, Collector port, task IDs, output directories, expected notification states, and idle timestamps.
- [ ] **Verify initial RED path.** Uninstall the host, open the approved photo page in Chrome, and confirm visible install guidance; repeat host-missing detection in Edge.
- [ ] **Execute minimal acceptance.** Install once; in Chrome fully download the approved gallery; in Edge fully download the approved video; exercise preview, repeated click, page reload, and task deep link. With a temporary `UWC_BROWSER_STATE_DIR`, start and stop one WSLg login session to prove the recovery UI without replacing the user's saved state.
- [ ] **Verify GREEN.** Confirm final task statuses, resource counts, files, hashes/nonzero sizes, playable video via `ffprobe`, one notification per task, no duplicate task, and Collector exit after 30 idle minutes; then reinstall/restart and verify status restoration.
- [ ] **Commit evidence references only.** Update progress/docs with task IDs, commands, and summarized results without committing adult media, cookies, browser state, absolute private output paths, or generated binaries; use `[integration] test: verify XChina native downloads` in each applicable repository.

## Risks

- WSL localhost forwarding may differ by machine; installer health validation is a hard gate.
- PyInstaller output may trigger antivirus reputation warnings; retain source, hashes, and reproducible build command.
- MV3 service-worker suspension can disconnect native ports; persistence and reconnect tests must prove recovery.
- XChina DOM can change; title injection has a panel fallback and URL-shape guard.
- Real video downloads may be large or slow; accepted completion evidence still requires the complete file.
- The fixed manifest key is public identity material, not a secret; private signing material must never enter the repository.

## Retirement

- No legacy integration exists to delete.
- Do not introduce direct localhost access as a compatibility fallback.
- Runtime descriptors and temporary installer keys are removed on uninstall; Collector data/downloads remain.
- If the extension is published to stores, replace the unpacked-ID installation assumptions through a separately reviewed migration and update Native Host `allowed_origins`.
- After verified completion, record an ADR for the Native Host proxy and Collector-owned identity boundary, then synchronize README/progress baselines.

## Execution Order and Review Gates

1. Task 0 baseline gate.
2. Tasks 1-3 Collector contract gate.
3. Task 4 runtime gate.
4. Tasks 5-6 packaged host/install gate.
5. Tasks 7-9 SiteFilter integration gate.
6. Task 10 real acceptance gate.

Stop and return to design review if implementation requires direct cookie export, a second downloader, arbitrary native commands, public-store IDs, non-WSL execution, or a direct localhost fallback.
