# XChina Collector Integration — Checkpoint

## TodoCheckpointDraft

- Current todo: Task 3 — expose task summary and management deep links.
- Active slice: add a compact Collector task-summary contract and query-driven frontend selection without moving task truth into the extension.
- Completed todos: specification approval, implementation planning, and Tasks 0–2.
- Pending todos: Tasks 3–10 from the parent implementation plan.
- Evidence refs: approved requirements/design/plan, Collector commits `5b4ef98429b40decffbf595e542c5a712e369a7a` and `c95cfbdc7084f47849ca4331657e636fe5ab9c8f`, and `90-evidence.md`.
- Blocked on: nothing known for Task 3.
- Next step: dispatch the Task 3 implementer with exact API summary fields, frontend query behavior, and focused tests.

## Task 0 Evidence

- RED boundary: before initialization, `git -C C:\Users\admin\Desktop\site-filter rev-parse --show-toplevel` returned `C:/Users/admin`, and `git -C C:\Users\admin\Desktop\site-filter status --short -- .` returned `?? ./`.
- Repository boundary: `git init -b main`, `git add .`, staged-path inspection, and `git commit --amend --no-edit` produced one independent `main` root commit with message `[repo] chore: establish project baseline`.
- SiteFilter gate: with `PYTHONUTF8=1`, `python ci.py --out build-baseline` passed 12 suites and 609 assertions with zero failures, then completed package validation. UTF-8 mode is required on this Windows console because the default GBK encoding cannot print the runner's status glyphs.
- Collector gate: from `C:\Users\admin\Desktop\universal_web_collector_v9`, `uv run pytest -q` passed 512 tests with one Starlette deprecation warning in a temporary Windows test environment.
- Collector environment note: the repository `.venv` is WSL-created and cannot be used by Windows `uv`; the temporary Windows environment also required test-only `httpx2`, which is used by the locked Starlette test client but is not declared in the Collector development dependencies. No Collector source, lockfile, or repository environment was changed.
- Clean boundary: SiteFilter was clean after verification; generated packages, dependencies, caches, and local WorkBuddy memory are ignored. Collector remained clean. The parent `C:\Users\admin` repository has no staged or tracked SiteFilter path.

## ResumeStateHint

Resume by reading `10-intent.md`, this checkpoint, `90-evidence.md`, and the parent plan. Confirm both feature worktrees are clean at their recorded commits, then continue with Task 3.

## DriftCheckDraft

- Original intent: aligned.
- Goal and stop condition: aligned.
- Compatibility boundary: unchanged.
- New owner/fallback/adapter: only the approved Native Messaging adapter is planned.
- Retirement track: explicit.
- Evidence sufficiency: Tasks 0–2 have direct RED/GREEN, immutable commits, clean-tree, and two-stage review evidence; later tasks still require their own stated gates.
- Execution Readiness View: present and aligned.
- Decision: Task 2 kept canonical identity and disposition ownership in Collector, preserved normal-create compatibility, and introduced no schema migration or cross-process contract drift; continue to Task 3.
