# XChina Collector Integration — Checkpoint

## TodoCheckpointDraft

- Current todo: Task 9 — complete restoration, login recovery, and user guidance.
- Active slice: restore minimal persisted tasks, map stable errors to one next action, and expose login only after explicit user action.
- Completed todos: specification approval, implementation planning, and Tasks 0–8.
- Pending todos: Tasks 9–10 from the parent implementation plan.
- Evidence refs: approved requirements/design/plan, SiteFilter commits through `649a13b57c5efb179c577ea0aab1b80fa249fd17`, Collector commits through `f00624723a2090c362fd11236d6b9d164378824b`, and `90-evidence.md`.
- Blocked on: nothing known for Task 9.
- Next step: add restoration, completed-task confirmation, retry/resume guidance, host re-detection, explicit login recovery, and documentation.

## Task 0 Evidence

- RED boundary: before initialization, `git -C C:\Users\admin\Desktop\site-filter rev-parse --show-toplevel` returned `C:/Users/admin`, and `git -C C:\Users\admin\Desktop\site-filter status --short -- .` returned `?? ./`.
- Repository boundary: `git init -b main`, `git add .`, staged-path inspection, and `git commit --amend --no-edit` produced one independent `main` root commit with message `[repo] chore: establish project baseline`.
- SiteFilter gate: with `PYTHONUTF8=1`, `python ci.py --out build-baseline` passed 12 suites and 609 assertions with zero failures, then completed package validation. UTF-8 mode is required on this Windows console because the default GBK encoding cannot print the runner's status glyphs.
- Collector gate: from `C:\Users\admin\Desktop\universal_web_collector_v9`, `uv run pytest -q` passed 512 tests with one Starlette deprecation warning in a temporary Windows test environment.
- Collector environment note: the repository `.venv` is WSL-created and cannot be used by Windows `uv`; the temporary Windows environment also required test-only `httpx2`, which is used by the locked Starlette test client but is not declared in the Collector development dependencies. No Collector source, lockfile, or repository environment was changed.
- Clean boundary: SiteFilter was clean after verification; generated packages, dependencies, caches, and local WorkBuddy memory are ignored. Collector remained clean. The parent `C:\Users\admin` repository has no staged or tracked SiteFilter path.

## ResumeStateHint

Resume by reading `10-intent.md`, this checkpoint, `90-evidence.md`, and the parent plan. Confirm both feature worktrees are clean at their recorded commits, then continue with Task 9.

## DriftCheckDraft

- Original intent: aligned.
- Goal and stop condition: aligned.
- Compatibility boundary: unchanged.
- New owner/fallback/adapter: only the approved Native Messaging adapter is planned.
- Retirement track: explicit.
- Evidence sufficiency: Tasks 0–8 have direct RED/GREEN, immutable commits, cross-platform runtime/protocol/subprocess checks, real per-user installation/browser probes, MV3 lifecycle/notification fault tests, page-bound async race tests, and two-stage review evidence; later tasks still require their own stated gates.
- Execution Readiness View: present and aligned.
- Decision: Task 8 remains a runtime-message-only UI adapter bound to immutable page identity, with strict response validation and zero injection outside supported detail pages; continue to Task 9.
