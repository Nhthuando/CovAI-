# Universal Mock Generation Engine — Architecture & Audit

## 1. Phase 1 Audit Summary

### Existing Reusable Building Blocks
- `server/src/services/databaseMockTemplate.service.js`: Parses Prisma schema files (`parsePrismaSchemaModels`) to extract scalar fields, types, IDs, unique constraints, and relations.
- `server/src/services/unitTestContextEngineering.service.js`: `buildIsolationMockContracts` currently detects env vars (`extractEnvReferencesFromAst`), Prisma, Mongoose, etc. via regex/heuristic checks and emits inline Vitest/Jest snippets.
- `server/src/services/mockValidation.service.js`: `validateAndNormalizeMocks` + `resolveRelativeModuleOnDisk` already perform AST-level mock validation and normalization (hoisting order, virtual flag, self-mock removal, missing export check, spy-vs-mock check).
- `server/src/services/businessLogicAstAnalyzer.service.js`: `analyzeSourceAst` and `mapCoverageGaps` extract function signatures and AST call/branch info.
- `server/src/services/environmentDetection.service.js`: `extractEnvReferencesFromAst` and `inferMockValue`.
- `server/src/services/unitTestVerification.service.js`: `verifyUnitTestBatch` checks batch execution completeness and suite status.
- `server/src/services/generatedTestExpectationRepair.service.js`: `repairGeneratedTestExpectations` handles bounded expectation characterization (only when no mocks are present, never altering source code).

### Identified Gaps
1. **Technology detection relies on regex/package.json heuristics** instead of combining `package.json`, source AST imports, call patterns, and schema/config files.
2. **No Data Access Contract Analyzer**: Mock generation does not systematically analyze target function ASTs for query methods, return shape (`array`, `object | null`, `object`, `number`), `.map`/`.filter` operations, property access, nullability, or chained query calls (`.populate().sort().lean().exec()`, `.where().getMany()`).
3. **Monolithic string templates** in `buildIsolationMockContracts` instead of an extensible adapter registry (`Prisma`, `Mongoose`, `Sequelize`, `TypeORM`, `GenericRepository`, and explicit `UNSUPPORTED_DEPENDENCY` handling).
4. **No Pre-Docker Mock Contract Validator** checking whether generated mocks match the analyzed return types, required properties, nullability, async behavior, and method existence.
5. **No Structured Failure Classifier** distinguishing `INVALID_MOCK_CONTRACT`, `INVALID_FIXTURE`, `INCORRECT_EXPECTATION`, `SOURCE_DEFECT`, `REQUIREMENT_MISMATCH`, `MOCK_INITIALIZATION_ERROR`, `ENVIRONMENT_ERROR`, and `UNKNOWN`, nor bounded mock-only repair.

---

## 2. Target Architecture

### Phase 2 — Core Engine
- `server/src/services/projectTechnologyDetector.service.js`
  - Combines `package.json`, target source AST imports/requires/calls, transitive local dependencies, and schema/config files (`prisma/schema.prisma`, etc.).
  - Detects: `jest`, `vitest`, `prisma`, `mongoose`, `sequelize`, `typeorm`, `knex`, `native-db` (`pg`, `mysql2`, `mongodb`, `sqlite3`), `custom-repository`, `http` (`axios`, `fetch`), `redis` (`redis`, `ioredis`), `filesystem` (`fs`, `fs/promises`), `env` (`process.env`).
- `server/src/services/dataAccessContractAnalyzer.service.js`
  - Parses target source AST (JS/TS via `@babel/parser`) and inspects each exported/target function.
  - Produces per-dependency & per-method contracts: `dependency`, `importSource`, `clientOrModel`, `method`, `args`, `expectedReturnType`, `nullable`, `arrayOperations`, `propertyAccesses`, `chainedMethods`, `isAsync`, `errorHandling`, `schemaHint`.
- `server/src/services/universalMockEngine.service.js`
  - Extensible adapter registry (`registerMockAdapter`, `getMockAdapter`, `listMockAdapters`, `selectAdapterForDependency`).
  - Orchestrates: technology detection -> contract analysis -> adapter selection -> framework-compatible (`jest` / `vitest`) mock + fixture generation -> isolation (`beforeEach` / `clearAllMocks`) -> contract validation.
  - Marks un-analyzable unknown external dependencies as `UNSUPPORTED_DEPENDENCY` rather than silently guessing.

### Phase 3 & 4 — Extensible Adapters (`server/src/services/mockAdapters/`)
- `prisma.adapter.js`
- `mongoose.adapter.js`
- `sequelize.adapter.js`
- `typeorm.adapter.js`
- `genericRepository.adapter.js` (custom repositories, native DB drivers, Axios/Fetch, Redis, FS)

### Phase 5 — Mock Contract Validation, Failure Classification & Controlled Repair
- Extend `server/src/services/mockValidation.service.js` with `validateMockContracts({ code, contracts, filePath, sourceFile, rootDir, framework })`.
- Add `server/src/services/testFailureClassifier.service.js` classifying failures into:
  `INVALID_MOCK_CONTRACT`, `INVALID_FIXTURE`, `INCORRECT_EXPECTATION`, `SOURCE_DEFECT`, `REQUIREMENT_MISMATCH`, `MOCK_INITIALIZATION_ERROR`, `ENVIRONMENT_ERROR`, `UNKNOWN`.
- Add `server/src/services/controlledMockRepair.service.js` with bounded retry loop (repairing only mocks/fixtures from analyzed contracts, revalidating statically before Docker re-run, never modifying source code or weakening assertions).
- Wire into `unitTestContextEngineering.service.js`, `unitTestGenerator.service.js`, and `applyTestSuggestion.service.js`.

### Phase 6 — Regression & Docker Verification
- Unit & integration tests with independent fixture projects:
  - Prisma + PostgreSQL
  - Mongoose + MongoDB
  - Sequelize + MySQL
  - TypeORM
  - Custom repository without ORM
  - Both Jest and Vitest
- Real Docker execution inside `covai_server` via `runUnitTestBatch(..., { requireDocker: true })`.
