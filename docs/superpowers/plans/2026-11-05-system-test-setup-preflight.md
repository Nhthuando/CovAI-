# System Test setup and environment preflight

User-authorized scope: replace the raw missing Full Stack configuration failure with a readable English setup flow. Inspect actual project services and credential requirements before Run, explain missing env variables without returning values, and allow explicitly reviewed setup configuration without requiring new test generation. Keep existing runtime adapters; arbitrary languages/custom launchers remain explicitly unsupported or require manual configuration.

- [x] Add bounded, read-only preflight for detected/configured services, schema paths, Docker when required, and environment variable metadata.
- [x] Separate startup-required SDK credentials from potentially used variables. Keep automatically managed database/session settings distinct. Never return/read production env values for preflight or send test keys to AI.
- [x] Add guarded configuration Apply with workspace/hash checks and explicit review. Use existing publication/recovery; do not create a new secret store or silently write credentials.
- [x] Show an accessible setup dialog/table, Check again, detected setup Apply and name-only env template. Check before Run and surface runtime credential errors through the same panel.
- [x] Fix test-env access from operation copies by resolving only server-owned original workspace paths, with containment/size checks. Credentials remain outside copied source/artifacts/version manifests.
- [x] Run small source/permission/hash/env-leak tests, targeted lint/build and isolated publication verification. No browser E2E, AUT, paid AI or normal DB migration.

UI: toolbar action `Check setup`; compact status in the workspace; dialog sections `Application services`, `Test environment`, and a collapsed setup JSON review when needed. Table columns include Variable, Service, Status and Where to configure. Present means present in `.env.test`, not provider-validated. No key values or secret inputs are introduced in this delivery. Existing project file management remains the way to supply `.env.test`.
