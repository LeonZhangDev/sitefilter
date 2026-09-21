# XChina Collector Integration — Checkpoint

## TodoCheckpointDraft

- Current todo: Task 10 data-retention clarification remains open; do not mark the overall acceptance complete.
- Active slice: preserve Task 4 and hand off the missing Task 1–3 evidence accurately.
- Completed todos: specification approval, implementation planning, Tasks 0–9, Task 10 browser/output checks, and final code-quality review.
- Pending todos: user clarification for the missing Task 1–3 records/output directories; no recovery or re-download is authorized.
- Evidence refs: approved requirements/design/plan, SiteFilter commits through `a94eced`, Collector acceptance fixes through `065d4a4` and `81ca318`, and `90-evidence.md`.
- Blocked on: only the data-retention acceptance item. Branded Chrome and Edge workflows, Task 4 output integrity, notifications, restart behavior, and the normal installer passed.
- Next step: obtain user clarification, then decide whether the data-retention gate can close. Preview byte-estimate accuracy remains an optional follow-up.

## Task 0 Evidence

- RED boundary: before initialization, `git -C C:\Users\admin\Desktop\site-filter rev-parse --show-toplevel` returned `C:/Users/admin`, and `git -C C:\Users\admin\Desktop\site-filter status --short -- .` returned `?? ./`.
- Repository boundary: `git init -b main`, `git add .`, staged-path inspection, and `git commit --amend --no-edit` produced one independent `main` root commit with message `[repo] chore: establish project baseline`.
- SiteFilter gate: with `PYTHONUTF8=1`, `python ci.py --out build-baseline` passed 12 suites and 609 assertions with zero failures, then completed package validation. UTF-8 mode is required on this Windows console because the default GBK encoding cannot print the runner's status glyphs.
- Collector gate: from `C:\Users\admin\Desktop\universal_web_collector_v9`, `uv run pytest -q` passed 512 tests with one Starlette deprecation warning in a temporary Windows test environment.
- Collector environment note: the repository `.venv` is WSL-created and cannot be used by Windows `uv`; the temporary Windows environment also required test-only `httpx2`, which is used by the locked Starlette test client but is not declared in the Collector development dependencies. No Collector source, lockfile, or repository environment was changed.
- Clean boundary: SiteFilter was clean after verification; generated packages, dependencies, caches, and local WorkBuddy memory are ignored. Collector remained clean. The parent `C:\Users\admin` repository has no staged or tracked SiteFilter path.

## ResumeStateHint

Task 10 is not fully closed. Read `90-evidence.md` for the previously verified Tasks 1–3, retained Task 4, focused fixes, and the open data-retention item.

## DriftCheckDraft

- Original intent: aligned.
- Goal and stop condition: aligned.
- Compatibility boundary: unchanged.
- New owner/fallback/adapter: only the approved Native Messaging adapter is planned.
- Retirement track: explicit.
- Evidence sufficiency: code and browser behavior have direct RED/GREEN, immutable commits, cross-platform runtime/protocol/subprocess checks, real per-user installation/browser probes, verified gallery/video outputs, MV3 lifecycle/notification evidence, WSLg recovery proof, restart restoration, and final installer self-check. Current retention of Tasks 1–3 is not established.
- Execution Readiness View: present and aligned.
- Decision: Task 10 code/browser checks passed, but overall acceptance remains open on data retention. Retain the final Host installation and Task 4; do not clean, recover, or re-download without a separate request.
