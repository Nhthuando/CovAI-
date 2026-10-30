# Portable project runtime verification — 15 October 2026

The implementation replaces ignored synchronous frontend installation with a shared, checked runtime preparation service. It discovers nested apps and controlling workspaces, selects npm/pnpm/Yarn/Bun from project metadata, validates Node engine requirements and local ESM package resolution, and preserves the selected project's Playwright configuration and runner version. Dependencies and lock repairs live in disposable execution copies. Full Stack seeds run only against the prepared isolated database; Frontend mode does not run database seeds.

## Research

The failure is consistent with an incomplete local install followed by a foreign executable on PATH. Adding NODE_PATH cannot fix ESM dependency resolution; [Node's ESM documentation](https://nodejs.org/api/esm.html#no-node_path) explicitly excludes it. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) requires lock/manifest compatibility, while [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/) and [pnpm workspaces](https://pnpm.io/workspaces) establish installation roots. Manager-specific flags follow [pnpm install](https://pnpm.io/cli/install), [Yarn install](https://yarnpkg.com/cli/install), [Yarn nodeLinker](https://yarnpkg.com/configuration/yarnrc), and [Bun installation](https://bun.com/docs/installation). Project web-server and timeout settings follow [Playwright webServer](https://playwright.dev/docs/test-webserver) and [Playwright timeouts](https://playwright.dev/docs/test-timeouts).

## Imported repositories

| Project / mode | Verification job | Independent runs | Result |
| --- | --- | --- | --- |
| Food Ordering / Frontend | `cmv9nnak60000ko7klcqnasyb` | 6/6, 6/6 | Completed; 2 passing runs |
| Todo / Full Stack | `cmv9o6r6j0000j47kulaovn0a` | 7/7, 7/7 | Completed; 2 passing runs |

Food assessment: `cmv9nnb1q0002ko7kk3m5bli8`. Todo assessment: `cmv9o6rp80002j47kblzmgb14`.

Original imported source and test files were not rewritten, assertions weakened, or failing scenarios skipped. Verification did not call AI. Food Frontend coverage is measured across 11 eligible files: lines 39.52%, branches 27.13%, functions 20.25%, statements 36.05%. Backend coverage is not measured in Frontend mode. Todo Full Stack retains frontend lines 83.82% and backend lines 80.77%.

An earlier Food verification (`cmv9n8w600000pw7kf2gvem2i`) passed 6/6 then 5/6, with one navigation timeout. This remains a real failed run in history. Subsequent work preserved the original Playwright configuration and selected runner, then verified the two passing runs above. The old navigation timeout's resource-level cause was not conclusively established; two passes do not prove absence of all flakiness. Failure evidence now records pending request origins/paths and resource types without request query strings or headers.

## Real runtime matrix

`server/e2e/project-runtime-matrix.mjs` creates temporary repositories, installs public dependencies, starts the actual application and uses Chromium to check rendered content and a working interaction. All 13 cases passed across the recorded matrix runs:

| Case | Runtime / layout |
| --- | --- |
| root-vite7-esm | Vite 7, root ESM config |
| split-ui-vite8 | Vite 8, nested UI |
| nested-npm-workspace | Hoisted npm workspace and local shared package |
| preview-requires-build | Build followed by preview |
| node-commonjs-web-server | Plain Node CommonJS HTTP application |
| pinned-pnpm | pnpm 10.0.0 |
| pinned-yarn-node-modules | Yarn 4.0.0 |
| pinned-bun | Bun 1.2.0 |
| next15-react19 | Next.js 15 / React 19 |
| astro5 | Astro 5 |
| pnpm-nested-workspace | YAML workspace and workspace:* dependency |
| yarn-nested-workspace | Yarn workspace and workspace:* dependency |
| bun-nested-workspace | Bun workspace and workspace:* dependency |

Reproduce from `server/` with Node 24 and available network access:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.covai-temp/playwright-browsers"
node node_modules/playwright/cli.js install chromium
node e2e/project-runtime-matrix.mjs
```

The matrix downloads packages and exercises runtime startup, not every framework's source-coverage adapter. Optional `COVAI_RUNTIME_CASES` selects comma-separated case names. Owned browser/processes/temp directories are cleaned after each run.

## Behavioral regression

Final result: **25 suites passed, 229 tests passed**, process exit code 0. `git diff --check` reports no whitespace errors. No frontend code changed in this runtime repair.

The selected Jest suite covers discovery, ambiguity, manager selection, YAML workspace parsing, semver engine checks, partial installs, ESM resolution, lock mismatch repair, cancellation, concurrent preparation, original Playwright config paths/options, database seed isolation, assessment, improvement, coverage truthfulness and evidence paths. See the command below for the exact selection.

```powershell
npm.cmd test --prefix server -- --runInBand projectRuntimePlan projectDependencies projectPlaywrightConfig autStartupCommand autLifecycle systemTestRunner fullSystemRuntime fullSystemSetup systemAssessment systemImprovement systemTestEvidence systemTestEndpoints systemTestNavigation systemCoverageTruthfulness systemCoverageCollector systemScreenshotPath
```

## Limits

Automatic configuration cannot make broken source, inaccessible private registries, missing secrets/services, or incompatible Node requirements pass. Unsupported or ambiguous projects must fail with an actionable cause. This worker checks Node compatibility; it does not change the host's global Node version. Measured source coverage remains supported by the existing Vite frontend/direct Node JS backend collectors. Next/Astro startup success does not establish support for their source coverage. No schema migration or global tool installation was introduced.
