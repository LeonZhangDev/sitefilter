# XChina Collector Integration — Checkpoint

## TodoCheckpointDraft

- Current todo: none; Task 10 real two-browser acceptance is complete.
- Active slice: final evidence and clean-worktree handoff.
- Completed todos: specification approval, implementation planning, and Tasks 0–10.
- Pending todos: none from the parent implementation plan.
- Evidence refs: approved requirements/design/plan, SiteFilter commits through `9b5c79e8d350cda023a97e7cb48c1d8125a22231`, Collector acceptance fixes through `4b58455`, and `90-evidence.md`.
- Blocked on: none. Branded Chrome and Edge were both exercised with their unpacked extension profiles.
- Next step: optional follow-up for inaccurate video preview byte estimation; it did not affect task creation or output integrity.

## Task 0 Evidence

- RED boundary: before initialization, `git -C C:\Users\admin\Desktop\site-filter rev-parse --show-toplevel` returned `C:/Users/admin`, and `git -C C:\Users\admin\Desktop\site-filter status --short -- .` returned `?? ./`.
- Repository boundary: `git init -b main`, `git add .`, staged-path inspection, and `git commit --amend --no-edit` produced one independent `main` root commit with message `[repo] chore: establish project baseline`.
- SiteFilter gate: with `PYTHONUTF8=1`, `python ci.py --out build-baseline` passed 12 suites and 609 assertions with zero failures, then completed package validation. UTF-8 mode is required on this Windows console because the default GBK encoding cannot print the runner's status glyphs.
- Collector gate: from `C:\Users\admin\Desktop\universal_web_collector_v9`, `uv run pytest -q` passed 512 tests with one Starlette deprecation warning in a temporary Windows test environment.
- Collector environment note: the repository `.venv` is WSL-created and cannot be used by Windows `uv`; the temporary Windows environment also required test-only `httpx2`, which is used by the locked Starlette test client but is not declared in the Collector development dependencies. No Collector source, lockfile, or repository environment was changed.
- Clean boundary: SiteFilter was clean after verification; generated packages, dependencies, caches, and local WorkBuddy memory are ignored. Collector remained clean. The parent `C:\Users\admin` repository has no staged or tracked SiteFilter path.

## ResumeStateHint

Task 10 is complete. Read `90-evidence.md` for the live task IDs, output integrity summary, focused fixes, and remaining non-blocking observation.

## DriftCheckDraft

- Original intent: aligned.
- Goal and stop condition: aligned.
- Compatibility boundary: unchanged.
- New owner/fallback/adapter: only the approved Native Messaging adapter is planned.
- Retirement track: explicit.
- Evidence sufficiency: Tasks 0–10 have direct RED/GREEN, immutable commits, cross-platform runtime/protocol/subprocess checks, real per-user installation/browser probes, complete real gallery/video outputs, MV3 lifecycle/notification evidence, WSLg recovery proof, restart restoration, and final installer self-check.
- Execution Readiness View: present and aligned.
- Decision: Task 10 passed. Retain the final Host installation and downloaded user data; do not clean either without a separate request.
