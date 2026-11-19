# Vitest coverage runtime compatibility

`TypeError: this.resolveReporters is not a function` can occur before any test
executes when the coverage provider imports `vitest/coverage` from another runtime
tree. Matching the CLI and provider version strings alone does not rule this out.

The reported stack was reproduced with real packages: CLI 1.6.1 and provider 1.6.1,
where a borrowed provider directory resolved its base class from Vitest 3.2.7.
The failure occurred at provider.js:2233, matching the reported stack. After
reinstalling provider 1.6.1 into the operation's coherent dependency tree, the
fixture passed and produced genuine coverage JSON. Both Vitest 1.6.1 and 3.2.7
also passed through CovAI's runVitestCoverage wrapper with real reports.

The runner now checks the installed CLI, provider and provider-resolved Vitest
before execution. It uses the package's JS entry point instead of stale .bin
shims, unrelated parent operations or npx fallback. Compatible workspace-level
hoisting remains supported. All three packages must resolve a coherent tree.

An incompatible provider is reinstalled at the exact installed runner version in
the operation workspace. Explicit version alignment uses a package add/install,
including when the provider is already declared, rather than repeating npm ci
against the incompatible declaration. Borrowed dependency junctions are detached
before writing. The runner version is preserved when it matches the project.

Configured plain Vitest commands and package scripts retain their flags but are
bound to the verified executable. Complex shell wrappers/chains are rejected with
an actionable message instead of running an unverified runner. Worker flags use
the actual selected runner version. Coverage execution uses workspace NODE_PATH
entries and keeps uninstrumented fallback disabled unless explicitly requested.

Regression checks cover version and patch mismatches, borrowed provider trees,
stale binary shims, parent-operation isolation, exact-version installation and
script binding. A remaining compatibility failure stops coverage and Apply;
assertions and source files are not rewritten to hide the infrastructure error.

No database migration is required. The backend and worker must load the updated
code before rerunning analysis, generating a fresh suggestion and applying it.
