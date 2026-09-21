# XChina Collector Integration — Checkpoint

## TodoCheckpointDraft

- Current todo: Task 1 — add canonical XChina content identity.
- Active slice: create an isolated feature worktree and begin the Collector identity helper and focused tests.
- Completed todos: specification approval, implementation planning, and Task 0 repository bootstrap/baseline verification.
- Pending todos: Tasks 1–10 from the parent implementation plan.
- Evidence refs: approved requirements, design, baseline, implementation plan, and the Task 0 root commit `[repo] chore: establish project baseline`.
- Blocked on: nothing known for Task 1.
- Next step: create the planned isolated feature worktree, then dispatch Task 1.

## Task 0 Evidence

- RED boundary: before initialization, `git -C C:\Users\admin\Desktop\site-filter rev-parse --show-toplevel` returned `C:/Users/admin`, and `git -C C:\Users\admin\Desktop\site-filter status --short -- .` returned `?? ./`.
- Repository boundary: `git init -b main`, `git add .`, staged-path inspection, and `git commit --amend --no-edit` produced one independent `main` root commit with message `[repo] chore: establish project baseline`.
- SiteFilter gate: with `PYTHONUTF8=1`, `python ci.py --out build-baseline` passed 12 suites and 609 assertions with zero failures, then completed package validation. UTF-8 mode is required on this Windows console because the default GBK encoding cannot print the runner's status glyphs.
- Collector gate: from `C:\Users\admin\Desktop\universal_web_collector_v9`, `uv run pytest -q` passed 512 tests with one Starlette deprecation warning in a temporary Windows test environment.
- Collector environment note: the repository `.venv` is WSL-created and cannot be used by Windows `uv`; the temporary Windows environment also required test-only `httpx2`, which is used by the locked Starlette test client but is not declared in the Collector development dependencies. No Collector source, lockfile, or repository environment was changed.
- Clean boundary: SiteFilter was clean after verification; generated packages, dependencies, caches, and local WorkBuddy memory are ignored. Collector remained clean. The parent `C:\Users\admin` repository has no staged or tracked SiteFilter path.

## ResumeStateHint

Resume by reading `10-intent.md`, this checkpoint, and the parent plan. Confirm the independent SiteFilter repository is clean on `main`, create the isolated feature worktree required after the bootstrap exception, and continue with Task 1.

## DriftCheckDraft

- Original intent: aligned.
- Goal and stop condition: aligned.
- Compatibility boundary: unchanged.
- New owner/fallback/adapter: only the approved Native Messaging adapter is planned.
- Retirement track: explicit.
- Evidence sufficiency: Task 0 has direct RED/GREEN, commit, clean-tree, and repository-boundary evidence; later tasks still require their own stated gates.
- Execution Readiness View: present and aligned.
- Decision: Task 0 introduced no design drift; continue to Task 1 in an isolated feature worktree.
