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

