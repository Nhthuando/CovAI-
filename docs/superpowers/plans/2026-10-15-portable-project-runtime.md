# Portable project runtime implementation plan

**Goal:** Repair the imported Food Ordering failure through shared package discovery and checked, isolated dependency preparation; verify multiple JS layouts rather than assuming one Todo app represents all projects.

**Evidence:** Owned assessment cmv9mpa0x000bl07k8u69pbs2 fails loading Vite from its temporary client copy. Source declares Vite 7.2.2, Babel 8, Jest 30 and ts-jest 29. Existing frontend startup runs synchronous npm install with a 90s limit, ignores nonzero results, and treats any node_modules directory as ready. It can then find a foreign Vite executable on PATH while the config's ESM import has no local Vite dependency.

**Research:**
- Node ESM does not resolve imports through NODE_PATH: https://nodejs.org/api/esm.html#no-node_path
- Vite bundles/loads config relative to the project: https://vite.dev/config/
- npm ci preserves a matching lockfile and requires install-time flags compatible with its lock; include dev/optional explicitly: https://docs.npmjs.com/cli/v11/commands/npm-ci/
- Workspace installation belongs at the controlling workspace root: https://docs.npmjs.com/cli/v11/using-npm/workspaces/ and https://pnpm.io/workspaces
- pnpm, Yarn and Bun use different install/run flags: https://pnpm.io/cli/install, https://yarnpkg.com/cli/install, https://bun.com/docs/installation
- Yarn can select node-modules linking through YARN_NODE_LINKER for disposable execution without modifying original config: https://yarnpkg.com/configuration/yarnrc
- Playwright webServer commands require correct cwd and readiness; a started process alone is insufficient: https://playwright.dev/docs/test-webserver

**Decision:** Use source-local package installs with a deterministic runtime plan. A NODE_PATH workaround does not solve ESM. Sharing CovAI's application packages would substitute versions and weaken isolation. Keep AI for existing source-grounded Full Stack setup, not package-manager guessing or manufacturing passing tests.

- [x] Add bounded package discovery, frontend selection and package/workspace/manager metadata. Handle arbitrary nested frontend names and reject unresolved ambiguity. Preserve conventional-layout fallbacks.
- [x] Add asynchronous checked dependency preparation shared by startup and Full Stack. Honor pinned manager metadata/lockfiles, include build dependencies, fail before startup on failed install, verify local startup tooling, and reuse only a matching preparation fingerprint within the same disposable workspace. Preserve locks unless an explicit out-of-sync lock repair is needed in the copy.
- [x] Add compatible manager-specific run flags and build-before-preview/start behavior. Propagate cancellation and repository boundaries. Avoid repeated shared-workspace installs while another process is running.
- [x] Expand automatic assessment scope selection and exclude generated framework caches from source copies. Keep coverage capability limitations explicit.
- [x] Add behavioral regressions for partial installs, installer failure, manager/lock selection, workspace hoisting, ambiguity, cancellation and build/run commands.
- [x] Run real fresh-copy imports/startup/tests for Food Ordering and a layout matrix; run relevant existing regressions. Record exact results and external blockers; never claim universal pass or convert failures to skips.

Verification results: [portable runtime verification](2026-10-15-portable-project-runtime-verification.md).

**Limits:** An arbitrary JS repository can contain broken source, unavailable private packages/services, missing test secrets, incompatible Node requirements or non-browser programs. Auto-configuration cannot guarantee all tests pass. Existing source-coverage adapters support Vite frontend/direct Node JS backend; other runtime execution and source measurement are separate capabilities. No schema change, global tool installation, original app-source patching or fake coverage.
