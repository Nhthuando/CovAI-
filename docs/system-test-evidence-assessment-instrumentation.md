# Instrumentation compatibility evidence

Verified on 13 October 2026 using the disposable fixture and tools in this repository.

| Capability | Evidence |
|---|---|
| Istanbul original JS source maps | Executed Node VM fixture; statements sharing one line counted independently from lines; unloaded file keeps zero map |
| Vite React JSX and Node ESM API | Two fresh Full Stack runs with real PostgreSQL; both tiers measured, original source unchanged |
| Managed requirement assertion events | Two confirmed criteria verified across both runs; no attachment/title inference |
| Controlled fault activation | Validation operator changed; managed activation marker observed; relevant strong assertion fails, weak body assertion passes |
| Compare candidate | Controlled AI response plus real independent runtime verification; scope/runtime identity must match before delta is reported |
| Navigation capture | Direct navigation/reload/close snapshots plus same-origin document archive; failures reject complete coverage |
| TypeScript frontend | `verify-system-assessment.mjs --typescript-only` transforms fixture to TSX and asserts original main.tsx counters after real runtime execution |

Dependencies pinned as direct backend dependencies: istanbul-lib-instrument 6.0.3, istanbul-lib-coverage 3.2.2, istanbul-lib-source-maps 4.0.1. The implementation instruments original TS/JSX syntax before Vite strips/transforms it, rather than counting compiled bundle lines; input source locations and zero maps come from the original AST. This is a deliberate refinement of the plan's proposed post-transform spike and avoids inventing original-source metrics from unverified compiled mapping.

Compatibility is specific to the tested adapters and fixture; package upgrades require rerunning runtime tools. Unsupported backend TS/build outputs, multi-process/worker source and ignore directives remain explicit limitations. Cypress new assessment is not enabled merely because its legacy execution path exists.
