# XChina Collector Integration — Checkpoint

## TodoCheckpointDraft

- Current todo: Task 7 — add the SiteFilter native transport owner.
- Active slice: add one correlated, reconnecting Native Messaging client without localhost permissions or duplicated Collector ownership.
- Completed todos: specification approval, implementation planning, and Tasks 0–6.
- Pending todos: Tasks 7–10 from the parent implementation plan.
- Evidence refs: approved requirements/design/plan, Collector commits through `f00624723a2090c362fd11236d6b9d164378824b`, and `90-evidence.md`.
- Blocked on: nothing known for Task 7.
- Next step: implement the isolated transport module with mocked request correlation, persistence, reconnect, notification, and host-missing behavior before wiring the service worker.

## Task 0 Evidence

- RED boundary: before initialization, `git -C C:\Users\admin\Desktop\site-filter rev-parse --show-toplevel` returned `C:/Users/admin`, and `git -C C:\Users\admin\Desktop\site-filter status --short -- .` returned `?? ./`.
- Repository boundary: `git init -b main`, `git add .`, staged-path inspection, and `git commit --amend --no-edit` produced one independent `main` root commit with message `[repo] chore: establish project baseline`.
- SiteFilter gate: with `PYTHONUTF8=1`, `python ci.py --out build-baseline` passed 12 suites and 609 assertions with zero failures, then completed package validation. UTF-8 mode is required on this Windows console because the default GBK encoding cannot print the runner's status glyphs.
- Collector gate: from `C:\Users\admin\Desktop\universal_web_collector_v9`, `uv run pytest -q` passed 512 tests with one Starlette deprecation warning in a temporary Windows test environment.
- Collector environment note: the repository `.venv` is WSL-created and cannot be used by Windows `uv`; the temporary Windows environment also required test-only `httpx2`, which is used by the locked Starlette test client but is not declared in the Collector development dependencies. No Collector source, lockfile, or repository environment was changed.
- Clean boundary: SiteFilter was clean after verification; generated packages, dependencies, caches, and local WorkBuddy memory are ignored. Collector remained clean. The parent `C:\Users\admin` repository has no staged or tracked SiteFilter path.

## ResumeStateHint

Resume by reading `10-intent.md`, this checkpoint, `90-evidence.md`, and the parent plan. Confirm both feature worktrees are clean at their recorded commits, then continue with Task 7.

## DriftCheckDraft

- Original intent: aligned.
- Goal and stop condition: aligned.
- Compatibility boundary: unchanged.
- New owner/fallback/adapter: only the approved Native Messaging adapter is planned.
- Retirement track: explicit.
- Evidence sufficiency: Tasks 0–6 have direct RED/GREEN, immutable commits, cross-platform runtime/protocol/subprocess checks, real per-user installation/browser probes, and two-stage review evidence; later tasks still require their own stated gates.
- Execution Readiness View: present and aligned.
- Decision: Task 6 remains a per-user, exact-target, transactional installer with bounded self-checks and pidfd-only process ownership; continue to Task 7.
