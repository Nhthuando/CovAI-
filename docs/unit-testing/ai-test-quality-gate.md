# AI Test Quality Gate

Suggest inspects the sanitized, assembled candidate with its source and original test file. Apply repeats inspection for the uploaded snapshot after composing each reviewed candidate. Findings that require review prevent the batch from being written to the runnable workspace. The existing prepared-workspace transaction publishes only after successful validation.

The gate reuses the AST input contracts and Jest/Vitest mock validation. It can prove certain fixture type mismatches, literal assertions unrelated to the source, and contradictions with unconditional source returns or throws. An unchanged test that asserts the same behavior for the same input is independent evidence for a possible source defect. The gate does not execute application code during static analysis.

Generated candidates run in Docker. The runner reports assertion evidence and the gate records attempt order, timestamps, candidate hashes, classifications, and diagnoses in the operation result. The operation input keeps the reviewed candidate. `COVAI_UNIT_TEST_REPAIR_LIMIT` defaults to 2 and accepts 0 through 5. A classified environment failure may retry a dependency already declared by the project. Unproven fixture or expectation changes require a reviewed edit. A subsequent Apply revalidates the edit.

When a proposal targets specific lines or branches, CovAI reruns the unchanged suite separately. The new run must demonstrate a gain at a targeted Istanbul counter. Passing assertions or a gain on an unrelated branch are insufficient. The coverage evidence is scoped to the batch. Istanbul batch counters do not prove which individual test hit a shared counter.

The dashboard shows the current report and the run history. Results use the existing `ProjectOperation` JSON fields. There is no database migration.

Static analysis cannot establish arbitrary return values, callback side effects, collection ordering, or the intended requirement for an undocumented case. These need independent evidence and may be reported as unknown. An assertion mismatch cannot authorize copying the received value into the test.

The imported-project integration test is opt-in. Set `COVAI_QUALITY_IMPORTED_SOURCE` to the path of the imported Gemini chatbox `historyNormalizer.js` file, mount that fixture read-only, set `PROJECT_STORAGE_DRIVER=local`, and run `src/tests/unitTestQualityGate.imported.integration.test.js` inside the CovAI server container. It uses real Vitest and Istanbul-format coverage with a stubbed database.
