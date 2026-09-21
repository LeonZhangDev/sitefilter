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
