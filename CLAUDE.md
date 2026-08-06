# Claude Pet Agent Entry Point

Before changing product code, read these files completely:

1. `docs/CLAUDE_PRODUCT_REPAIR_HANDOFF.md`
2. `docs/project-context.md`
3. `docs/BUILD_LOG.md`
4. The current Codex compatibility specification, plan, executor, manager, and probe code referenced by the handoff.

The handoff records the verified checkpoint, prohibited WorkBuddy/theme experiment, performance problem, security boundaries, required reproduction, phased product direction, test gates, and fresh-session plugin setup.

Do not edit `master`. Begin by verifying the checkout and installed plugins, stopping any stale Electron process normally, and measuring a fresh reproduction. Use `systematic-debugging` first. Do not restore deleted WorkBuddy material, add theme controls, weaken exact Codex identity verification, or start with a CSS rewrite.

Before implementation, show the user the measured root cause, 2-3 coherent approaches, and the proposed UI direction. After approval, use a worktree/feature branch, TDD, real-window QA, and reviewable PRs as specified in the handoff.
