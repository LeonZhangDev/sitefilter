# XChina Collector Integration — Checkpoint

## TodoCheckpointDraft

- Current todo: Task 2 — implement atomic duplicate dispositions.
- Active slice: extend Collector persistence and task creation around the canonical identity owner established by Task 1.
- Completed todos: specification approval, implementation planning, Task 0 repository bootstrap/baseline verification, and Task 1 canonical XChina content identity.
- Pending todos: Tasks 2–10 from the parent implementation plan.
- Evidence refs: approved requirements/design/plan, Task 0 baseline evidence below, Collector commit `5b4ef98429b40decffbf595e542c5a712e369a7a`, and `90-evidence.md`.
- Blocked on: nothing known for Task 2.
- Next step: dispatch the Task 2 implementer with the exact schema/API compatibility boundary and atomicity tests.

## Task 0 Evidence

- RED boundary: before initialization, `git -C C:\Users\admin\Desktop\site-filter rev-parse --show-toplevel` returned `C:/Users/admin`, and `git -C C:\Users\admin\Desktop\site-filter status --short -- .` returned `?? ./`.
- Repository boundary: `git init -b main`, `git add .`, staged-path inspection, and `git commit --amend --no-edit` produced one independent `main` root commit with message `[repo] chore: establish project baseline`.
- SiteFilter gate: with `PYTHONUTF8=1`, `python ci.py --out build-baseline` passed 12 suites and 609 assertions with zero failures, then completed package validation. UTF-8 mode is required on this Windows console because the default GBK encoding cannot print the runner's status glyphs.
- Collector gate: from `C:\Users\admin\Desktop\universal_web_collector_v9`, `uv run pytest -q` passed 512 tests with one Starlette deprecation warning in a temporary Windows test environment.
- Collector environment note: the repository `.venv` is WSL-created and cannot be used by Windows `uv`; the temporary Windows environment also required test-only `httpx2`, which is used by the locked Starlette test client but is not declared in the Collector development dependencies. No Collector source, lockfile, or repository environment was changed.
- Clean boundary: SiteFilter was clean after verification; generated packages, dependencies, caches, and local WorkBuddy memory are ignored. Collector remained clean. The parent `C:\Users\admin` repository has no staged or tracked SiteFilter path.

## ResumeStateHint

Resume by reading `10-intent.md`, this checkpoint, `90-evidence.md`, and the parent plan. Confirm both `codex/xchina-collector-integration` worktrees are clean at their recorded commits, then continue with Task 2.

## DriftCheckDraft

- Original intent: aligned.
- Goal and stop condition: aligned.
- Compatibility boundary: unchanged.
- New owner/fallback/adapter: only the approved Native Messaging adapter is planned.
- Retirement track: explicit.
- Evidence sufficiency: Tasks 0 and 1 have direct RED/GREEN, immutable commit, clean-tree, and two-stage review evidence; later tasks still require their own stated gates.
- Execution Readiness View: present and aligned.
- Decision: Task 1 remained inside Collector ownership and introduced no network, API, persistence, or extension drift; continue to Task 2.
