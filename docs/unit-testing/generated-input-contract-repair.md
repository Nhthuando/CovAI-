# Generated input contract failures

The reported `region.startsWith is not a function` came from a newly generated
boundary/edge-case test. The target source declares `getUSStateLaw(region: string)`.
An arbitrary number, boolean or object is not a valid string-region boundary case.
Type assertions such as `as any` do not convert the runtime argument.

Generation now receives function-specific input contracts, including locally
imported interface/type definitions. Its prompt explicitly rejects sweeping one
invalid-input list across unrelated exported functions or assuming undocumented
graceful behavior for out-of-contract values.

Apply and draft validation recognize method-TypeError failures separately from
assertion mismatches. Static analysis must first find an actual argument that
violates the explicit parameter contract associated with the failing receiver.
It supports primitive types, nullable/optional unions, rest arguments, nested
interface fields and finite local for-of/forEach fixtures. It does not execute
source code to infer an input contract.

Only an unmodified new generated callback is eligible for repair. Original user
cases, user-edited cases, mocked source contexts and valid-input implementation
failures remain visible. The model must cite the source contract and provide a
straight-line callback with meaningful assertions for every referenced target.
Original titles, imports, setup, sibling cases and application source are retained.
Catch wrappers, control-flow bypasses, computed expectations, weak assertions,
mocking, global mutation and unsupported edits are rejected.

Accepted edits remain pending until the complete batch runs again. Rerun results
and repair reasons are returned in validation metadata. Failure still blocks
publication and active-version creation. No `String(region)` coercion or other
business-source change is introduced to hide an invalid generated test.

Regression tests reproduce the runtime error with real Vitest and V8 coverage,
verify successful repair with original cases/source intact, and exercise Apply
rejection when repair evidence is missing. Additional checks cover finite fixture
aliases, imported nested fields, valid nullable/optional/rest inputs, source bugs
with valid inputs, unsafe replacement bodies and concurrent source changes.
Model responses are controlled in these tests; unsupported or uncertain live
cases retain their failure instead of being forced to pass.
