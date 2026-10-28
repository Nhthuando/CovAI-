# Testing framework detection design

## Goal

Detect Jest and Vitest for every imported source snapshot. Make a normalized
result available to the API and downstream services while retaining the
existing Jest metadata and behaviour.

## Scope

- Detect Jest and Vitest from `package.json` dependencies, test scripts,
  supported config-file names, and inline package configuration.
- Discover existing JavaScript and TypeScript test files recursively, excluding
  `node_modules`, `.git`, coverage output, build output, and framework caches.
- Identify whether zero, one, or multiple supported frameworks are present.
- Return a deterministic primary framework (`jest`, then `vitest`) and a
  framework type of `none`, `single`, or `multiple`.
- Persist the normalized detection JSON on `ProjectSnapshot`; update legacy
  Jest columns so existing flows remain functional.
- Expose detection in snapshot responses and return it immediately after GitHub
  imports. The existing detect-Jest endpoint remains compatible and returns the
  normalized result as an additive field.

## Non-goals

- Running Vitest, changing the Jest-only coverage command, or generating
  Vitest-specific AI tests.
- Detecting frameworks other than Jest and Vitest.
- Replacing legacy Prisma fields in this change.

## Design

Create one pure utility, `testingFrameworkDetector`, that accepts a project
root and returns this contract:

```js
{
  frameworks: [
    {
      name: "jest" | "vitest",
      detected: boolean,
      version: string | null,
      configPaths: string[],
      hasPackageConfig: boolean,
      scripts: { name: string, command: string }[],
      dependencyTypes: string[]
    }
  ],
  detectedFrameworks: ["jest", "vitest"],
  primaryFramework: "jest" | "vitest" | null,
  frameworkType: "none" | "single" | "multiple",
  hasMultipleFrameworks: boolean,
  testFiles: [{ path: string, framework: "jest" | "vitest" | "unknown" }],
  testFileCount: number,
  errors: string[]
}
```

Framework detection is evidence-based: config files, package-level config,
dependencies (`dependencies`, `devDependencies`, `optionalDependencies`, or
`peerDependencies`), and scripts containing the framework command. Test files
use the established `.test.` / `.spec.` convention, plus `__tests__` folders.
The detector associates a file only when its contents provide unambiguous
framework evidence (`@jest/globals`, `jest.`, `vi.`, or `vitest`); otherwise it
is `unknown`.

`jestDetector` becomes a compatibility adapter over the normalized detector,
so existing imports, services, and database fields work without duplicated
logic. Snapshot persistence stores the full JSON result in a nullable
`testingFrameworksJson` column. `hasJest`, `jestConfigPath`, and `jestCommand`
continue to derive from the Jest entry. Project-level legacy values mirror the
latest imported snapshot.

## Error handling and security

Unreadable directories/files and invalid `package.json` files do not abort an
import; the detector returns a diagnostic in `errors` and continues with
available evidence. Traversal never enters ignored or generated directories,
keeps filesystem paths internal, and exposes normalized relative test-file
paths only.

## Verification

Add focused Jest tests using temporary fixture directories for: Jest-only,
Vitest-only, both frameworks, dependency/script/config evidence, inline config,
test discovery and classification, ignored paths, invalid/missing package JSON,
and no framework. Run the detector suite, full server Jest suite, Prisma
validation/generation, and client build/lint only if the API response typing or
display needs a client change.

## Compatibility

Existing Jest-only APIs and coverage execution remain unchanged. New fields are
additive; old consumers can continue reading `hasJest`, `jestConfigPath`, and
`jestCommand`.
