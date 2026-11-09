# Vitest environments in multi-package projects

The reported React test failure came from running client tests at the repository
root. The client had `vite.config.ts` with `environment: 'jsdom'` and a setup
file, while the server had a separate Vitest configuration using Node. The root
runner did not select the client configuration.

Vitest execution now groups requested files by their nearest Vitest/Vite config.
Each group executes from that configuration's directory, preserving its plugins,
environment, setup files and relative paths. Test and coverage reports are merged
back into the parent run with canonical source/test paths. A failed package or
missing report still fails the overall batch. Original tests/configs are not
rewritten and backend tests are not globally switched to jsdom.

For discovery without explicit targets, the runner inventories Vitest test files
before grouping them. Vitest config files take precedence over Vite config files.
Both JS/TS and ESM/CommonJS config extensions are recognized.

Statically configured `jsdom` and `happy-dom` environments are installed as dev
dependencies in the owning package when missing. A borrowed runner that cannot
resolve that environment from its real dependency tree is materialized locally;
Vitest/coverage compatibility is then verified again. Failed installs stop the
run with a diagnostic instead of silently using Node.

Validation: eight related regression suites passed (61 tests before one additional
borrowed-runtime regression; the final runtime/config subset passed 20 tests).
A separate real Vitest/V8 fixture installed its own dependencies and passed three
tests: DOM with client setup, React render plus user-event/jest-dom assertions,
and a backend assertion that `document` stays undefined. No source or test changes
were applied to the user's imported project during this smoke run.
